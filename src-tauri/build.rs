/// Every app command, so each window needs an `allow-<command>` permission to call it (RUST-08).
/// Keep in step with `generate_handler!` in lib.rs; capabilities/default.json grants them to the main window only.
const COMMANDS: &[&str] = &[
    "set_close_to_tray", "quit_app", "agent_reply", "agent_ready", "agent_cli_info", "agent_cli_path",
    "secret_get", "secret_set", "secret_delete", "toggle_mini", "write_text_file", "write_png", "read_text_file",
    "backups_dir", "image_dir", "pick_path", "import_image", "write_image", "list_images", "delete_image",
    "write_backup_zip", "read_backup_zip", "restore_backup_attachments", "fetch_ics",
    "voice_model_status", "voice_download", "voice_cancel_download", "voice_remove", "voice_start",
    "voice_input_devices", "voice_stop", "voice_cancel",
];

fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)))
        .expect("failed to run tauri-build");
}
