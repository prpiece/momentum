//! `momentum`: the command line and MCP server for the Momentum planner (ADR 0007, D264).
//! Every command is one request to the localhost API of the running app (see `src-tauri/src/agent.rs`);
//! it never opens the database. If the app isn't running it is started in the tray first.
//! Exit codes: 0 ok, 1 error, 2 usage.

use serde_json::{json, Map, Value};
use std::{
    io::{BufRead, Read, Write},
    net::TcpStream,
    path::PathBuf,
    process::{Command, Stdio},
    time::{Duration, Instant},
};

const APP_ID: &str = "com.momentum.planner";
const START_WAIT: Duration = Duration::from_secs(20);

const HELP: &str = "momentum: talk to your running Momentum app

Usage: momentum <command> [options]

  list [view]                 view: today (default), inbox, upcoming, someday, waiting, a list name, or a filter like \"#work !high\"
  search <text>
  get <id>
  add <text...>               quick-add text: \"call mom by fri 15m !high #family ~Home\"
        [--list L] [--parent ID]
  update <id> [--title T] [--notes N] [--date YYYY-MM-DD|someday|none] [--deadline YYYY-MM-DD|none]
              [--duration 15|1h30m|none] [--priority none|low|medium|high] [--list L] [--tags a,b]
  done <id>                   complete a task
  reopen <id>
  habits                      habits with today's status
  mcp                         serve MCP over stdio (for Claude Code, Cursor, Codex, Gemini CLI...)

Options: --json (machine-readable output), --limit N (list, search), -h/--help.
Ids may be shortened to their first 4+ characters. If Momentum isn't running it is started in the tray.
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

