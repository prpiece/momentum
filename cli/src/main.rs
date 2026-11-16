//! `momentum`: the command line and MCP server for the Momentum planner (ADR 0007, D264).
//! Every command is one request to the localhost API of the running app (see `src-tauri/src/agent.rs`);
//! it never opens the database. If the app isn't running it is started in the tray first.
//! Exit codes: 0 ok, 1 error, 2 usage.

use serde_json::{json, Map, Value};
use std::{
    collections::HashMap,
    io::{BufRead, Read, Write},
    net::TcpStream,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

const APP_ID: &str = "com.momentum.planner";
const START_WAIT: Duration = Duration::from_secs(20);

const HELP: &str = "momentum: talk to your running Momentum app

Usage: momentum <command> [options]

  list [view] [--archived]    view: today (default), inbox, upcoming, someday, waiting, a list name, or a filter like \"#work !high\"
  search <text> [--status open|done|all] [--archived]
  get <id>
  add <text...>               quick-add text: \"call mom by fri 15m !high #family ~Home\"
        [--list L] [--parent ID] [--date D] [--time HH:mm] [--deadline D] [--duration 15|1h30m]
        [--priority P] [--tags a,b]   (structured: these win over what the text says)
  update <id> [--title T] [--notes N] [--date YYYY-MM-DD|someday|none] [--deadline YYYY-MM-DD|none]
              [--duration 15|1h30m|none] [--priority none|low|medium|high] [--list L] [--tags a,b]
              [--scope this|following|all]   (recurring tasks: this occurrence by default)
              [--time HH:mm] [--pin|--unpin]
  done <id>                   complete a task
  reopen <id>
  delete <full-id> [--with-subtasks] [--scope this|following|all]
                              move one task to the Trash (needs the full id; subtasks need --with-subtasks).
                              A repeating task loses only its current occurrence unless --scope all
  lists                       the lists you can use with --list / ~List
  tags                        the tags in use
  restore <id>                bring a task back from the Trash
  trash                       list what is in the Trash
  habits                      habits with today's status
  checkin <habit> [--delta N | --value N] [--date YYYY-MM-DD]
                              add to a habit's check-in (--delta -1 undoes one); a name or an id
  events [--from D] [--to D]  calendar events (default: the next 7 days)
  focus                       the focus timer: idle, running or paused, and on what
  mcp                         serve MCP over stdio (for Claude Code, Cursor, Codex, Gemini CLI...)

Options: --json (machine-readable output), --limit N (list, search), -h/--help. A bare -- ends the options, so text may start with --.
Ids may be shortened to their first 4+ characters, except for delete, which needs the full id. If Momentum isn't running it is started in the tray.
";

enum Fail {
    Usage(String),
    Error(String),
}
type R<T> = Result<T, Fail>;
fn err<T>(m: impl Into<String>) -> R<T> {
    Err(Fail::Error(m.into()))
}
fn usage<T>(m: impl Into<String>) -> R<T> {
    Err(Fail::Usage(m.into()))
}

// ---------- finding and talking to the app ----------

fn config_dir() -> Option<PathBuf> {
    if let Some(d) = std::env::var_os("MOMENTUM_CONFIG_DIR") {
        return Some(d.into());
    }
    let env = |k: &str| std::env::var_os(k).map(PathBuf::from);
    let base = if cfg!(windows) {
        env("APPDATA")?
    } else if cfg!(target_os = "macos") {
        env("HOME")?.join("Library/Application Support")
    } else {
        env("XDG_CONFIG_HOME").or_else(|| env("HOME").map(|h| h.join(".config")))?
    };
    Some(base.join(APP_ID))
}

struct Endpoint {
    port: u64,
    token: String,
}

fn agent_file() -> Option<Value> {
    let text = std::fs::read_to_string(config_dir()?.join("agent.json")).ok()?;
    serde_json::from_str(&text).ok()
}

/// agent.json names a process that is gone: the app is not the one that wrote it (crash, or it never rewrote it).
fn stale_file() -> bool {
    agent_file().is_some_and(|v| !live_pid(&v))
}

fn endpoint() -> Option<Endpoint> {
    let v = agent_file()?;
    // A crash leaves agent.json behind; the token must never go to whatever took the port since (AGENT-07).
    if !live_pid(&v) {
        return None;
    }
    Some(Endpoint { port: v["port"].as_u64()?, token: v["token"].as_str()?.to_string() })
}

/// True unless agent.json names a process that no longer exists.
fn live_pid(v: &Value) -> bool {
    v["pid"].as_u64().is_none_or(|p| u32::try_from(p).is_ok_and(pid_alive))
}

#[cfg(windows)]
fn pid_alive(pid: u32) -> bool {
    use std::ffi::c_void;
    unsafe extern "system" {
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> *mut c_void;
        fn GetExitCodeProcess(h: *mut c_void, code: *mut u32) -> i32;
        fn CloseHandle(h: *mut c_void) -> i32;
    }
    // PROCESS_QUERY_LIMITED_INFORMATION; STILL_ACTIVE is 259.
    unsafe {
        let h = OpenProcess(0x1000, 0, pid);
        if h.is_null() {
            return false;
        }
        let mut code = 0u32;
        let alive = GetExitCodeProcess(h, &mut code) != 0 && code == 259;
        CloseHandle(h);
        alive
    }
}

#[cfg(not(windows))]
fn pid_alive(pid: u32) -> bool {
    Command::new("kill").args(["-0", &pid.to_string()]).stdout(Stdio::null()).stderr(Stdio::null()).status().is_ok_and(|s| s.success())
}

enum CallError {
    /// Nothing is listening (app closed, or agent.json is stale).
    Unreachable,
    /// The app is up but its window hasn't finished loading.
    Starting,
    Failed(String),
}

fn http_post(ep: &Endpoint, op: &str, args: &Value) -> Result<Value, CallError> {
    let addr = format!("127.0.0.1:{}", ep.port);
    let sock = addr.parse().map_err(|_| CallError::Unreachable)?;
    let mut s = TcpStream::connect_timeout(&sock, Duration::from_secs(2)).map_err(|_| CallError::Unreachable)?;
    let _ = s.set_read_timeout(Some(Duration::from_secs(15)));
    let body = args.to_string();
    let req = format!("POST /v1/{op} HTTP/1.1\r\nHost: {addr}\r\nAuthorization: Bearer {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", ep.token, body.len());
    s.write_all(req.as_bytes()).map_err(|e| CallError::Failed(e.to_string()))?;
    let mut raw = Vec::new();
    let _ = s.read_to_end(&mut raw);
    let text = String::from_utf8_lossy(&raw);
    let (head, body) = text.split_once("\r\n\r\n").ok_or_else(|| CallError::Failed("no answer from Momentum".into()))?;
    let status: u16 = head.split(' ').nth(1).and_then(|c| c.parse().ok()).unwrap_or(0);
    let v: Value = serde_json::from_str(body).map_err(|_| CallError::Failed(format!("unexpected answer (HTTP {status})")))?;
    if status == 503 {
        return Err(CallError::Starting);
    }
    if v["ok"].as_bool() == Some(true) {
        Ok(stamp(&v))
    } else {
        Err(CallError::Failed(v["error"].as_str().unwrap_or("request failed").to_string()))
    }
}

/// The reply's data, with the app's `instance` (its pid) and the data `revision` added to an object, so a client
/// can see the app restarted or the data changed between two calls (AGENT-21).
fn stamp(reply: &Value) -> Value {
    let mut data = reply["data"].clone();
    if let Some(m) = data.as_object_mut() {
        for k in ["instance", "revision"] {
            if !reply[k].is_null() {
                m.insert(k.into(), reply[k].clone());
            }
        }
    }
    data
}

fn try_call(op: &str, args: &Value) -> Result<Value, CallError> {
    match endpoint() {
        Some(ep) => http_post(&ep, op, args),
        None => Err(CallError::Unreachable),
    }
}

fn app_exe() -> Option<PathBuf> {
    let me = std::env::current_exe().ok()?;
    let me = std::fs::canonicalize(&me).unwrap_or(me);
    let dir = me.parent()?;
    // The PATH copy on Windows lives elsewhere; the app leaves the install location next to it.
    let hinted = std::fs::read_to_string(dir.join("app.txt")).ok().map(|s| PathBuf::from(s.trim()));
    let names: &[&str] = if cfg!(windows) { &["Momentum.exe", "momentum.exe"] } else { &["Momentum", "momentum"] };
    hinted.filter(|p| p.exists()).or_else(|| names.iter().map(|n| dir.join(n)).find(|p| p.is_file()))
}

/// The PowerShell that counts the processes running exactly `exe` (the CLI copies and MCP servers are other files).
fn running_script(exe: &Path) -> String {
    let name = exe.file_stem().and_then(|n| n.to_str()).unwrap_or("Momentum");
    let path = exe.to_string_lossy().replace('\'', "''");
    format!("@(Get-Process -Name '{}' -ErrorAction SilentlyContinue | Where-Object {{ $_.Path -eq '{path}' }}).Count", name.replace('\'', "''"))
}

/// Is the installed app already running? Starting a second copy from another context (an MCP host's
/// virtualized %APPDATA%, say) would fork the database, so an app that is up but silent is never relaunched.
fn app_running(exe: &Path) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let out = Command::new("powershell").args(["-NoProfile", "-NonInteractive", "-Command", &running_script(exe)]).creation_flags(0x0800_0000).output();
        out.ok().is_some_and(|o| String::from_utf8_lossy(&o.stdout).trim().parse::<u32>().is_ok_and(|n| n > 0))
    }
    #[cfg(not(windows))]
    {
        // The full command line: the `momentum` symlink to this CLI has another path.
        Command::new("pgrep").arg("-f").arg("--").arg(exe).stdout(Stdio::null()).stderr(Stdio::null()).status().is_ok_and(|s| s.success())
    }
}

