//! The localhost API for AI agents (ADR 0007, D264).
//!
//! A tiny HTTP/1.1 server on 127.0.0.1 (random port) that forwards each request to the main window
//! as an `agent:request` event and waits for its `agent_reply` command. The main window is the only
//! writer (D33), so nothing here touches the database. `agent.json` in the app data folder tells the
//! `momentum` CLI the port and the bearer token.
//!
//! Browsers can't use it: a request that carries an `Origin` header, or a `Host` that isn't the
//! loopback address, is refused, and every call needs the token from the file.

use std::{
    collections::HashMap,
    fs,
    io::{Read, Write},
    net::{IpAddr, TcpListener, TcpStream},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, Mutex,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State};

const FILE: &str = "agent.json";
const MAX_BODY: usize = 1024 * 1024;
const MAX_HEAD: usize = 16 * 1024;
const REPLY_TIMEOUT: Duration = Duration::from_secs(10);
const IO_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Default)]
pub struct Agent {
    pending: Mutex<HashMap<String, mpsc::Sender<String>>>,
    /// The main window has registered its listener; before that, requests would vanish.
    ready: AtomicBool,
    seq: AtomicU64,
}

/// A request that passed parsing, before authorization.
#[derive(Debug, PartialEq)]
struct Req {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

type Fail = (u16, &'static str);

/// Reads one HTTP/1.1 request. Anything malformed, chunked or oversized is refused with a status.
fn parse_request(r: &mut impl Read) -> Result<Req, Fail> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];
    let head_end = loop {
        if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break i;
        }
        if buf.len() > MAX_HEAD {
            return Err((431, "headers too large"));
        }
        match r.read(&mut chunk) {
            Ok(0) | Err(_) => return Err((400, "incomplete request")),
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
        }
    };
    let head = std::str::from_utf8(&buf[..head_end]).map_err(|_| (400, "bad headers"))?;
    let mut lines = head.split("\r\n");
    let mut first = lines.next().unwrap_or("").split(' ');
    let (method, path, version) = (first.next().unwrap_or(""), first.next().unwrap_or(""), first.next().unwrap_or(""));
    if method.is_empty() || !path.starts_with('/') || !version.starts_with("HTTP/1.") {
        return Err((400, "bad request line"));
    }
    let mut headers = HashMap::new();
    for l in lines {
        let (k, v) = l.split_once(':').ok_or((400, "bad header"))?;
        headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
    }
    if headers.contains_key("transfer-encoding") {
        return Err((501, "chunked bodies are not supported"));
    }
    let len = match headers.get("content-length") {
        None => 0,
        Some(v) => v.parse::<usize>().map_err(|_| (400, "bad content-length"))?,
    };
    if len > MAX_BODY {
        return Err((413, "body too large"));
    }
    let mut body = buf[head_end + 4..].to_vec();
    while body.len() < len {
        match r.read(&mut chunk) {
            Ok(0) | Err(_) => return Err((400, "incomplete body")),
            Ok(n) => body.extend_from_slice(&chunk[..n]),
        }
    }
    body.truncate(len);
    Ok(Req { method: method.into(), path: path.into(), headers, body })
}

/// Equal without leaking, through timing, how much of a wrong token matched.
fn same(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Loopback peer, no `Origin`, a loopback `Host`, then the bearer token. Returns the op name.
fn authorize<'a>(req: &'a Req, peer: IpAddr, port: u16, token: &str) -> Result<&'a str, Fail> {
    if !peer.is_loopback() {
        return Err((403, "loopback only"));
    }
    if req.headers.contains_key("origin") {
        return Err((403, "browser requests are not allowed"));
    }
    let host_ok = req.headers.get("host").is_some_and(|h| h == &format!("127.0.0.1:{port}") || h == &format!("localhost:{port}"));
    if !host_ok {
        return Err((403, "bad host"));
    }
    let given = req.headers.get("authorization").and_then(|v| v.strip_prefix("Bearer ")).unwrap_or("");
    if !same(given.as_bytes(), token.as_bytes()) {
        return Err((401, "bad token"));
    }
    if req.method != "POST" {
        return Err((405, "use POST"));
    }
    match req.path.strip_prefix("/v1/") {
        Some(op) if !op.is_empty() && op.bytes().all(|b| b.is_ascii_lowercase() || b == b'_') => Ok(op),
        _ => Err((404, "unknown path")),
    }
}