fn endpoint() -> Option<Endpoint> {
    let text = std::fs::read_to_string(config_dir()?.join("agent.json")).ok()?;
    let v: Value = serde_json::from_str(&text).ok()?;
    Some(Endpoint { port: v["port"].as_u64()?, token: v["token"].as_str()?.to_string() })
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
        Ok(v["data"].clone())
    } else {
        Err(CallError::Failed(v["error"].as_str().unwrap_or("request failed").to_string()))
    }
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
    let mut launched = false;
    let started = Instant::now();
    loop {
        match try_call(op, args) {
            Ok(v) => return Ok(v),
            Err(CallError::Failed(m)) => return err(m),
            Err(e) => {
                if matches!(e, CallError::Unreachable) && !launched {
                    eprintln!("Starting Momentum in the tray...");
                    launch_app()?;
                    launched = true;
                }
                if started.elapsed() > START_WAIT {
                    return err("Momentum didn't answer within 20 seconds. Is it running?");
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

const VALUE_FLAGS: &[&str] = &["list", "parent", "title", "notes", "date", "deadline", "duration", "priority", "tags", "limit"];

fn parse_args(args: Vec<String>) -> R<Parsed> {
    let (mut cmd, mut pos, mut flags, mut json) = (None, Vec::new(), Map::new(), false);
    let mut it = args.into_iter();
    while let Some(a) = it.next() {
        if a == "--json" {
            json = true;
        } else if a == "-h" || a == "--help" {
            cmd = Some("help".to_string());
        } else if let Some(f) = a.strip_prefix("--") {
            let (name, inline) = match f.split_once('=') {
                Some((n, v)) => (n, Some(v.to_string())),
                None => (f, None),
            };
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
        Some((h, m)) => (h.parse::<u64>().ok()?, m.trim_end_matches('m')),
        None => (0, s.trim_end_matches('m')),
    };
    let m = if m.is_empty() { 0 } else { m.parse::<u64>().ok()? };
    Some(json!(h * 60 + m))
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
    Ok(match p.cmd.as_str() {
        "list" => {
            let mut m = Map::new();
            if !p.pos.is_empty() {
                m.insert("view".into(), json!(p.pos.join(" ")));
            }
            limit(&mut m)?;
            ("list", Value::Object(m))
        }
        "search" => {
            if p.pos.is_empty() {
                return usage("momentum search <text>");
            }
            let mut m = Map::new();
            m.insert("text".into(), json!(p.pos.join(" ")));
            limit(&mut m)?;
            ("search", Value::Object(m))
        }
        "get" => ("get", json!({ "id": one_id(p)? })),
        "done" | "complete" => ("complete", json!({ "id": one_id(p)? })),
        "reopen" => ("reopen", json!({ "id": one_id(p)? })),
        "habits" => ("habits", json!({})),
        "add" => {
            if p.pos.is_empty() {
                return usage("momentum add <text...> [--list L] [--parent ID]");
            }
            let mut m = Map::new();
            m.insert("text".into(), json!(p.pos.join(" ")));
            for (flag, key) in [("list", "list"), ("parent", "parentId")] {
                if let Some(v) = p.flags.get(flag) {
                    m.insert(key.into(), v.clone());
                }
            }
            ("add", Value::Object(m))
        }
        "update" => {
            let mut m = Map::new();
            m.insert("id".into(), json!(one_id(p)?));
            for (flag, key) in [("title", "title"), ("notes", "description"), ("date", "date"), ("deadline", "deadline"), ("priority", "priority"), ("list", "list")] {
                if let Some(v) = p.flags.get(flag) {
                    m.insert(key.into(), v.clone());
                }
            }
            if let Some(d) = p.flags.get("duration") {
                m.insert("durationMin".into(), minutes(d.as_str().unwrap_or("")).ok_or_else(|| Fail::Usage("--duration looks like 15, 1h30m or none".into()))?);
            }
            if let Some(t) = p.flags.get("tags") {
                let tags: Vec<_> = t.as_str().unwrap_or("").split(',').map(str::trim).filter(|s| !s.is_empty()).collect();
                m.insert("tags".into(), json!(tags));
            }
            if m.len() == 1 {
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
        "tags": { "type": "array", "items": { "type": "string" }, "description": "Replaces the task's tags." }
    });
    let id = json!({ "id": { "type": "string", "description": "Task id from list_tasks (4+ leading characters are enough)." } });
    let mut update_props = task_fields.as_object().cloned().unwrap_or_default();
    update_props.extend(id.as_object().cloned().unwrap_or_default());
    json!([
        { "name": "list_tasks", "description": "List open tasks in a view: today, inbox, upcoming, someday, waiting, a list name, or a filter such as \"#work !high overdue\". Defaults to today.",
          "inputSchema": { "type": "object", "properties": { "view": { "type": "string" }, "limit": { "type": "integer", "minimum": 1, "maximum": 200 } } } },
        { "name": "search_tasks", "description": "Find tasks (open and finished) whose title or notes contain the words.",
          "inputSchema": { "type": "object", "properties": { "text": { "type": "string" }, "limit": { "type": "integer", "minimum": 1, "maximum": 200 } }, "required": ["text"] } },
        { "name": "get_task", "description": "One task with its subtasks.", "inputSchema": { "type": "object", "properties": id, "required": ["id"] } },
        { "name": "add_task", "description": "Add a task from quick-add text: dates, times, durations, !priority, #tags, ~List and repeats are picked out, e.g. \"call mom by fri 15m !high #family\".",
          "inputSchema": { "type": "object", "properties": { "text": { "type": "string" }, "list": { "type": "string", "description": "List name (default Inbox)." }, "parentId": { "type": "string", "description": "Make it a subtask of this task." } }, "required": ["text"] } },
        { "name": "update_task", "description": "Change fields of a task. Only the fields given change.",
          "inputSchema": { "type": "object", "properties": update_props, "required": ["id"] } },
        { "name": "complete_task", "description": "Mark a task done (a recurring task completes its current occurrence).", "inputSchema": { "type": "object", "properties": id, "required": ["id"] } },
        { "name": "reopen_task", "description": "Reopen a finished task.", "inputSchema": { "type": "object", "properties": id, "required": ["id"] } },
        { "name": "list_habits", "description": "Habits with today's progress and streak.", "inputSchema": { "type": "object", "properties": {} } }
    ])
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
        "list_habits" => "habits",
        _ => return None,
    })
}

fn mcp_reply(msg: &Value) -> Option<Value> {
    let id = msg.get("id")?.clone(); // a notification has no id and gets no answer
    let ok = |result: Value| Some(json!({ "jsonrpc": "2.0", "id": id, "result": result }));
    let fail = |code: i64, m: &str| Some(json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": m } }));
    match msg["method"].as_str().unwrap_or("") {
        "initialize" => ok(json!({
            "protocolVersion": msg["params"]["protocolVersion"].as_str().unwrap_or("2025-06-18"),
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "momentum", "version": env!("CARGO_PKG_VERSION") },
            "instructions": "Momentum is the user's local planner. Use these tools to read and change their tasks and habits; changes appear in the app at once."
        })),
        "ping" => ok(json!({})),
        "tools/list" => ok(json!({ "tools": tools() })),
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

fn serve_mcp() -> R<()> {
    eprintln!("momentum mcp: serving on stdio");
    let (stdin, mut out) = (std::io::stdin(), std::io::stdout());
    for line in stdin.lock().lines() {
        let line = line.map_err(|e| Fail::Error(e.to_string()))?;
        if line.trim().is_empty() {
            continue;
        }
        let reply = match serde_json::from_str::<Value>(&line) {
            Ok(msg) => mcp_reply(&msg),
            Err(_) => Some(json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32700, "message": "parse error" } })),
        };
        if let Some(r) = reply {
            let _ = writeln!(out, "{r}");
            let _ = out.flush();
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
