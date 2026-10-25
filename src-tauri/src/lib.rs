use std::{
    fs,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = migrations();
    let latest = migrations.iter().map(|m| m.version).max().unwrap_or(0);
    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DB_URL, migrations)
                .build(),
        )
        .setup(move |app| {
            backup_before_migrate(&app.path().app_config_dir()?, latest)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Momentum");
}
