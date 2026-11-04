//! Image files the app keeps in its config dir: note attachments (D78) and backgrounds (D79).
//! The webview reads them through the asset protocol (scoped to these two folders); every
//! write goes through these commands, which validate the folder, the name and the size.

use std::{fs, path::PathBuf, time::UNIX_EPOCH};
use tauri::{AppHandle, Manager};

pub const MAX_IMAGE_BYTES: u64 = 10 * 1024 * 1024;
const EXTS: [&str; 5] = ["png", "jpg", "jpeg", "gif", "webp"];

/// `kind` is a folder name; `name` is `<id>.<ext>` with a plain id and an image extension.
fn image_path(app: &AppHandle, kind: &str, name: &str) -> Result<PathBuf, String> {
    Ok(dir(app, kind)?.join(valid_name(name)?))
}

fn dir(app: &AppHandle, kind: &str) -> Result<PathBuf, String> {
    if kind != "attachments" && kind != "backgrounds" {
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

#[cfg(test)]
mod tests {
    use super::valid_name;

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
