use std::{
    fs,
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WindowEvent,
};
use tauri_plugin_autostart::MacosLauncher;
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
        fs::remove_file(&path)?;
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

/// Bring the main window back from the tray / background.
fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn show_quick_add(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("quickadd") {
        let _ = w.center();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Momentum", true, None::<&str>)?;
    let quick = MenuItem::with_id(app, "quick", "Quick add…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Momentum", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quick, &PredefinedMenuItem::separator(app)?, &quit])?;
    let mut tray = TrayIconBuilder::with_id("momentum")
        .tooltip("Momentum")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main(app),
            "quick" => show_quick_add(app),
            // Real quit: bypasses the window's close-to-tray handler.
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
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
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--minimized"])))
        .manage(CloseToTray(AtomicBool::new(true)))
        .invoke_handler(tauri::generate_handler![set_close_to_tray])
        // Closing the main window either hides it to the tray or quits the whole app. The hidden
        // popup windows would otherwise keep the process alive with no way back in.
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.state::<CloseToTray>().0.load(Ordering::Relaxed) {
                    api.prevent_close();
                    let _ = window.hide();
                } else {
                    window.app_handle().exit(0);
                }
            }
        })
        .setup(move |app| {
            backup_before_migrate(&app.path().app_config_dir()?, latest)?;
            build_tray(app)?;
            // Launched at login: start in the tray so reminders run without a window popping up.
            if std::env::args().any(|a| a == "--minimized") {
                if let Some(w) = app.get_webview_window("main") {
                    w.hide()?;
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Momentum");
}