/// What to tell the caller when nothing answered in time.
fn timeout_message(stale: bool, running: bool) -> &'static str {
    if running {
        "Momentum is running but not answering. Quit it from the tray and open it again. I didn't start another copy: two copies would keep separate data."
    } else if stale {
        "Momentum isn't reachable: agent.json is stale (it names a process that has exited). If Momentum is running, quit it from the tray and start it again; see agent-error.log in the app data folder."
    } else {
        "Momentum didn't answer within 20 seconds. Is it running?"
    }
}

fn launch_app() -> R<()> {
    let Some(exe) = app_exe() else { return err("Momentum isn't running and I couldn't find the app to start it. Open Momentum once, then try again.") };
    let mut c = Command::new(exe);
    c.arg("--minimized").stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0000_0008 | 0x0000_0200); // DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    }
    c.spawn().map_err(|e| Fail::Error(format!("couldn't start Momentum: {e}")))?;
    Ok(())
}

/// One API call; starts the app in the tray and waits for it if it isn't answering.
fn call(op: &str, args: &Value) -> R<Value> {
    let (mut launched, mut misses, mut running) = (false, 0, None);
    let started = Instant::now();
    loop {
        match try_call(op, args) {
            Ok(v) => return Ok(v),
            Err(CallError::Failed(m)) => return err(m),
            Err(e) => {
                // One failed connect can be a file caught mid-write: launching then would pop the window up.
                misses += usize::from(matches!(e, CallError::Unreachable));
                if misses >= 2 && !launched && running.is_none() {
                    let up = app_exe().is_some_and(|e| app_running(&e));
                    running = Some(up);
                    if !up {
                        eprintln!("Starting Momentum in the tray...");
                        launch_app()?;
                        launched = true;
                    }
                }
                if started.elapsed() > START_WAIT {
                    return err(timeout_message(stale_file(), running == Some(true)));
                }
                std::thread::sleep(Duration::from_millis(300));
            }
        }
    }
}

// ---------- arguments ----------

struct Parsed {
    cmd: String,
    pos: Vec<String>,
    flags: Map<String, Value>,
    json: bool,
}

const VALUE_FLAGS: &[&str] = &["list", "parent", "title", "notes", "date", "deadline", "duration", "priority", "tags", "limit", "scope", "status", "delta", "value", "from", "to", "time"];
/// Flags that take no value.
const SWITCHES: &[&str] = &["with-subtasks", "archived", "pin", "unpin"];

