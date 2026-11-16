//! Image files the app keeps in its config dir: note attachments (D78).
//! The webview reads them through the asset protocol (scoped to that folder); every
//! write goes through these commands, which validate the folder, the name and the size.

use std::{
    collections::HashSet,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::UNIX_EPOCH,
};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

/// Paths the user chose in a native dialog this session (RUST-09). The file commands that take a
/// path from the webview only accept these, or paths inside the app's own config folder.
#[derive(Default)]
pub struct Picked(Mutex<HashSet<PathBuf>>);

/// The path as a `Path` if the user picked it in a dialog this session or it is inside the app config dir.
pub fn authorize<'a>(app: &AppHandle, picked: &Picked, path: &'a str) -> Result<&'a Path, String> {
    let p = Path::new(path);
    let plain = !p.components().any(|c| matches!(c, std::path::Component::ParentDir));
    let own = app.path().app_config_dir().is_ok_and(|d| p.starts_with(d));
    if (plain && own) || picked.0.lock().unwrap().contains(p) {
        Ok(p)
    } else {
        Err("that file wasn't chosen in a file dialog".into())
    }
}

/// Native open/save dialog. The returned path is remembered so the file commands accept it. A save
/// path with no extension gets the first one of `extensions`.
#[tauri::command]
pub async fn pick_path(app: AppHandle, picked: State<'_, Picked>, save: bool, name: String, extensions: Vec<String>, default_name: Option<String>) -> Result<Option<String>, String> {
    let exts: Vec<&str> = extensions.iter().map(String::as_str).collect();
    let mut dialog = app.dialog().file().add_filter(name, &exts);
    if let Some(n) = default_name {
        dialog = dialog.set_file_name(n);
    }
    let chosen = tauri::async_runtime::spawn_blocking(move || if save { dialog.blocking_save_file() } else { dialog.blocking_pick_file() })
        .await
        .map_err(|e| e.to_string())?;
    let Some(chosen) = chosen else { return Ok(None) };
    let mut path = chosen.into_path().map_err(|e| e.to_string())?;
    if save && path.extension().is_none() {
        if let Some(e) = extensions.first() {
            path.set_extension(e);
        }
    }
    picked.0.lock().unwrap().insert(path.clone());
    Ok(Some(path.to_string_lossy().into_owned()))
}

pub const MAX_IMAGE_BYTES: u64 = 10 * 1024 * 1024;
/// Note images (D78) and the app background image (D222). Backups carry both.
const FOLDERS: [&str; 2] = ["attachments", "backgrounds"];
// pdf and txt are file attachments (FEAT-25): previewed in the app, kept on this device only (not synced).
const EXTS: [&str; 7] = ["png", "jpg", "jpeg", "gif", "webp", "pdf", "txt"];

/// `kind` is a folder name; `name` is `<id>.<ext>` with a plain id and an image extension.
fn image_path(app: &AppHandle, kind: &str, name: &str) -> Result<PathBuf, String> {
    Ok(dir(app, kind)?.join(valid_name(name)?))
}

fn dir(app: &AppHandle, kind: &str) -> Result<PathBuf, String> {
    if !FOLDERS.contains(&kind) {
        return Err(format!("unknown file folder: {kind}"));
    }
    let d = app.path().app_config_dir().map_err(|e| e.to_string())?.join(kind);
    fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

fn valid_name(name: &str) -> Result<&str, String> {
    let (id, ext) = name.rsplit_once('.').ok_or("file name needs an extension")?;
    let id_ok = !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if id_ok && EXTS.contains(&ext.to_ascii_lowercase().as_str()) {
        Ok(name)
    } else {
        Err(format!("not an allowed image name: {name}"))
    }
}

/// Lets the webview read the attachments folder over the asset protocol. Granted at startup with the exact
/// path the commands write to; the static `$APPCONFIG/...` glob in tauri.conf.json returned 403 on Windows.
/// (The `backgrounds/` folder of v0.9 is no longer deleted: backgrounds are back, D222.)
pub fn allow_asset_dirs(app: &AppHandle) -> Result<(), String> {
    for kind in FOLDERS {
        app.asset_protocol_scope().allow_directory(dir(app, kind)?, true).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Folder path, so the frontend can build asset URLs (`convertFileSrc`).
#[tauri::command]
pub fn image_dir(app: AppHandle, kind: String) -> Result<String, String> {
    Ok(dir(&app, &kind)?.to_string_lossy().into_owned())
}

const IMAGE_SRC_EXTS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif", "pdf", "txt"];

/// Copy a file the user picked (dialog) into the folder as `name`.
#[tauri::command]
pub fn import_image(app: AppHandle, picked: State<Picked>, kind: String, name: String, src: String) -> Result<(), String> {
    authorize(&app, &picked, &src)?;
    let ext = Path::new(&src).extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase);
    if !ext.is_some_and(|e| IMAGE_SRC_EXTS.contains(&e.as_str())) {
        return Err("that is not an image file".into());
    }
    let size = fs::metadata(&src).map_err(|e| e.to_string())?.len();
    if size > MAX_IMAGE_BYTES {
        return Err("image is larger than 10 MB".into());
    }
    fs::copy(&src, image_path(&app, &kind, &name)?).map(|_| ()).map_err(|e| e.to_string())
}

/// Write pasted or dropped image bytes into the folder as `name`.
#[tauri::command]
pub fn write_image(app: AppHandle, kind: String, name: String, bytes: Vec<u8>) -> Result<(), String> {
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err("image is larger than 10 MB".into());
    }
    fs::write(image_path(&app, &kind, &name)?, bytes).map_err(|e| e.to_string())
}

/// Files in the folder with their modified time (unix seconds), for cleanup.
#[tauri::command]
pub fn list_images(app: AppHandle, kind: String) -> Result<Vec<(String, u64)>, String> {
    let mut out = Vec::new();
    for entry in fs::read_dir(dir(&app, &kind)?).map_err(|e| e.to_string())?.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if valid_name(&name).is_err() {
            continue;
        }
        let modified = entry.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_secs());
        out.push((name, modified));
    }
    Ok(out)
}