fn respond(s: &mut TcpStream, status: u16, body: &str) {
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        413 => "Payload Too Large",
        422 => "Unprocessable Entity",
        503 => "Service Unavailable",
        504 => "Gateway Timeout",
        _ => "Error",
    };
    let _ = write!(s, "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
}

fn error_body(msg: &str) -> String {
    serde_json::json!({ "ok": false, "error": msg }).to_string()
}

fn handle(mut s: TcpStream, app: &AppHandle, port: u16, token: &str) {
    let _ = s.set_read_timeout(Some(IO_TIMEOUT));
    let _ = s.set_write_timeout(Some(IO_TIMEOUT));
    let Ok(peer) = s.peer_addr() else { return };
    let (status, body) = match parse_request(&mut s).and_then(|req| {
        let op = authorize(&req, peer.ip(), port, token)?.to_string();
        Ok((op, req.body))
    }) {
        Err((code, msg)) => (code, error_body(msg)),
        Ok((op, body)) => forward(app, &op, &body),
    };
    respond(&mut s, status, &body);
}

/// Hands the request to the main window and waits for its answer.
fn forward(app: &AppHandle, op: &str, body: &[u8]) -> (u16, String) {
    let state = app.state::<Agent>();
    if op == "ping" {
        return (200, serde_json::json!({ "ok": true, "data": { "ready": state.ready.load(Ordering::SeqCst) } }).to_string());
    }
    if !state.ready.load(Ordering::SeqCst) {
        return (503, error_body("Momentum is still starting"));
    }
    let args: serde_json::Value = if body.is_empty() {
        serde_json::Value::Null
    } else {
        match serde_json::from_slice(body) {
            Ok(v) => v,
            Err(_) => return (400, error_body("the body must be JSON")),
        }
    };
    let id = format!("r{}", state.seq.fetch_add(1, Ordering::SeqCst));
    let (tx, rx) = mpsc::channel();
    state.pending.lock().unwrap().insert(id.clone(), tx);
    if app.emit_to("main", "agent:request", serde_json::json!({ "id": id, "op": op, "args": args })).is_err() {
        state.pending.lock().unwrap().remove(&id);
        return (503, error_body("the main window is not available"));
    }
    match rx.recv_timeout(REPLY_TIMEOUT) {
        Ok(reply) => {
            let ok = serde_json::from_str::<serde_json::Value>(&reply).ok().and_then(|v| v["ok"].as_bool()).unwrap_or(false);
            (if ok { 200 } else { 422 }, stamped(&reply, std::process::id()))
        }
        Err(_) => {
            state.pending.lock().unwrap().remove(&id);
            (504, error_body("Momentum did not answer in time"))
        }
    }
}

/// Adds `instance` (the app's pid) to a reply, so a client can tell the app restarted between two calls.
fn stamped(reply: &str, pid: u32) -> String {
    match serde_json::from_str::<serde_json::Value>(reply) {
        Ok(serde_json::Value::Object(mut m)) => {
            m.insert("instance".into(), pid.into());
            serde_json::Value::Object(m).to_string()
        }
        _ => reply.to_string(),
    }
}

/// The main window's answer to an `agent:request`.
#[tauri::command]
pub fn agent_reply(window: tauri::Window, state: State<Agent>, id: String, result: String) {
    // Popups can't write (D33), so they can't answer for the main window either.
    if window.label() != "main" {
        return;
    }
    if let Some(tx) = state.pending.lock().unwrap().remove(&id) {
        let _ = tx.send(result);
    }
}

/// The main window is listening; start forwarding.
#[tauri::command]
pub fn agent_ready(state: State<Agent>) {
    state.ready.store(true, Ordering::SeqCst);
}