fn parse_args(args: Vec<String>) -> R<Parsed> {
    let (mut cmd, mut pos, mut flags, mut json) = (None, Vec::new(), Map::new(), false);
    let mut it = args.into_iter();
    while let Some(a) = it.next() {
        if a == "--" {
            // Everything after a bare -- is text, even if it starts with a dash.
            for rest in it.by_ref() {
                if cmd.is_none() { cmd = Some(rest) } else { pos.push(rest) }
            }
        } else if a == "--json" {
            json = true;
        } else if a == "-h" || a == "--help" {
            cmd = Some("help".to_string());
        } else if let Some(f) = a.strip_prefix("--") {
            let (name, inline) = match f.split_once('=') {
                Some((n, v)) => (n, Some(v.to_string())),
                None => (f, None),
            };
            if SWITCHES.contains(&name) {
                flags.insert(name.to_string(), Value::Bool(true));
                continue;
            }
            if !VALUE_FLAGS.contains(&name) {
                return usage(format!("unknown option --{name}"));
            }
            let v = match inline.or_else(|| it.next()) {
                Some(v) => v,
                None => return usage(format!("--{name} needs a value")),
            };
            flags.insert(name.to_string(), Value::String(v));
        } else if cmd.is_none() {
            cmd = Some(a);
        } else {
            pos.push(a);
        }
    }
    Ok(Parsed { cmd: cmd.unwrap_or_else(|| "help".into()), pos, flags, json })
}

/// `15`, `15m`, `1h`, `1h30m`, `none`.
fn minutes(s: &str) -> Option<Value> {
    if s == "none" {
        return Some(Value::Null);
    }
    let s = s.to_ascii_lowercase();
    let (h, m) = match s.split_once('h') {
        Some((h, m)) => (h.parse::<u64>().ok()?, m.strip_suffix('m').unwrap_or(m)),
        None => (0, s.strip_suffix('m').unwrap_or(&s)),
    };
    // Needs a digit somewhere, and not zero: only "none" clears (AGENT-10).
    if !s.bytes().any(|b| b.is_ascii_digit()) || m.contains('m') {
        return None;
    }
    let m = if m.is_empty() { 0 } else { m.parse::<u64>().ok()? };
    let total = h.checked_mul(60)?.checked_add(m)?;
    (total > 0).then(|| json!(total))
}

fn one_id(p: &Parsed) -> R<String> {
    match p.pos.as_slice() {
        [id] => Ok(id.clone()),
        _ => usage(format!("momentum {} <id>", p.cmd)),
    }
}

/// Maps a command to an API op and its arguments.
fn to_op(p: &Parsed) -> R<(&'static str, Value)> {
    let limit = |m: &mut Map<String, Value>| -> R<()> {
        if let Some(l) = p.flags.get("limit") {
            let n: u64 = l.as_str().unwrap_or("").parse().map_err(|_| Fail::Usage("--limit needs a number".into()))?;
            m.insert("limit".into(), json!(n));
        }
        Ok(())
    };
    let archived = |m: &mut Map<String, Value>| {
        if p.flags.contains_key("archived") {
            m.insert("includeArchived".into(), json!(true));
        }
    };
    let whole = |k: &str| -> R<Option<i64>> {
        p.flags.get(k).map(|v| v.as_str().unwrap_or("").parse::<i64>().map_err(|_| Fail::Usage(format!("--{k} needs a whole number")))).transpose()
    };
    Ok(match p.cmd.as_str() {
        "focus" => ("focus", json!({})),
        "checkin" => {
            if p.pos.is_empty() {
                return usage("momentum checkin <habit> [--delta N | --value N] [--date D]");
            }
            let mut m = Map::new();
            m.insert("habit".into(), json!(p.pos.join(" ")));
            for k in ["delta", "value"] {
                if let Some(n) = whole(k)? {
                    m.insert(k.into(), json!(n));
                }
            }
            if let Some(v) = p.flags.get("date") {
                m.insert("date".into(), v.clone());
            }
            ("checkin", Value::Object(m))
        }
        "events" => {
            let mut m = Map::new();
            for k in ["from", "to"] {
                if let Some(v) = p.flags.get(k) {
                    m.insert(k.into(), v.clone());
                }
            }
            limit(&mut m)?;
            ("events", Value::Object(m))
        }
        "list" => {
            let mut m = Map::new();
            if !p.pos.is_empty() {
                m.insert("view".into(), json!(p.pos.join(" ")));
            }
            archived(&mut m);
            limit(&mut m)?;
            ("list", Value::Object(m))
        }
        "search" => {
            if p.pos.is_empty() {
                return usage("momentum search <text>");
            }
            let mut m = Map::new();
            m.insert("text".into(), json!(p.pos.join(" ")));
            if let Some(v) = p.flags.get("status") {
                m.insert("status".into(), v.clone());
            }
            archived(&mut m);
            limit(&mut m)?;
            ("search", Value::Object(m))
        }
        "get" => ("get", json!({ "id": one_id(p)? })),
        "done" | "complete" => ("complete", json!({ "id": one_id(p)? })),
        "reopen" => ("reopen", json!({ "id": one_id(p)? })),
        "habits" => ("habits", json!({})),
        "lists" => ("lists", json!({})),
        "tags" => ("tags", json!({})),
        "restore" => ("restore", json!({ "id": one_id(p)? })),
        "delete" => {
            let mut m = Map::new();
            m.insert("id".into(), json!(one_id(p)?));
            m.insert("withSubtasks".into(), json!(p.flags.contains_key("with-subtasks")));
            if let Some(v) = p.flags.get("scope") {
                m.insert("scope".into(), v.clone());
            }
            ("delete", Value::Object(m))
        }
        "trash" => {
            let mut m = Map::new();
            limit(&mut m)?;
            ("trash", Value::Object(m))
        }
        "add" => {
            if p.pos.is_empty() {
                return usage("momentum add <text...> [--list L] [--parent ID]");
            }
            let mut m = Map::new();
            m.insert("text".into(), json!(p.pos.join(" ")));
            for (flag, key) in [("list", "list"), ("parent", "parentId"), ("date", "date"), ("time", "time"), ("deadline", "deadline"), ("priority", "priority")] {
                if let Some(v) = p.flags.get(flag) {
                    m.insert(key.into(), v.clone());
                }
            }
            if let Some(d) = p.flags.get("duration") {
                m.insert("durationMin".into(), minutes(d.as_str().unwrap_or("")).ok_or_else(|| Fail::Usage("--duration looks like 15, 1h30m or none".into()))?);
            }
            if let Some(t) = p.flags.get("tags") {
                m.insert("tags".into(), json!(t.as_str().unwrap_or("").split(',').map(str::trim).filter(|s| !s.is_empty()).collect::<Vec<_>>()));
            }
            ("add", Value::Object(m))
        }
        "update" => {
            let mut m = Map::new();
            m.insert("id".into(), json!(one_id(p)?));
            for (flag, key) in [("title", "title"), ("notes", "description"), ("date", "date"), ("deadline", "deadline"), ("priority", "priority"), ("list", "list"), ("time", "time")] {
                if let Some(v) = p.flags.get(flag) {
                    m.insert(key.into(), v.clone());
                }
            }
            if p.flags.contains_key("pin") || p.flags.contains_key("unpin") {
                m.insert("pinned".into(), json!(p.flags.contains_key("pin") && !p.flags.contains_key("unpin")));
            }
            let scope = p.flags.get("scope");
            if let Some(v) = scope {
                m.insert("scope".into(), v.clone());
            }
            if let Some(d) = p.flags.get("duration") {
                m.insert("durationMin".into(), minutes(d.as_str().unwrap_or("")).ok_or_else(|| Fail::Usage("--duration looks like 15, 1h30m or none".into()))?);
            }
            if let Some(t) = p.flags.get("tags") {
                let tags: Vec<_> = t.as_str().unwrap_or("").split(',').map(str::trim).filter(|s| !s.is_empty()).collect();
                m.insert("tags".into(), json!(tags));
            }
            if m.len() == 1 + usize::from(scope.is_some()) {
                return usage("momentum update <id> needs at least one option, see --help");
            }
            ("update", Value::Object(m))
        }
        other => return usage(format!("unknown command {other}")),
    })
}

