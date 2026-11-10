//! Image files the app keeps in its config dir: note attachments (D78).
//! The webview reads them through the asset protocol (scoped to that folder); every
//! write goes through these commands, which validate the folder, the name and the size.

use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};
use tauri::{AppHandle, Manager};

pub const MAX_IMAGE_BYTES: u64 = 10 * 1024 * 1024;
/// Note images (D78) and the app background image (D222). Backups carry only attachments.
const FOLDERS: [&str; 2] = ["attachments", "backgrounds"];
const EXTS: [&str; 5] = ["png", "jpg", "jpeg", "gif", "webp"];

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

/// Copy a file the user picked (dialog) into the folder as `name`.
#[tauri::command]
pub fn import_image(app: AppHandle, kind: String, name: String, src: String) -> Result<(), String> {
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

// ---- .zip backups (D78): the JSON export plus `attachments/<file>` ----

const JSON_ENTRY: &str = "momentum-backup.json";
const ATT_PREFIX: &str = "attachments/";
const MAX_JSON_BYTES: u64 = 512 * 1024 * 1024;

type AnyResult<T> = Result<T, Box<dyn std::error::Error>>;

fn zip_path(path: &str) -> Result<&Path, String> {
    let p = Path::new(path);
    match p.extension().and_then(|e| e.to_str()) {
        Some(e) if e.eq_ignore_ascii_case("zip") => Ok(p),
        _ => Err("only .zip files are supported".into()),
    }
}

fn zip_backup(zip_file: &Path, json: &str, att_dir: &Path) -> AnyResult<()> {
    let mut zip = zip::ZipWriter::new(fs::File::create(zip_file)?);
    zip.start_file(JSON_ENTRY, zip::write::SimpleFileOptions::default())?;
    zip.write_all(json.as_bytes())?;
    // Images are already compressed, so they are stored as-is.
    let stored = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    for entry in fs::read_dir(att_dir)?.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if valid_name(&name).is_ok() && entry.metadata()?.is_file() {
            zip.start_file(format!("{ATT_PREFIX}{name}"), stored)?;
            std::io::copy(&mut fs::File::open(entry.path())?, &mut zip)?;
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

/// Restores entries `attachments/<valid image name>` of at most 10 MB; anything else is skipped.
fn unzip_attachments(zip_file: &Path, att_dir: &Path) -> AnyResult<u32> {
    let mut archive = zip::ZipArchive::new(fs::File::open(zip_file)?)?;
    let mut restored = 0;
    for i in 0..archive.len() {
        let entry = archive.by_index(i)?;
        let Some(name) = entry.name()?.strip_prefix(ATT_PREFIX).filter(|n| valid_name(n).is_ok()).map(str::to_owned) else { continue };
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
pub fn write_backup_zip(app: AppHandle, path: String, json: String) -> Result<(), String> {
    zip_backup(zip_path(&path)?, &json, &dir(&app, "attachments")?).map_err(|e| e.to_string())
}

/// The backup's JSON text; nothing is restored until the user confirms.
#[tauri::command]
pub fn read_backup_zip(path: String) -> Result<String, String> {
    unzip_json(zip_path(&path)?).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn restore_backup_attachments(app: AppHandle, path: String) -> Result<u32, String> {
    unzip_attachments(zip_path(&path)?, &dir(&app, "attachments")?).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::{unzip_attachments, unzip_json, valid_name, zip_backup};
    use std::{fs, io::Write};

    #[test]
    fn zip_round_trips_json_and_valid_attachments_only() {
        let base = std::env::temp_dir().join(format!("momentum-zip-test-{}", std::process::id()));
        let (src, dst) = (base.join("src"), base.join("dst"));
        fs::create_dir_all(&src).unwrap();
        fs::create_dir_all(&dst).unwrap();
        fs::write(src.join("a1.png"), b"png-bytes").unwrap();
        fs::write(src.join("notes.txt"), b"skip me").unwrap();
        let zip_file = base.join("b.zip");
        zip_backup(&zip_file, "{\"x\":1}", &src).unwrap();
        // Add a hostile entry by hand: it must not be restored.
        let mut extra = zip::ZipWriter::new_append(fs::OpenOptions::new().read(true).write(true).open(&zip_file).unwrap()).unwrap();
        extra.start_file("attachments/../evil.png", zip::write::SimpleFileOptions::default()).unwrap();
        extra.write_all(b"x").unwrap();
        extra.finish().unwrap();

        assert_eq!(unzip_json(&zip_file).unwrap(), "{\"x\":1}");
        assert_eq!(unzip_attachments(&zip_file, &dst).unwrap(), 1);
        assert_eq!(fs::read(dst.join("a1.png")).unwrap(), b"png-bytes");
        assert!(!dst.join("notes.txt").exists() && !base.join("evil.png").exists());
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