fn random_token() -> std::io::Result<String> {
    let mut b = [0u8; 32];
    getrandom::fill(&mut b).map_err(|e| std::io::Error::other(e.to_string()))?;
    Ok(b.iter().map(|x| format!("{x:02x}")).collect())
}

#[cfg(unix)]
fn write_private(path: &Path, text: &str) -> std::io::Result<()> {
    use std::os::unix::fs::OpenOptionsExt;
    fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(path)?.write_all(text.as_bytes())
}

/// Windows: the app data folder is inside the user profile, which other accounts can't read.
#[cfg(not(unix))]
fn write_private(path: &Path, text: &str) -> std::io::Result<()> {
    fs::write(path, text)
}

/// Writes the whole file or none of it: a reader never sees a half-written agent.json (AGENT-09).
fn write_atomic(path: &Path, text: &str) -> std::io::Result<()> {
    let tmp = path.with_extension("json.tmp");
    write_private(&tmp, text)?;
    fs::rename(&tmp, path)
}

fn file_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_config_dir().map_err(|e| e.to_string())?.join(FILE))
}

/// Writes agent.json, once more if the first try fails. If it still fails the old file is removed (it
/// names a dead process and port) and the reason goes to `agent-error.log` beside it: a release build has
/// no console, and without the file the CLI can't find the app at all.
fn publish(path: &Path, text: &str) -> std::io::Result<()> {
    let mut result = write_atomic(path, text);
    if result.is_err() {
        std::thread::sleep(Duration::from_millis(150));
        result = write_atomic(path, text);
    }
    if let Err(e) = &result {
        let _ = fs::remove_file(path);
        let _ = fs::write(path.with_file_name("agent-error.log"), format!("couldn't write {}: {e}\n", path.display()));
    }
    result
}

/// Binds the port, writes `agent.json` and serves in a background thread.
pub fn start(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    let port = listener.local_addr()?.port();
    let token = random_token()?;
    let path = file_path(app)?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    publish(&path, &serde_json::json!({ "port": port, "token": token, "pid": std::process::id() }).to_string())?;
    let app = app.clone();
    std::thread::spawn(move || {
        for conn in listener.incoming().flatten() {
            let (app, token) = (app.clone(), token.clone());
            std::thread::spawn(move || handle(conn, &app, port, &token));
        }
    });
    Ok(())
}

/// Removes `agent.json` when the app exits, so the CLI doesn't trust a dead port.
pub fn stop(app: &AppHandle) {
    if let Ok(p) = file_path(app) {
        let _ = fs::remove_file(p);
    }
}

// ---------- the CLI on the user's PATH (Settings → AI agents) ----------

const CLI: &str = if cfg!(windows) { "momentum-cli.exe" } else { "momentum-cli" };

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliInfo {
    /// Absolute path of the shipped CLI (next to the app); empty when it isn't there.
    cli_path: String,
    /// Where `momentum` is put for PATH: a folder on Windows, a symlink elsewhere.
    link: String,
    on_path: bool,
}

fn cli_path() -> Option<PathBuf> {
    std::env::current_exe().ok()?.parent().map(|d| d.join(CLI)).filter(|p| p.exists())
}

fn link_path(app: &AppHandle) -> Result<PathBuf, String> {
    if cfg!(windows) {
        Ok(app.path().app_config_dir().map_err(|e| e.to_string())?.join("bin").join("momentum.exe"))
    } else {
        Ok(app.path().home_dir().map_err(|e| e.to_string())?.join(".local").join("bin").join("momentum"))
    }
}

#[tauri::command]
pub fn agent_cli_info(app: AppHandle) -> Result<CliInfo, String> {
    let link = link_path(&app)?;
    Ok(CliInfo { cli_path: cli_path().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default(), link: link.to_string_lossy().into_owned(), on_path: link.exists() })
}