// ---------- human output ----------

fn s(v: &Value) -> &str {
    v.as_str().unwrap_or("")
}

fn task_line(t: &Value) -> String {
    let mut bits = Vec::new();
    if let Some(p) = t["planned"].as_str() {
        bits.push(match t["start"].as_str() {
            Some(st) => format!("{p} {st}"),
            None => p.to_string(),
        });
    }
    if let Some(d) = t["deadline"].as_str() {
        bits.push(format!("by {d}"));
    }
    if let Some(m) = t["durationMin"].as_u64() {
        bits.push(if m % 60 == 0 { format!("{}h", m / 60) } else if m > 60 { format!("{}h{}m", m / 60, m % 60) } else { format!("{m}m") });
    }
    if s(&t["priority"]) != "none" {
        bits.push(s(&t["priority"]).to_string());
    }
    for tag in t["tags"].as_array().into_iter().flatten() {
        bits.push(format!("#{}", s(tag)));
    }
    if let Some(rep) = t["repeats"].as_str() {
        bits.push(format!("repeats: {}", rep.to_lowercase()));
    }
    bits.push(format!("~{}", s(&t["list"])));
    if let Some(n) = t["subtasks"].as_u64().filter(|n| *n > 0) {
        bits.push(format!("{n} subtasks"));
    }
    let mark = match s(&t["status"]) {
        "done" => "[x]",
        "wont_do" => "[-]",
        _ => "[ ]",
    };
    let id: String = s(&t["id"]).chars().take(8).collect();
    format!("{id}  {mark} {}  ({})", s(&t["title"]), bits.join(" · "))
}

fn human(op: &str, d: &Value) -> String {
    let tasks = |label: &str| {
        let list = d["tasks"].as_array().cloned().unwrap_or_default();
        if list.is_empty() {
            return format!("No tasks{label}.");
        }
        let mut out: Vec<String> = list.iter().map(task_line).collect();
        let total = d["total"].as_u64().unwrap_or(0) as usize;
        if total > list.len() {
            out.push(format!("... and {} more (use --limit)", total - list.len()));
        }
        out.join("\n")
    };
    match op {
        "list" => tasks(&format!(" in {}", s(&d["view"]))),
        "search" => tasks(" found"),
        "get" => {
            let t = &d["task"];
            let mut out = task_line(t);
            out.push_str(&format!("\nid: {}", s(&t["id"])));
            if !s(&t["notes"]).is_empty() {
                out.push_str(&format!("\n{}", s(&t["notes"])));
            }
            for k in d["subtasks"].as_array().into_iter().flatten() {
                out.push_str(&format!("\n  {}", task_line(k)));
            }
            out
        }
        "add" => format!("Added {}{}", task_line(&d["task"]), d["note"].as_str().map(|n| format!("\n{n}")).unwrap_or_default()),
        "update" => format!("Updated {}", task_line(&d["task"])),
        "complete" => format!("Done {}", task_line(&d["task"])),
        "reopen" => format!("Reopened {}", task_line(&d["task"])),
        "restore" => format!("Restored {}", task_line(&d["task"])),
        "delete" => {
            let mut out = format!("Deleted: {}", task_line(&d["deleted"]));
            if let Some(n) = d["note"].as_str() {
                out.push_str(&format!("\n{n}"));
            }
            for k in d["subtasks"].as_array().into_iter().flatten() {
                out.push_str(&format!("\n  and its subtask {}", task_line(k)));
            }
            out.push_str("\nUndo with: momentum restore ");
            out.push_str(s(&d["deleted"]["id"]));
            out
        }
        "trash" => {
            let list = d["tasks"].as_array().cloned().unwrap_or_default();
            if list.is_empty() {
                return "The Trash is empty.".into();
            }
            list.iter().map(|t| format!("{}  (deleted {})", task_line(t), s(&t["deletedAt"]).get(..10).unwrap_or(""))).collect::<Vec<_>>().join("\n")
        }
        "lists" | "tags" => {
            let rows = d[if op == "lists" { "lists" } else { "tags" }].as_array().cloned().unwrap_or_default();
            if rows.is_empty() {
                return format!("No {op}.");
            }
            rows.iter().map(|r| format!("{}{}", s(&r["name"]), if r["archived"].as_bool() == Some(true) { " (archived)" } else { "" })).collect::<Vec<_>>().join("\n")
        }
        "checkin" => {
            let h = &d["habit"];
            format!("{} on {}: {} (now {}/{} {})  streak {}", s(&h["name"]), s(&d["date"]), d["checkin"], h["value"], h["target"], s(&h["goal"]), s(&h["streak"]))
        }
        "events" => {
            let es = d["events"].as_array().cloned().unwrap_or_default();
            if es.is_empty() {
                return format!("No events from {} to {}.", s(&d["from"]), s(&d["to"]));
            }
            let mut out: Vec<String> = es
                .iter()
                .map(|e| {
                    let when = match e["start"].as_str() {
                        Some(st) => format!("{} {st}-{}", s(&e["date"]), s(&e["end"])),
                        None if e["endDate"] != e["date"] => format!("{} to {}", s(&e["date"]), s(&e["endDate"])),
                        None => format!("{} (all day)", s(&e["date"])),
                    };
                    format!("{when}  {}{}", s(&e["title"]), if e["repeats"].as_bool() == Some(true) { "  (repeats)" } else { "" })
                })
                .collect();
            let total = d["total"].as_u64().unwrap_or(0) as usize;
            if total > es.len() {
                out.push(format!("... and {} more (use --limit)", total - es.len()));
            }
            out.join("\n")
        }
        "focus" => match s(&d["status"]) {
            "running" | "paused" => format!(
                "Focus {} ({} {}, round {}): {} min{}",
                s(&d["status"]),
                s(&d["mode"]),
                s(&d["phase"]),
                d["round"],
                d["elapsedMin"],
                d["task"]["title"].as_str().map(|t| format!(" on {t}")).unwrap_or_default()
            ),
            "done" => "The last focus session is finished.".into(),
            _ => "No focus session running.".into(),
        },
        "habits" => {
            let hs = d["habits"].as_array().cloned().unwrap_or_default();
            if hs.is_empty() {
                return "No habits.".into();
            }
            hs.iter()
                .map(|h| {
                    let mark = match h["done"].as_bool() {
                        Some(true) => "[x]",
                        Some(false) => "[ ]",
                        None => "[~]",
                    };
                    let due = if h["dueToday"].as_bool() == Some(true) { "" } else { "  (not today)" };
                    format!("{mark} {}  {}/{} {}  streak {}{due}", s(&h["name"]), h["value"], h["target"], s(&h["goal"]), s(&h["streak"]))
                })
                .collect::<Vec<_>>()
                .join("\n")
        }
        _ => d.to_string(),
    }
}

