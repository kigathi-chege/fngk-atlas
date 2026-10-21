fn main() {
    // Declaring the app commands makes each one need an explicit `allow-*`
    // permission. The loopback capability grants none of them: the web UI uses
    // Atlas's server routes instead of Tauri IPC.
    const COMMANDS: &[&str] = &["atlas_get_local_status", "atlas_install_fngk", "atlas_converge_daemon", "atlas_cancel_operation", "atlas_shutdown"];
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)))
        .expect("failed to run tauri-build");
}