/// Adds or removes `momentum` on PATH. Idempotent: the same call twice leaves the same state.
#[tauri::command]
pub fn agent_cli_path(app: AppHandle, enabled: bool) -> Result<(), String> {
    let link = link_path(&app)?;
    if !enabled {
        let _ = fs::remove_file(&link);
        #[cfg(windows)]
        if let Some(dir) = link.parent() {
            windows_path(dir, false)?;
        }
        return Ok(());
    }
    let cli = cli_path().ok_or("the momentum command line tool is not installed next to the app")?;
    let dir = link.parent().ok_or("no folder")?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    #[cfg(windows)]
    {
        // A copy, not a link: it must be named `momentum.exe`, which can't live next to Momentum.exe.
        // Refreshed on every launch, so an update replaces it.
        match refresh_copy(&cli, &link) {
            Refresh::Copied => {}
            Refresh::Replaced => eprintln!("momentum.exe was in use; replaced it by renaming the old copy aside"),
            Refresh::KeptOld if link.exists() => eprintln!("momentum.exe is in use and couldn't be replaced; the existing copy stays until it is closed"),
            Refresh::KeptOld => return Err("couldn't copy the momentum command to its folder".into()),
        }
        // Tells the copy where the app is, so `momentum` can start it in the tray.
        if let Ok(app_exe) = std::env::current_exe() {
            fs::write(dir.join("app.txt"), app_exe.to_string_lossy().as_bytes()).map_err(|e| e.to_string())?;
        }
        windows_path(dir, true)
    }
    #[cfg(not(windows))]
    {
        let _ = fs::remove_file(&link);
        std::os::unix::fs::symlink(&cli, &link).map_err(|e| e.to_string())
    }
}

/// Appends `dir` to a `;`-separated PATH unless it is already there (case-insensitive, ignoring a trailing slash).
fn path_with(path: &str, dir: &str) -> String {
    if path_has(path, dir) {
        return path.to_string();
    }
    if path.trim().is_empty() { dir.to_string() } else { format!("{};{dir}", path.trim_end_matches(';')) }
}

fn path_without(path: &str, dir: &str) -> String {
    path.split(';').filter(|p| !p.is_empty() && !same_dir(p, dir)).collect::<Vec<_>>().join(";")
}

fn same_dir(a: &str, b: &str) -> bool {
    a.trim_end_matches(['\\', '/']).eq_ignore_ascii_case(b.trim_end_matches(['\\', '/']))
}

fn path_has(path: &str, dir: &str) -> bool {
    path.split(';').any(|p| same_dir(p, dir))
}

/// The data of the `Path` value in `reg query` output. The name is matched case-insensitively
/// (Windows stores `Path`, `PATH` or `path`), and `None` means no such value is listed.
fn parse_path_value(text: &str) -> Option<String> {
    text.lines().find_map(|l| {
        let l = l.trim();
        let (name, rest) = l.split_once(char::is_whitespace)?;
        let rest = rest.trim_start();
        let (kind, data) = rest.split_once(char::is_whitespace).unwrap_or((rest, ""));
        (name.eq_ignore_ascii_case("path") && kind.starts_with("REG_")).then(|| data.trim().to_string())
    })
}

/// The PATH to write, or `None` when nothing changes. Adding never produces a shorter PATH than
/// the one read: that would drop entries, so it is an error instead of a write.
fn next_path(current: &str, dir: &str, add: bool) -> Result<Option<String>, String> {
    // reg.exe may have answered in a legacy codepage: the unreadable bytes became U+FFFD and writing them back would destroy those entries.
    if current.contains('\u{FFFD}') {
        return Err("your PATH has characters that couldn't be read safely, so it was left alone".into());
    }
    let next = if add { path_with(current, dir) } else { path_without(current, dir) };
    if next == current {
        return Ok(None);
    }
    if add && next.len() < current.len() {
        return Err("refusing to write a shorter PATH than the one read".into());
    }
    Ok(Some(next))
}