// ---------- MCP over stdio ----------

fn tools() -> Value {
    let task_fields = json!({
        "title": { "type": "string" },
        "description": { "type": "string", "description": "Notes (Markdown)." },
        "date": { "type": "string", "description": "Planned day: YYYY-MM-DD, \"someday\" or \"none\"." },
        "deadline": { "type": "string", "description": "Must be done by: YYYY-MM-DD or \"none\"." },
        "durationMin": { "type": ["integer", "null"], "description": "Expected minutes, or null to clear." },
        "priority": { "type": "string", "enum": ["none", "low", "medium", "high"] },
        "list": { "type": "string", "description": "List name." },
        "tags": { "type": "array", "items": { "type": "string" }, "description": "Replaces the task's tags." },
        "time": { "type": "string", "description": "HH:mm: makes it a time block on its planned day (today if none)." },
        "pinned": { "type": "boolean" }
    });
    let id = json!({ "id": { "type": "string", "description": "Task id from list_tasks (4+ leading characters are enough)." } });
    let mut update_props = task_fields.as_object().cloned().unwrap_or_default();
    update_props.extend(id.as_object().cloned().unwrap_or_default());
    update_props.insert("scope".into(), json!({ "type": "string", "enum": ["this", "following", "all"], "description": "Recurring tasks only: which occurrences change. Default this (just the current one)." }));
    json!([
        { "name": "list_tasks", "description": "List open tasks in a view: today, inbox, upcoming, someday, waiting, a list name, or a filter such as \"#work !high overdue\". Defaults to today.",
          "inputSchema": { "type": "object", "properties": { "view": { "type": "string" }, "limit": { "type": "integer", "minimum": 1, "maximum": 200 }, "includeArchived": { "type": "boolean", "description": "Also tasks in archived lists (their archived field is true)." } } } },
        { "name": "search_tasks", "description": "Find tasks whose title or notes contain the words. Open and finished by default; status narrows it.",
          "inputSchema": { "type": "object", "properties": { "text": { "type": "string" }, "limit": { "type": "integer", "minimum": 1, "maximum": 200 }, "status": { "type": "string", "enum": ["open", "done", "all"] }, "includeArchived": { "type": "boolean", "description": "Also tasks in archived lists." } }, "required": ["text"] } },
        { "name": "get_task", "description": "One task with its subtasks.", "inputSchema": { "type": "object", "properties": id, "required": ["id"] } },
        { "name": "add_task", "description": "Add a task from quick-add text: dates, times, durations, !priority, #tags, ~List and repeats are picked out, e.g. \"call mom by fri 15m !high #family\".",
          "inputSchema": { "type": "object", "properties": { "text": { "type": "string" }, "list": { "type": "string", "description": "List name (default Inbox)." }, "parentId": { "type": "string", "description": "Make it a subtask of this task." }, "date": { "type": "string", "description": "Planned day: YYYY-MM-DD or \"someday\"." }, "time": { "type": "string", "description": "HH:mm: makes it a time block on its day (today if no date)." }, "deadline": { "type": "string", "description": "YYYY-MM-DD." }, "durationMin": { "type": "integer", "description": "Expected minutes." }, "priority": { "type": "string", "enum": ["none", "low", "medium", "high"] }, "tags": { "type": "array", "items": { "type": "string" } } }, "required": ["text"] } },
        { "name": "update_task", "description": "Change fields of a task. Only the fields given change.",
          "inputSchema": { "type": "object", "properties": update_props, "required": ["id"] } },
        { "name": "complete_task", "description": "Mark a task done (a recurring task completes its current occurrence).", "inputSchema": { "type": "object", "properties": id, "required": ["id"] } },
        { "name": "reopen_task", "description": "Reopen a finished task.", "inputSchema": { "type": "object", "properties": id, "required": ["id"] } },
        { "name": "delete_task", "description": "Move ONE task to the Trash (recoverable for 30 days) and return it. A repeating task (repeats is set) loses only its current occurrence unless scope is \"all\". Needs the task's full id, not a shortened one. A task with subtasks is refused unless withSubtasks is true; the response lists everything removed. There is no bulk delete.",
          "inputSchema": { "type": "object", "properties": { "id": { "type": "string", "description": "The task's full id." }, "withSubtasks": { "type": "boolean", "description": "Required when the task has subtasks; deletes them too." }, "scope": { "type": "string", "enum": ["this", "following", "all"], "description": "Repeating tasks only. Default this (just the current occurrence)." } }, "required": ["id"] } },
        { "name": "restore_task", "description": "Bring a task back from the Trash (with the subtasks deleted along with it).", "inputSchema": { "type": "object", "properties": id, "required": ["id"] } },
        { "name": "list_trash", "description": "Tasks currently in the Trash, newest first.",
          "inputSchema": { "type": "object", "properties": { "limit": { "type": "integer", "minimum": 1, "maximum": 200 } } } },
        { "name": "list_habits", "description": "Habits with today's progress and streak.", "inputSchema": { "type": "object", "properties": {} } },
        { "name": "list_lists", "description": "The names of the lists a task can be added to or moved to.", "inputSchema": { "type": "object", "properties": {} } },
        { "name": "list_tags", "description": "The tags in use.", "inputSchema": { "type": "object", "properties": {} } },
        { "name": "check_in_habit", "description": "Add to a habit's check-in for a day (default today, +1). A negative delta undoes; value sets the day's total. The habit is its name or id.",
          "inputSchema": { "type": "object", "properties": { "habit": { "type": "string" }, "date": { "type": "string", "description": "YYYY-MM-DD, not in the future." }, "delta": { "type": "integer" }, "value": { "type": "integer", "minimum": 0 } }, "required": ["habit"] } },
        { "name": "list_events", "description": "Calendar events (not tasks) between two days, default the next 7 days.",
          "inputSchema": { "type": "object", "properties": { "from": { "type": "string" }, "to": { "type": "string" }, "limit": { "type": "integer", "minimum": 1, "maximum": 200 } } } },
        { "name": "focus_status", "description": "The focus timer: idle, running or paused, and on which task.", "inputSchema": { "type": "object", "properties": {} } }
    ])
}