#[tauri::command]
pub fn delete_image(app: AppHandle, kind: String, name: String) -> Result<(), String> {
    match fs::remove_file(image_path(&app, &kind, &name)?) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

// ---- .zip backups (D78): the JSON export plus `attachments/<file>` and `backgrounds/<file>` ----

const JSON_ENTRY: &str = "momentum-backup.json";
const MAX_JSON_BYTES: u64 = 512 * 1024 * 1024;

type AnyResult<T> = Result<T, Box<dyn std::error::Error>>;

fn zip_path(path: &str) -> Result<&Path, String> {
    let p = Path::new(path);
    match p.extension().and_then(|e| e.to_str()) {
        Some(e) if e.eq_ignore_ascii_case("zip") => Ok(p),
        _ => Err("only .zip files are supported".into()),
    }
}

/// Builds the zip beside the target and renames it into place, so a failure keeps an earlier file (RUST-12).
fn zip_backup(zip_file: &Path, json: &str, folders: &[(&str, &Path)]) -> AnyResult<()> {
    let mut tmp = zip_file.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = std::path::PathBuf::from(tmp);
    let built = zip_backup_to(&tmp, json, folders).and_then(|()| Ok(fs::rename(&tmp, zip_file)?));
    if built.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    built
}

fn zip_backup_to(zip_file: &Path, json: &str, folders: &[(&str, &Path)]) -> AnyResult<()> {
    let mut zip = zip::ZipWriter::new(fs::File::create(zip_file)?);
    zip.start_file(JSON_ENTRY, zip::write::SimpleFileOptions::default())?;
    zip.write_all(json.as_bytes())?;
    // Images are already compressed, so they are stored as-is.
    let stored = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    for (kind, dir) in folders {
        for entry in fs::read_dir(dir)?.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if valid_name(&name).is_ok() && entry.metadata()?.is_file() {
                zip.start_file(format!("{kind}/{name}"), stored)?;
                std::io::copy(&mut fs::File::open(entry.path())?, &mut zip)?;
            }
        }
    }
    zip.finish()?;
    Ok(())
}

fn unzip_json(zip_file: &Path) -> AnyResult<String> {
    let mut archive = zip::ZipArchive::new(fs::File::open(zip_file)?)?;
    let mut text = String::new();
    archive.by_name(JSON_ENTRY)?.take(MAX_JSON_BYTES).read_to_string(&mut text)?;
    Ok(text)
}

/// Restores entries `<kind>/<valid image name>` of at most 10 MB; anything else is skipped.
fn unzip_images(zip_file: &Path, kind: &str, att_dir: &Path) -> AnyResult<u32> {
    let prefix = format!("{kind}/");
    let mut archive = zip::ZipArchive::new(fs::File::open(zip_file)?)?;
    let mut restored = 0;
    for i in 0..archive.len() {
        let entry = archive.by_index(i)?;
        let Some(name) = entry.name()?.strip_prefix(prefix.as_str()).filter(|n| valid_name(n).is_ok()).map(str::to_owned) else { continue };
        let mut bytes = Vec::new();
        entry.take(MAX_IMAGE_BYTES + 1).read_to_end(&mut bytes)?;
        if bytes.len() as u64 <= MAX_IMAGE_BYTES {
            fs::write(att_dir.join(name), bytes)?;
            restored += 1;
        }
    }
    Ok(restored)
}