/// Edits the user's PATH through `reg.exe` (the value stays REG_EXPAND_SZ so `%VARS%` survive), then
/// broadcasts the change so new terminals see it. Any doubt about what the current value is aborts
/// without writing: a wrong guess would replace the user's whole PATH.
#[cfg(windows)]
fn windows_path(dir: &Path, add: bool) -> Result<(), String> {
    use std::{os::windows::process::CommandExt, process::Command};
    const NO_WINDOW: u32 = 0x0800_0000;
    let run = |args: &[&str]| Command::new("reg").args(args).creation_flags(NO_WINDOW).output().map_err(|e| e.to_string());
    let out = run(&["query", r"HKCU\Environment", "/v", "Path"])?;
    let current = if out.status.success() {
        parse_path_value(&String::from_utf8_lossy(&out.stdout)).ok_or("couldn't read your PATH, so it was left alone")?
    } else {
        // Failed: either the user has no PATH value yet, or the read itself failed. Tell them apart by
        // listing the whole key (the error text is localized): only a readable key without a Path value is "none yet".
        let all = run(&["query", r"HKCU\Environment"])?;
        if all.status.success() && parse_path_value(&String::from_utf8_lossy(&all.stdout)).is_none() {
            String::new()
        } else {
            return Err("couldn't read your PATH, so it was left alone".into());
        }
    };
    let d = dir.to_string_lossy();
    let Some(next) = next_path(&current, &d, add)? else { return Ok(()) };
    let r = run(&["add", r"HKCU\Environment", "/v", "Path", "/t", "REG_EXPAND_SZ", "/d", &next, "/f"])?;
    if !r.status.success() {
        return Err(String::from_utf8_lossy(&r.stderr).trim().to_string());
    }
    // Setting any user variable through .NET broadcasts WM_SETTINGCHANGE; best effort.
    let _ = Command::new("powershell")
        .args(["-NoProfile", "-Command", "[Environment]::SetEnvironmentVariable('MOMENTUM_PATH_REFRESH','1','User'); [Environment]::SetEnvironmentVariable('MOMENTUM_PATH_REFRESH',$null,'User')"])
        .creation_flags(NO_WINDOW)
        .output();
    Ok(())
}

#[cfg(windows)]
#[derive(Debug, PartialEq)]
enum Refresh {
    Copied,
    /// The old copy was in use: it was renamed aside and the new one put in its place.
    Replaced,
    /// Neither worked; the existing copy stays (and still runs).
    KeptOld,
}