/// The tool list as sent: the server refuses unknown fields, so the schemas say so, and each tool says
/// whether it only reads or can remove something, so clients can auto-approve reads (AGENT-12).
fn tools_listed() -> Value {
    let mut list = tools();
    for t in list.as_array_mut().into_iter().flatten() {
        let name = t["name"].as_str().unwrap_or("").to_string();
        t["inputSchema"]["additionalProperties"] = json!(false);
        let read_only = matches!(name.as_str(), "list_tasks" | "search_tasks" | "get_task" | "list_trash" | "list_habits" | "list_lists" | "list_tags" | "list_events" | "focus_status");
        t["annotations"] = json!({ "readOnlyHint": read_only, "destructiveHint": name == "delete_task", "openWorldHint": false });
    }
    list
}

fn tool_op(name: &str) -> Option<&'static str> {
    Some(match name {
        "list_tasks" => "list",
        "search_tasks" => "search",
        "get_task" => "get",
        "add_task" => "add",
        "update_task" => "update",
        "complete_task" => "complete",
        "reopen_task" => "reopen",
        "delete_task" => "delete",
        "restore_task" => "restore",
        "list_trash" => "trash",
        "list_habits" => "habits",
        "list_lists" => "lists",
        "list_tags" => "tags",
        "check_in_habit" => "checkin",
        "list_events" => "events",
        "focus_status" => "focus",
        _ => return None,
    })
}

const PROTOCOLS: &[&str] = &["2024-11-05", "2025-03-26", "2025-06-18"];

fn mcp_reply(msg: &Value) -> Option<Value> {
    if !msg.is_object() {
        // A batch or a bare value: not supported, but the client is owed an answer.
        return Some(json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32600, "message": "invalid request: send one JSON object per line" } }));
    }
    msg["method"].as_str()?; // a client's response to us has no method and gets no answer
    let id = msg.get("id")?.clone(); // a notification has no id and gets no answer
    let ok = |result: Value| Some(json!({ "jsonrpc": "2.0", "id": id, "result": result }));
    let fail = |code: i64, m: &str| Some(json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": m } }));
    match msg["method"].as_str().unwrap_or("") {
        "initialize" => ok(json!({
            "protocolVersion": msg["params"]["protocolVersion"].as_str().filter(|v| PROTOCOLS.contains(v)).unwrap_or(PROTOCOLS[PROTOCOLS.len() - 1]),
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "momentum", "version": env!("CARGO_PKG_VERSION") },
            "instructions": "Momentum is the user's local planner. Use these tools to read and change their tasks and habits; changes appear in the app at once."
        })),
        "ping" => ok(json!({})),
        "tools/list" => ok(json!({ "tools": tools_listed() })),
        "tools/call" => {
            let name = msg["params"]["name"].as_str().unwrap_or("");
            let Some(op) = tool_op(name) else { return fail(-32602, &format!("unknown tool {name}")) };
            let args = msg["params"].get("arguments").cloned().unwrap_or_else(|| json!({}));
            let (text, is_error) = match call(op, &args) {
                Ok(v) => (serde_json::to_string_pretty(&v).unwrap_or_default(), false),
                Err(Fail::Error(m) | Fail::Usage(m)) => (m, true),
            };
            ok(json!({ "content": [{ "type": "text", "text": text }], "isError": is_error }))
        }
        m => fail(-32601, &format!("method not found: {m}")),
    }
}

/// Tool calls in flight, by request id, and whether the client has cancelled them. A call can't be taken
/// back once sent to the app, but a cancelled one gets no reply (MCP `notifications/cancelled`).
#[derive(Default)]
struct Inflight(Mutex<HashMap<String, bool>>);

