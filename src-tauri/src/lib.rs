mod agent;
mod files;
mod net;
mod secrets;
mod voice;

use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WindowEvent,
};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_window_state::StateFlags;
use tauri_plugin_sql::{Migration, MigrationKind};

const DB_URL: &str = "sqlite:momentum.db";
const DB_FILE: &str = "momentum.db";
const KEEP_BACKUPS: usize = 10;

fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "settings",
            sql: include_str!("../migrations/0001_settings.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "tasks",
            sql: include_str!("../migrations/0002_tasks.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "calendar events",
            sql: include_str!("../migrations/0003_events.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "habits",
            sql: include_str!("../migrations/0004_habits.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "focus, countdowns, reminder log",
            sql: include_str!("../migrations/0005_focus_countdowns_reminders.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "rest days and celebrations",
            sql: include_str!("../migrations/0006_progress.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "nested folders",
            sql: include_str!("../migrations/0007_folder_parent.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "countdowns become calendar events",
            sql: include_str!("../migrations/0008_countdowns_to_events.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "sync outbox, state and triggers",
            sql: include_str!("../migrations/0009_sync.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "deadline, duration, someday, waiting; calendar subscriptions",
            sql: include_str!("../migrations/0010_planning_subscriptions.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 11,
            description: "sync: purge marker, set deltas for exdates and tags",
            sql: include_str!("../migrations/0011_sync_purge_sets.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

/// Copies the database aside when the app ships a migration the database hasn't seen.
/// Runs in `setup`, before the frontend opens the database (which is when the SQL plugin migrates).
/// The marker is only advanced after a successful copy, so a failed backup retries next launch.
fn backup_before_migrate(dir: &Path, latest: i64) -> std::io::Result<()> {
    let marker = dir.join("schema_version");
    let seen = fs::read_to_string(&marker).ok().and_then(|s| s.trim().parse::<i64>().ok());
    if seen == Some(latest) {
        return Ok(());
    }
    let db = dir.join(DB_FILE);
    if db.exists() {
        let backups = dir.join("backups");
        fs::create_dir_all(&backups)?;
        let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs());
        let name = format!("momentum-v{}-{stamp}.db", seen.unwrap_or(0));
        fs::copy(&db, backups.join(&name))?;
        // WAL sidecars hold committed pages that may not be checkpointed into the main file yet.
        for ext in ["-wal", "-shm"] {
            let side = dir.join(format!("{DB_FILE}{ext}"));
            if side.exists() {
                fs::copy(&side, backups.join(format!("{name}{ext}")))?;
            }
        }
        prune_backups(&backups)?;
    }
    fs::create_dir_all(dir)?;
    fs::write(marker, latest.to_string())
}

fn prune_backups(dir: &Path) -> std::io::Result<()> {
    let mut dbs: Vec<_> = fs::read_dir(dir)?
        .filter_map(Result::ok)
        .filter(|e| e.file_name().to_string_lossy().ends_with(".db"))
        .collect();
    dbs.sort_by_key(|e| e.metadata().and_then(|m| m.modified()).ok());
    let excess = dbs.len().saturating_sub(KEEP_BACKUPS);
    for old in &dbs[..excess] {
        let path = old.path();
        let _ = fs::remove_file(&path);
        for ext in ["-wal", "-shm"] {
            let _ = fs::remove_file(format!("{}{ext}", path.display()));
        }
    }
    Ok(())
}

/// Mirrors the "close to tray" setting (the frontend sets it after loading settings).
struct CloseToTray(AtomicBool);

#[tauri::command]
fn set_close_to_tray(state: tauri::State<CloseToTray>, enabled: bool) {
    state.0.store(enabled, Ordering::Relaxed);
}

/// Set once a quit has been requested, so the second exit request goes through.
static QUITTING: AtomicBool = AtomicBool::new(false);

/// Quits after the main window has saved pending settings (it answers `app:quit` with `quit_app`);
/// exits anyway after 1.5s if the page never answers.
fn request_quit<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if app.emit_to("main", "app:quit", ()).is_err() {
        return app.exit(0);
    }
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(1500));
        app.exit(0);
    });
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

/// Backup export, .ics import and Todoist/TickTick import: read or write a file the user picked in a
/// native dialog. Limited to the extensions the app uses so the command can't touch arbitrary files.
fn checked_path(p: &Path) -> Result<&Path, String> {
    match p.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()) {
        Some(ext) if ext == "json" || ext == "ics" || ext == "csv" => Ok(p),
        _ => Err("only .json, .ics and .csv files are supported".into()),
    }
}

#[tauri::command]
fn write_text_file(app: AppHandle, picked: tauri::State<files::Picked>, path: String, contents: String) -> Result<(), String> {
    write_atomic(checked_path(files::authorize(&app, &picked, &path)?)?, contents.as_bytes())
}

/// Writes next to the target and renames, so a failed write cannot destroy an earlier file (RUST-12).
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    let result = fs::write(&tmp, bytes).and_then(|()| fs::rename(&tmp, path));
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result.map_err(|e| e.to_string())
}

const PNG_MAGIC: &[u8] = &[0x89, b'P', b'N', b'G'];
const MAX_PNG_BYTES: usize = 8 * 1024 * 1024;

/// Statistics share card: PNG bytes to a path the user picked, which must be a .png (D93).
fn check_png(path: &str, bytes: &[u8]) -> Result<(), String> {
    let png = Path::new(path).extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("png"));
    if !png {
        return Err("only .png files are supported".into());
    }
    if bytes.len() > MAX_PNG_BYTES || !bytes.starts_with(PNG_MAGIC) {
        return Err("not a PNG image, or too large".into());
    }
    Ok(())
}

#[tauri::command]
fn write_png(app: AppHandle, picked: tauri::State<files::Picked>, path: String, bytes: Vec<u8>) -> Result<(), String> {
    files::authorize(&app, &picked, &path)?;
    check_png(&path, &bytes)?;
    write_atomic(Path::new(&path), &bytes)
}

const MAX_TEXT_BYTES: u64 = 64 * 1024 * 1024;

#[tauri::command]
fn read_text_file(app: AppHandle, picked: tauri::State<files::Picked>, path: String) -> Result<String, String> {
    let p = checked_path(files::authorize(&app, &picked, &path)?)?;
    if fs::metadata(p).map_err(|e| e.to_string())?.len() > MAX_TEXT_BYTES {
        return Err("that file is larger than 64 MB".into());
    }
    fs::read_to_string(p).map_err(|e| e.to_string())
}

/// Where manual and pre-migration backups go (created on demand).
#[tauri::command]
fn backups_dir(app: AppHandle) -> Result<String, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?.join("backups");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Bring the main window back from the tray / background.
fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Physical-pixel rectangle: (x, y, width, height).
type Rect = (i32, i32, u32, u32);

/// Shrinks `win` to fit inside `area` and slides it fully in; `center` ignores `win`'s position.
fn fit_rect(win: Rect, area: Rect, center: bool) -> Rect {
    let (w, h) = (win.2.min(area.2), win.3.min(area.3));
    let x = if center { area.0 + (area.2 - w) as i32 / 2 } else { win.0.clamp(area.0, area.0 + (area.2 - w) as i32) };
    let y = if center { area.1 + (area.3 - h) as i32 / 2 } else { win.1.clamp(area.1, area.1 + (area.3 - h) as i32) };
    (x, y, w, h)
}

/// Keeps the main window inside the monitor's work area (the part not covered by the taskbar).
/// A first launch is centered; a restored window only moves or shrinks if it does not fit.
/// A maximized window is left to the OS.
fn fit_main_to_work_area(app: &tauri::App, first_run: bool) -> tauri::Result<()> {
    let Some(w) = app.get_webview_window("main") else { return Ok(()) };
    if w.is_maximized()? {
        return Ok(());
    }
    let Some(m) = w.current_monitor()?.or(w.primary_monitor()?) else { return Ok(()) };
    let (a, p, s) = (m.work_area(), w.outer_position()?, w.outer_size()?);
    let (x, y, width, height) = fit_rect((p.x, p.y, s.width, s.height), (a.position.x, a.position.y, a.size.width, a.size.height), first_run);
    w.set_size(tauri::PhysicalSize::new(width, height))?;
    w.set_position(tauri::PhysicalPosition::new(x, y))
}

fn show_quick_add(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("quickadd") {
        let _ = w.center();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Shows the mini window, or hides it when it is already up (tray, header button and hotkey).
#[tauri::command]
fn toggle_mini(app: AppHandle) {
    let Some(w) = app.get_webview_window("mini") else { return };
    if w.is_visible().unwrap_or(false) {
        let _ = w.hide();
    } else {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Opens a list in its own read-only window (FEAT-27). The view id is checked: it ends up in a URL.
#[tauri::command]
async fn open_pop_window(app: AppHandle, view: String) -> Result<(), String> {
    if view.is_empty() || !view.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, ':' | '_' | '-')) {
        return Err("invalid view".into());
    }
    static NEXT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(1);
    let label = format!("pop-{}", NEXT.fetch_add(1, Ordering::Relaxed));
    tauri::WebviewWindowBuilder::new(&app, label, tauri::WebviewUrl::App(format!("index.html?window=pop&view={view}").into()))
        .title("Momentum")
        .inner_size(340.0, 520.0)
        .min_inner_size(260.0, 300.0)
        .decorations(false)
        .always_on_top(true)
        .disable_drag_drop_handler()
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Momentum", true, None::<&str>)?;
    let quick = MenuItem::with_id(app, "quick", "Quick add…", true, None::<&str>)?;
    let mini = MenuItem::with_id(app, "mini", "Mini window", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Momentum", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quick, &mini, &PredefinedMenuItem::separator(app)?, &quit])?;
    let mut tray = TrayIconBuilder::with_id("momentum")
        .tooltip("Momentum")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main(app),
            "quick" => show_quick_add(app),
            "mini" => toggle_mini(app.clone()),
            // Real quit: bypasses the window's close-to-tray handler.
            "quit" => request_quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                // Click toggles the quick view (Today, timer, matrix); "Open Momentum" stays in the menu (FEAT-18).
                toggle_mini(tray.app_handle().clone());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // reqwest is built with `rustls-no-provider` (via the updater), and only the updater installed a
    // provider, lazily: a calendar refresh or voice download before the update check panicked. Once, here.
    let _ = rustls::crypto::ring::default_provider().install_default();
    // webkit2gtk's DMA-BUF renderer shows a blank window under many Linux GPU/driver combinations
    // (AppImage especially); the software path is fast enough for this UI. Respect an explicit choice.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        // SAFETY: still single-threaded, before the runtime and any webview exist.
        unsafe { std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1") };
    }
    let migrations = migrations();
    let latest = migrations.iter().map(|m| m.version).max().unwrap_or(0);
    tauri::Builder::default()
        // Must be first: a second launch (e.g. from the Start menu while in the tray) focuses the
        // running instance instead of opening the database twice and double-firing reminders.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DB_URL, migrations)
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // Size, position and maximized survive restarts. The main window starts hidden and is shown
        // in `setup` once it has been fitted to the work area; popups are placed by their own code.
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)
                .with_denylist(&["quickadd", "reminder"])
                .build(),
        )
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--minimized"])))
        .manage(CloseToTray(AtomicBool::new(true)))
        .manage(voice::Voice::default())
        .manage(files::Picked::default())
        .manage(agent::Agent::default())
        // A reload or crash recovery drops the main window's agent listener until it registers again (AGENT-08).
        .on_page_load(|webview, payload| {
            if webview.label() == "main" && matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                agent::page_loading(webview.app_handle());
            }
        })
        .invoke_handler(tauri::generate_handler![
            set_close_to_tray,
            quit_app,
            agent::agent_reply,
            agent::agent_ready,
            agent::agent_cli_info,
            agent::agent_cli_path,
            secrets::secret_get,
            secrets::secret_set,
            secrets::secret_delete,
            toggle_mini,
            open_pop_window,
            write_text_file,
            write_png,
            read_text_file,
            backups_dir,
            files::image_dir,
            files::pick_path,
            files::import_image,
            files::write_image,
            files::list_images,
            files::delete_image,
            files::write_backup_zip,
            files::write_auto_backup,
            files::read_backup_zip,
            files::restore_backup_attachments,
            net::fetch_ics,
            voice::voice_model_status,
            voice::voice_download,
            voice::voice_cancel_download,
            voice::voice_remove,
            voice::voice_start,
            voice::voice_input_devices,
            voice::voice_stop,
            voice::voice_cancel
        ])
        // Closing the main window either hides it to the tray or quits the whole app. The hidden
        // popup windows would otherwise keep the process alive with no way back in.
        .on_window_event(|window, event| {
            // A popup closed by Alt+F4 or Cmd+W would be destroyed and could never be shown again.
            if window.label() != "main" {
                // Pop-out windows are created on demand, so closing one really closes it.
                if window.label().starts_with("pop-") {
                    return;
                }
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
                return;
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.state::<CloseToTray>().0.load(Ordering::Relaxed) {
                    api.prevent_close();
                    let _ = window.hide();
                } else {
                    api.prevent_close();
                    request_quit(window.app_handle());
                }
            }
        })
        .setup(move |app| {
            // A failed backup or tray must not stop the app from opening; the backup retries next launch.
            if let Err(e) = backup_before_migrate(&app.path().app_config_dir()?, latest) {
                eprintln!("could not back up the database before migrating: {e}");
            }
            if let Err(e) = build_tray(app) {
                eprintln!("could not build the tray icon: {e}");
            }
            // Agents (D264): a failure here only turns the CLI off.
            if let Err(e) = agent::start(app.handle()) {
                eprintln!("could not start the agent API: {e}");
                // The window isn't up to hear an event yet; it asks in `agent_ready` and shows a toast.
                agent::note_start_error(app.handle(), e.to_string());
            }
            // Without it images don't show, but the app still works.
            if let Err(e) = files::allow_asset_dirs(app.handle()) {
                eprintln!("could not allow the image folders: {e}");
            }
            let first_run = !app.path().app_config_dir()?.join(".window-state.json").exists();
            // The window starts hidden; a failed fit must not keep it that way (D76).
            if let Err(e) = fit_main_to_work_area(app, first_run) {
                eprintln!("could not fit the main window to the work area: {e}");
            }
            // Launched at login: start in the tray so reminders run without a window popping up.
            if !std::env::args().any(|a| a == "--minimized") {
                show_main(app.handle());
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Momentum")
        .run(|_app, _event| {
            // Cmd+Q, Dock > Quit and OS shutdown: let the main window flush settings first (once).
            if let tauri::RunEvent::ExitRequested { api, code: None, .. } = &_event {
                if !QUITTING.swap(true, Ordering::Relaxed) {
                    api.prevent_exit();
                    request_quit(_app);
                }
            }
            if let tauri::RunEvent::Exit = _event {
                agent::stop(_app);
            }
            // Clicking the Dock icon while the window is hidden in the menu bar (close-to-tray).
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = _event {
                show_main(_app);
            }
        });
}

#[cfg(test)]
mod tests {
    use super::{check_png, fit_rect, write_atomic};

    #[test]
    fn atomic_write_replaces_and_leaves_no_temp() {
        let dir = std::env::temp_dir().join(format!("momentum-atomic-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let f = dir.join("a.json");
        std::fs::write(&f, "old").unwrap();
        write_atomic(&f, b"new").unwrap();
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "new");
        assert!(!dir.join("a.json.tmp").exists());
        // A missing folder fails without touching anything.
        assert!(write_atomic(&dir.join("nope").join("a.json"), b"x").is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn png_writes_are_validated() {
        let png = [0x89, b'P', b'N', b'G', 1];
        assert!(check_png("a/card.PNG", &png).is_ok());
        assert!(check_png("a/card.json", &png).is_err());
        assert!(check_png("a/card.png", b"nope").is_err());
        assert!(check_png("a/card.png", &vec![0u8; 9 * 1024 * 1024]).is_err());
    }

    const AREA: (i32, i32, u32, u32) = (0, 0, 1366, 728);

    #[test]
    fn shrinks_to_the_work_area() {
        assert_eq!(fit_rect((100, 100, 1280, 820), AREA, false), (86, 0, 1280, 728));
    }
    #[test]
    fn leaves_a_window_that_fits() {
        assert_eq!(fit_rect((50, 20, 900, 600), AREA, false), (50, 20, 900, 600));
    }
    #[test]
    fn pulls_an_offscreen_window_back() {
        assert_eq!(fit_rect((5000, -300, 900, 600), AREA, false), (466, 0, 900, 600));
    }
    #[test]
    fn centers_on_first_run_in_a_secondary_monitor() {
        assert_eq!(fit_rect((0, 0, 1280, 820), (1920, 0, 1920, 1040), true), (2240, 110, 1280, 820));
    }
}