/// Puts a fresh copy of `src` at `dst`. A running `momentum.exe` (an MCP client holds it) can't be
/// overwritten but can be renamed, so on failure: copy to a temp name, move the old one aside, rename in.
#[cfg(windows)]
fn refresh_copy(src: &Path, dst: &Path) -> Refresh {
    if fs::copy(src, dst).is_ok() {
        return Refresh::Copied;
    }
    let (tmp, old) = (dst.with_extension("exe.new"), dst.with_extension("exe.old"));
    let swapped = fs::copy(src, &tmp).is_ok() && {
        let _ = fs::remove_file(&old);
        fs::rename(dst, &old).is_ok() && fs::rename(&tmp, dst).is_ok()
    };
    if swapped {
        return Refresh::Replaced;
    }
    let _ = fs::remove_file(&tmp);
    Refresh::KeptOld
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;

    const LOCAL: IpAddr = IpAddr::V4(Ipv4Addr::LOCALHOST);
    const TOKEN: &str = "abc123";

    fn req(text: &str) -> Result<Req, Fail> {
        parse_request(&mut text.as_bytes())
    }
    fn good(extra: &str) -> Req {
        req(&format!("POST /v1/list HTTP/1.1\r\nHost: 127.0.0.1:5000\r\nAuthorization: Bearer {TOKEN}\r\nContent-Length: 2\r\n{extra}\r\n{{}}")).unwrap()
    }

    #[test]
    fn parses_a_request_with_a_body() {
        let r = good("");
        assert_eq!((r.method.as_str(), r.path.as_str(), r.body.as_slice()), ("POST", "/v1/list", b"{}".as_slice()));
        assert_eq!(r.headers["host"], "127.0.0.1:5000");
    }

    #[test]
    fn refuses_malformed_oversized_and_chunked() {
        assert_eq!(req("garbage\r\n\r\n").unwrap_err().0, 400);
        assert_eq!(req("POST /v1/x HTTP/1.1\r\nContent-Length: 2000000\r\n\r\n").unwrap_err().0, 413);
        assert_eq!(req("POST /v1/x HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n").unwrap_err().0, 501);
        assert_eq!(req("POST /v1/x HTTP/1.1\r\nContent-Length: 10\r\n\r\nabc").unwrap_err().0, 400);
        assert_eq!(req("POST /v1/x HTTP/1.1\r\nHost: a").unwrap_err().0, 400);
    }

    #[test]
    fn authorizes_only_loopback_with_the_token() {
        assert_eq!(authorize(&good(""), LOCAL, 5000, TOKEN), Ok("list"));
        assert_eq!(authorize(&good(""), "10.0.0.2".parse().unwrap(), 5000, TOKEN).unwrap_err().0, 403);
        assert_eq!(authorize(&good(""), LOCAL, 5000, "other").unwrap_err().0, 401);
        assert_eq!(authorize(&good(""), LOCAL, 5001, TOKEN).unwrap_err().0, 403, "wrong port in Host");
    }

    #[test]
    fn refuses_browsers_and_rebinding() {
        assert_eq!(authorize(&good("Origin: https://evil.example\r\n"), LOCAL, 5000, TOKEN).unwrap_err().0, 403);
        let rebound = req(&format!("POST /v1/list HTTP/1.1\r\nHost: evil.example:5000\r\nAuthorization: Bearer {TOKEN}\r\n\r\n")).unwrap();
        assert_eq!(authorize(&rebound, LOCAL, 5000, TOKEN).unwrap_err().0, 403);
        let get = req(&format!("GET /v1/list HTTP/1.1\r\nHost: localhost:5000\r\nAuthorization: Bearer {TOKEN}\r\n\r\n")).unwrap();
        assert_eq!(authorize(&get, LOCAL, 5000, TOKEN).unwrap_err().0, 405);
        let odd = req(&format!("POST /v1/../etc HTTP/1.1\r\nHost: localhost:5000\r\nAuthorization: Bearer {TOKEN}\r\n\r\n")).unwrap();
        assert_eq!(authorize(&odd, LOCAL, 5000, TOKEN).unwrap_err().0, 404);
    }

    #[test]
    fn tokens_compare_exactly() {
        assert!(same(b"abc", b"abc"));
        assert!(!same(b"abc", b"abd") && !same(b"abc", b"ab"));
    }

    #[test]
    fn path_edits_are_idempotent() {
        let dir = r"C:\Users\me\AppData\Roaming\com.momentum.planner\bin";
        let once = path_with(r"C:\Tools;%USERPROFILE%\bin", dir);
        assert_eq!(once, format!(r"C:\Tools;%USERPROFILE%\bin;{dir}"));
        assert_eq!(path_with(&once, &format!("{dir}\\").to_uppercase()), once);
        assert_eq!(path_without(&once, dir), r"C:\Tools;%USERPROFILE%\bin");
        assert_eq!(path_without(&path_without(&once, dir), dir), r"C:\Tools;%USERPROFILE%\bin");
        assert_eq!(path_with("", dir), dir);
    }

    #[test]
    fn reads_the_path_value_whatever_its_name_case() {
        for name in ["Path", "PATH", "path"] {
            let out = format!("\r\nHKEY_CURRENT_USER\\Environment\r\n    {name}    REG_EXPAND_SZ    C:\\Tools;%USERPROFILE%\\My Bin\r\n\r\n");
            assert_eq!(parse_path_value(&out).as_deref(), Some(r"C:\Tools;%USERPROFILE%\My Bin"), "{name}");
        }
        assert_eq!(parse_path_value("    Path    REG_SZ    C:\\a").as_deref(), Some(r"C:\a"));
        assert_eq!(parse_path_value("    TEMP    REG_EXPAND_SZ    C:\\t\r\n    Pathext    REG_SZ    .EXE").as_deref(), None);
        assert_eq!(parse_path_value("    Path    REG_EXPAND_SZ    ").as_deref(), Some(""));
        assert_eq!(parse_path_value("ERROR: The system was unable to find the specified registry key or value."), None);
    }

    #[test]
    fn replies_carry_the_instance_and_paths_with_unreadable_bytes_are_left_alone() {
        let v: serde_json::Value = serde_json::from_str(&stamped(r#"{"ok":true,"data":1}"#, 42)).unwrap();
        assert_eq!((v["ok"].as_bool(), v["instance"].as_u64()), (Some(true), Some(42)));
        assert_eq!(stamped("not json", 42), "not json");
        assert!(next_path("C:\\Jos\u{FFFD};C:\\a", r"C:\bin", true).is_err());
        assert!(next_path("C:\\Jos\u{FFFD}", r"C:\bin", false).is_err());
    }

    #[test]
    fn a_failed_publish_removes_the_stale_file_and_says_why() {
        let d = std::env::temp_dir().join(format!("momentum-publish-test-{}", std::process::id()));
        fs::create_dir_all(d.join("agent.json.tmp")).unwrap(); // the temp name is taken by a folder: every write fails
        let f = d.join("agent.json");
        fs::write(&f, "stale").unwrap();
        assert!(publish(&f, "new").is_err());
        assert!(!f.exists());
        assert!(fs::read_to_string(d.join("agent-error.log")).unwrap().contains("couldn't write"));
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn agent_json_is_written_whole_and_replaced() {
        let d = std::env::temp_dir().join(format!("momentum-agent-test-{}", std::process::id()));
        fs::create_dir_all(&d).unwrap();
        let f = d.join("agent.json");
        write_atomic(&f, "one").unwrap();
        write_atomic(&f, "two").unwrap();
        assert_eq!(fs::read_to_string(&f).unwrap(), "two");
        assert!(!d.join("agent.json.tmp").exists());
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn adding_never_shortens_the_path() {
        let dir = r"C:\bin";
        assert_eq!(next_path(r"C:\a;C:\b;", dir, true).unwrap(), Some(r"C:\a;C:\b;C:\bin".to_string()));
        assert_eq!(next_path(&format!("C:\\a;{dir}"), dir, true).unwrap(), None);
        assert_eq!(next_path("", dir, true).unwrap(), Some(dir.to_string()));
        assert_eq!(next_path(&format!("C:\\a;{dir}"), dir, false).unwrap(), Some(r"C:\a".to_string()));
        assert_eq!(next_path(r"C:\a", dir, false).unwrap(), None);
    }

    #[cfg(windows)]
    #[test]
    fn refreshing_the_copy_survives_a_locked_exe() {
        use std::os::windows::fs::OpenOptionsExt;
        let d = std::env::temp_dir().join(format!("momentum-copy-test-{}", std::process::id()));
        fs::create_dir_all(&d).unwrap();
        let (src, dst) = (d.join("src.exe"), d.join("momentum.exe"));
        fs::write(&src, b"new").unwrap();
        fs::write(&dst, b"old").unwrap();
        assert_eq!(refresh_copy(&src, &dst), Refresh::Copied);
        // Held open without sharing: neither overwrite nor rename can touch it, so the old copy stays.
        let held = fs::OpenOptions::new().read(true).share_mode(0).open(&dst).unwrap();
        assert_eq!(refresh_copy(&src, &dst), Refresh::KeptOld);
        drop(held);
        // Held with read and delete sharing (how a running exe is mapped): overwrite fails, rename works.
        let running = fs::OpenOptions::new().read(true).share_mode(1 | 4).open(&dst).unwrap();
        fs::write(&src, b"newer").unwrap();
        assert_eq!(refresh_copy(&src, &dst), Refresh::Replaced);
        drop(running);
        assert_eq!(fs::read(&dst).unwrap(), b"newer");
        let _ = fs::remove_dir_all(&d);
    }
}