impl Inflight {
    fn begin(&self, id: &Value) {
        self.0.lock().unwrap().insert(id.to_string(), false);
    }
    fn cancel(&self, id: &Value) {
        if let Some(c) = self.0.lock().unwrap().get_mut(&id.to_string()) {
            *c = true;
        }
    }
    /// True if the call was cancelled while it ran.
    fn finish(&self, id: &Value) -> bool {
        self.0.lock().unwrap().remove(&id.to_string()).unwrap_or(false)
    }
}

fn serve_mcp() -> R<()> {
    eprintln!("momentum mcp: serving on stdio");
    let out = Arc::new(Mutex::new(std::io::stdout()));
    let inflight = Arc::new(Inflight::default());
    let send = |out: &Mutex<std::io::Stdout>, r: &Value| {
        let mut o = out.lock().unwrap();
        let _ = writeln!(o, "{r}");
        let _ = o.flush();
    };
    for line in std::io::stdin().lock().lines() {
        let line = line.map_err(|e| Fail::Error(e.to_string()))?;
        if line.trim().is_empty() {
            continue;
        }
        let Ok(msg) = serde_json::from_str::<Value>(&line) else {
            send(&out, &json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32700, "message": "parse error" } }));
            continue;
        };
        if msg["method"] == "notifications/cancelled" {
            inflight.cancel(&msg["params"]["requestId"]);
        } else if msg["method"] == "tools/call" && msg.get("id").is_some() {
            // A call can wait up to 20 s for the app to start: it must not hold up the ones behind it.
            let (out, inflight) = (out.clone(), inflight.clone());
            let id = msg["id"].clone();
            inflight.begin(&id);
            std::thread::spawn(move || {
                let reply = mcp_reply(&msg);
                if let (false, Some(r)) = (inflight.finish(&id), reply) {
                    let mut o = out.lock().unwrap();
                    let _ = writeln!(o, "{r}");
                    let _ = o.flush();
                }
            });
        } else if let Some(r) = mcp_reply(&msg) {
            send(&out, &r);
        }
    }
    Ok(())
}

fn run() -> R<()> {
    let p = parse_args(std::env::args().skip(1).collect())?;
    match p.cmd.as_str() {
        "help" => print!("{HELP}"),
        "mcp" => serve_mcp()?,
        _ => {
            let (op, args) = to_op(&p)?;
            let data = call(op, &args)?;
            if p.json {
                println!("{}", serde_json::to_string_pretty(&data).unwrap_or_default());
            } else {
                println!("{}", human(op, &data));
            }
        }
    }
    Ok(())
}

