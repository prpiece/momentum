//! The account's refresh token in the OS keychain (v1.1 spec, "Token storage"), and the sync device id,
//! kept outside the database file so a copied database is detected (SYNC-06).
//! Only named keys are allowed, so the webview can't use this as a general keychain reader.

const KEYS: &[&str] = &["refresh_token", "device_id"];

/// The service is the app identifier, so a dev or sync-test run (other identifier) never touches the installed app's token.
fn entry(app: &tauri::AppHandle, key: &str) -> Result<keyring::Entry, String> {
    if !KEYS.contains(&key) {
        return Err(format!("unknown secret {key}"));
    }
    keyring::Entry::new(&app.config().identifier, key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secret_get(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    match entry(&app, &key)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn secret_set(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    entry(&app, &key)?.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secret_delete(app: tauri::AppHandle, key: String) -> Result<(), String> {
    match entry(&app, &key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