#[tauri::command]
pub fn write_backup_zip(app: AppHandle, picked: State<Picked>, path: String, json: String) -> Result<(), String> {
    authorize(&app, &picked, &path)?;
    let (att, bg) = (dir(&app, "attachments")?, dir(&app, "backgrounds")?);
    zip_backup(zip_path(&path)?, &json, &[("attachments", &att), ("backgrounds", &bg)]).map_err(|e| e.to_string())
}

/// Scheduled backup (FEAT-06): a zip named `momentum-auto-<stamp>.zip` in the app's `backups` folder, then the oldest
/// automatic ones beyond `keep` are deleted. Needs no picked path: the folder is fixed and the name is validated.
#[tauri::command]
pub fn write_auto_backup(app: AppHandle, name: String, json: String, keep: usize) -> Result<String, String> {
    let stamp_ok = name.len() <= 40 && name.chars().all(|c| c.is_ascii_digit() || c == '-');
    if !stamp_ok {
        return Err("bad backup name".into());
    }
    let backups = app.path().app_config_dir().map_err(|e| e.to_string())?.join("backups");
    fs::create_dir_all(&backups).map_err(|e| e.to_string())?;
    let (att, bg) = (dir(&app, "attachments")?, dir(&app, "backgrounds")?);
    let file = backups.join(format!("momentum-auto-{name}.zip"));
    zip_backup(&file, &json, &[("attachments", &att), ("backgrounds", &bg)]).map_err(|e| e.to_string())?;
    let mut autos: Vec<_> = fs::read_dir(&backups)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter(|e| {
            let n = e.file_name().to_string_lossy().into_owned();
            n.starts_with("momentum-auto-") && n.ends_with(".zip")
        })
        .map(|e| e.path())
        .collect();
    autos.sort(); // the stamp sorts oldest first
    let excess = autos.len().saturating_sub(keep.clamp(1, 60));
    for old in &autos[..excess] {
        let _ = fs::remove_file(old);
    }
    Ok(file.to_string_lossy().into_owned())
}

/// The backup's JSON text; nothing is restored until the user confirms.
#[tauri::command]
pub fn read_backup_zip(app: AppHandle, picked: State<Picked>, path: String) -> Result<String, String> {
    authorize(&app, &picked, &path)?;
    unzip_json(zip_path(&path)?).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn restore_backup_attachments(app: AppHandle, picked: State<Picked>, path: String) -> Result<u32, String> {
    authorize(&app, &picked, &path)?;
    let zip = zip_path(&path)?;
    let att = unzip_images(zip, "attachments", &dir(&app, "attachments")?).map_err(|e| e.to_string())?;
    Ok(att + unzip_images(zip, "backgrounds", &dir(&app, "backgrounds")?).map_err(|e| e.to_string())?)
}

#[cfg(test)]
mod tests {
    use super::{unzip_images, unzip_json, valid_name, zip_backup};
    use std::{fs, io::Write};

    #[test]
    fn zip_round_trips_json_and_valid_attachments_only() {
        let base = std::env::temp_dir().join(format!("momentum-zip-test-{}", std::process::id()));
        let (src, dst) = (base.join("src"), base.join("dst"));
        fs::create_dir_all(&src).unwrap();
        fs::create_dir_all(&dst).unwrap();
        fs::write(src.join("a1.png"), b"png-bytes").unwrap();
        fs::write(src.join("notes.exe"), b"skip me").unwrap();
        let zip_file = base.join("b.zip");
        zip_backup(&zip_file, "{\"x\":1}", &[("attachments", &src)]).unwrap();
        // Add a hostile entry by hand: it must not be restored.
        let mut extra = zip::ZipWriter::new_append(fs::OpenOptions::new().read(true).write(true).open(&zip_file).unwrap()).unwrap();
        extra.start_file("attachments/../evil.png", zip::write::SimpleFileOptions::default()).unwrap();
        extra.write_all(b"x").unwrap();
        extra.finish().unwrap();

        assert_eq!(unzip_json(&zip_file).unwrap(), "{\"x\":1}");
        assert_eq!(unzip_images(&zip_file, "attachments", &dst).unwrap(), 1);
        assert_eq!(fs::read(dst.join("a1.png")).unwrap(), b"png-bytes");
        assert!(!dst.join("notes.exe").exists() && !base.join("evil.png").exists());
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn accepts_plain_ids_with_image_extensions() {
        assert!(valid_name("a1b2-c3_d.png").is_ok());
        assert!(valid_name("X.JPG").is_ok());
    }

    #[test]
    fn rejects_paths_and_other_files() {
        for bad in ["../x.png", "a/b.png", "a\\b.png", "x.exe", "x", ".png", "x.png.exe", "a b.png"] {
            assert!(valid_name(bad).is_err(), "{bad}");
        }
    }
}