fn main() {
    match run() {
        Ok(()) => {}
        Err(Fail::Usage(m)) => {
            eprintln!("momentum: {m}\nTry momentum --help");
            std::process::exit(2);
        }
        Err(Fail::Error(m)) => {
            eprintln!("momentum: {m}");
            std::process::exit(1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parsed(a: &[&str]) -> Parsed {
        parse_args(a.iter().map(|s| s.to_string()).collect()).ok().unwrap()
    }

    #[test]
    fn add_joins_text_and_maps_flags() {
        let (op, args) = to_op(&parsed(&["add", "call", "mom", "by", "fri", "15m", "--list=Home", "--json"])).ok().unwrap();
        assert_eq!((op, args), ("add", json!({ "text": "call mom by fri 15m", "list": "Home" })));
    }

    #[test]
    fn update_maps_options_and_durations() {
        let (_, args) = to_op(&parsed(&["update", "ab12", "--duration", "1h30m", "--tags", "a, b", "--notes", "x"])).ok().unwrap();
        assert_eq!(args, json!({ "id": "ab12", "durationMin": 90, "tags": ["a", "b"], "description": "x" }));
        assert_eq!(minutes("15m"), Some(json!(15)));
        assert_eq!(minutes("2h"), Some(json!(120)));
        assert_eq!(minutes("none"), Some(Value::Null));
        assert_eq!(minutes("soon"), None);
    }

    #[test]
    fn delete_restore_and_trash_map_to_ops() {
        let (op, args) = to_op(&parsed(&["delete", "abcdef-full-id"])).ok().unwrap();
        assert_eq!((op, args), ("delete", json!({ "id": "abcdef-full-id", "withSubtasks": false })));
        let (_, args) = to_op(&parsed(&["delete", "--with-subtasks", "abc"])).ok().unwrap();
        assert_eq!(args, json!({ "id": "abc", "withSubtasks": true }));
        assert_eq!(to_op(&parsed(&["restore", "abc"])).ok().unwrap(), ("restore", json!({ "id": "abc" })));
        assert_eq!(to_op(&parsed(&["trash", "--limit", "5"])).ok().unwrap(), ("trash", json!({ "limit": 5 })));
        assert!(to_op(&parsed(&["delete", "a", "b"])).is_err(), "no bulk delete");
        let (_, args) = to_op(&parsed(&["update", "ab12", "--title", "x", "--scope", "all"])).ok().unwrap();
        assert_eq!(args, json!({ "id": "ab12", "title": "x", "scope": "all" }));
        assert!(to_op(&parsed(&["update", "ab12", "--scope", "all"])).is_err());
    }

    #[test]
    fn mcp_offers_delete_restore_and_trash() {
        let list = mcp_reply(&json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" })).unwrap();
        let names: Vec<_> = list["result"]["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap()).collect();
        assert!(["delete_task", "restore_task", "list_trash"].iter().all(|n| names.contains(n) && tool_op(n).is_some()));
    }

    #[test]
    fn duration_needs_a_positive_amount() {
        for bad in ["m", "0", "0m", "0h", "15mmm", "h", "", "99999999999999999999h", "18446744073709551615h"] {
            assert_eq!(minutes(bad), None, "{bad}");
        }
        assert_eq!(minutes("1h30m"), Some(json!(90)));
        assert_eq!(minutes("1h"), Some(json!(60)));
    }

    #[test]
    fn double_dash_ends_options() {
        let (op, args) = to_op(&parsed(&["add", "--", "--foo", "--json"])).ok().unwrap();
        assert_eq!((op, args), ("add", json!({ "text": "--foo --json" })));
    }

    #[test]
    fn delete_scope_lists_tags_and_search_status_map() {
        let (_, args) = to_op(&parsed(&["delete", "abc", "--scope", "all"])).ok().unwrap();
        assert_eq!(args, json!({ "id": "abc", "withSubtasks": false, "scope": "all" }));
        assert_eq!(to_op(&parsed(&["lists"])).ok().unwrap(), ("lists", json!({})));
        assert_eq!(to_op(&parsed(&["tags"])).ok().unwrap(), ("tags", json!({})));
        assert_eq!(to_op(&parsed(&["search", "x", "--status", "done"])).ok().unwrap(), ("search", json!({ "text": "x", "status": "done" })));
    }

    #[test]
    fn stale_agent_json_is_not_trusted() {
        // (stale_file reads the real config dir; live_pid is the part that decides)
        assert!(live_pid(&json!({ "port": 1, "token": "t", "pid": std::process::id() })));
        assert!(live_pid(&json!({ "port": 1, "token": "t" })), "older files have no pid");
        assert!(!live_pid(&json!({ "port": 1, "token": "t", "pid": 4_000_000_000u64 })));
    }

    #[test]
    fn jsonrpc_edge_cases_and_tool_metadata() {
        assert_eq!(mcp_reply(&json!([{ "jsonrpc": "2.0", "id": 1, "method": "ping" }])).unwrap()["error"]["code"], -32600);
        assert_eq!(mcp_reply(&json!("x")).unwrap()["error"]["code"], -32600);
        assert!(mcp_reply(&json!({ "jsonrpc": "2.0", "id": 1, "result": {} })).is_none(), "a response to us gets no reply");
        let init = mcp_reply(&json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "1999-01-01" } })).unwrap();
        assert_eq!(init["result"]["protocolVersion"], "2025-06-18");
        let list = mcp_reply(&json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" })).unwrap();
        let tools = list["result"]["tools"].as_array().unwrap();
        assert!(tools.iter().all(|t| t["inputSchema"]["additionalProperties"] == json!(false) && t["annotations"]["readOnlyHint"].is_boolean()));
        let by = |n: &str| tools.iter().find(|t| t["name"] == n).unwrap();
        assert_eq!(by("list_tasks")["annotations"]["readOnlyHint"], true);
        assert_eq!(by("delete_task")["annotations"]["destructiveHint"], true);
        assert!(["list_lists", "list_tags"].iter().all(|n| tool_op(n).is_some()));
    }

    #[test]
    fn new_commands_and_structured_add_map_to_ops() {
        assert_eq!(to_op(&parsed(&["checkin", "Read", "book", "--delta", "-1", "--date", "2026-11-01"])).ok().unwrap(), ("checkin", json!({ "habit": "Read book", "delta": -1, "date": "2026-11-01" })));
        assert!(to_op(&parsed(&["checkin", "x", "--delta", "many"])).is_err());
        assert_eq!(to_op(&parsed(&["events", "--from", "2026-12-01", "--limit", "5"])).ok().unwrap(), ("events", json!({ "from": "2026-12-01", "limit": 5 })));
        assert_eq!(to_op(&parsed(&["focus"])).ok().unwrap(), ("focus", json!({})));
        let (_, args) = to_op(&parsed(&["add", "dentist", "--time", "14:30", "--duration", "45", "--tags", "a,b", "--priority", "high"])).ok().unwrap();
        assert_eq!(args, json!({ "text": "dentist", "time": "14:30", "priority": "high", "durationMin": 45, "tags": ["a", "b"] }));
        assert_eq!(to_op(&parsed(&["search", "x", "--archived"])).ok().unwrap(), ("search", json!({ "text": "x", "includeArchived": true })));
        let (_, args) = to_op(&parsed(&["update", "ab12", "--pin"])).ok().unwrap();
        assert_eq!(args, json!({ "id": "ab12", "pinned": true }));
        assert!(["check_in_habit", "list_events", "focus_status"].iter().all(|n| tool_op(n).is_some()));
    }

    #[test]
    fn replies_carry_the_instance_and_revision() {
        let v = stamp(&json!({ "ok": true, "data": { "total": 1 }, "instance": 42, "revision": 7 }));
        assert_eq!(v, json!({ "total": 1, "instance": 42, "revision": 7 }));
        assert_eq!(stamp(&json!({ "ok": true, "data": [1] })), json!([1]), "only objects are stamped");
    }

    #[test]
    fn a_running_but_silent_app_is_never_relaunched() {
        assert!(timeout_message(true, true).contains("running but not answering"));
        assert!(timeout_message(true, false).contains("stale"));
        assert!(timeout_message(false, false).contains("20 seconds"));
        let script = running_script(Path::new(r"C:\Users\o'brien\AppData\Local\Momentum\momentum.exe"));
        assert!(script.contains("-Name 'momentum'") && script.contains("o''brien"), "{script}");
    }

    #[test]
    fn a_cancelled_call_is_noticed_when_it_finishes() {
        let f = Inflight::default();
        let (a, b) = (json!(1), json!("x"));
        f.begin(&a);
        f.begin(&b);
        f.cancel(&a);
        f.cancel(&json!(99)); // not in flight: ignored
        assert!(f.finish(&a));
        assert!(!f.finish(&b));
        assert!(!f.finish(&a), "already finished");
    }

    #[test]
    fn usage_errors() {
        assert!(matches!(parse_args(vec!["list".into(), "--bogus".into(), "x".into()]), Err(Fail::Usage(_))));
        assert!(to_op(&parsed(&["update", "ab12"])).is_err());
        assert!(to_op(&parsed(&["done"])).is_err());
    }

    #[test]
    fn mcp_handshake_and_tools() {
        let init = mcp_reply(&json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "2025-03-26" } })).unwrap();
        assert_eq!(init["result"]["protocolVersion"], "2025-03-26");
        assert!(mcp_reply(&json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })).is_none());
        let list = mcp_reply(&json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" })).unwrap();
        let names: Vec<_> = list["result"]["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap()).collect();
        assert!(["list_tasks", "search_tasks", "get_task", "add_task", "update_task", "complete_task", "list_habits"].iter().all(|n| names.contains(n)));
        assert!(names.iter().all(|n| tool_op(n).is_some()));
        assert_eq!(mcp_reply(&json!({ "jsonrpc": "2.0", "id": 3, "method": "nope" })).unwrap()["error"]["code"], -32601);
    }
}
