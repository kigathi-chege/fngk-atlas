use std::{path::PathBuf, process::Command, sync::Mutex};

use serde::{Deserialize, Serialize};
use tauri::{Manager, State, WebviewUrl, WebviewWindowBuilder};

mod process_supervisor;
#[cfg(test)]
mod process_supervisor_test;

use process_supervisor::{reserve_loopback_address, start_atlas_server, AtlasServerConfig, LocalServerHandle};

const PROTOCOL_VERSION: &str = "atlas.desktop-bootstrap.v1";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BootstrapResponse {
    protocol_version: &'static str,
    state: &'static str,
    message: &'static str,
    error_code: Option<&'static str>,
}

#[derive(Deserialize)]
struct InstallRequest {
    scope: String,
}

#[derive(Deserialize)]
struct ProfileRequest {
    profile: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CancelRequest {
    operation_id: String,
}

struct DesktopRuntime {
    server: Mutex<LocalServerHandle>,
}

fn response(state: &'static str, message: &'static str, error_code: Option<&'static str>) -> BootstrapResponse {
    BootstrapResponse { protocol_version: PROTOCOL_VERSION, state, message, error_code }
}

fn valid_profile(profile: &str) -> bool {
    !profile.is_empty()
        && profile.len() <= 64
        && profile.chars().enumerate().all(|(index, character)| {
            character.is_ascii_alphanumeric()
                || (index > 0 && matches!(character, '.' | '_' | '-'))
        })
}

fn valid_operation_id(operation_id: &str) -> bool {
    !operation_id.is_empty()
        && operation_id.len() <= 128
        && operation_id.chars().enumerate().all(|(index, character)| {
            character.is_ascii_alphanumeric()
                || (index > 0 && matches!(character, '.' | '_' | ':' | '-'))
        })
}

#[cfg(test)]
mod tests {
    use super::{valid_operation_id, valid_profile};

    #[test]
    fn rejects_path_like_profiles_and_operation_ids() {
        assert!(valid_profile("local"));
        assert!(!valid_profile("../other"));
        assert!(valid_operation_id("install-1:step"));
        assert!(!valid_operation_id("/bin/sh"));
    }
}

#[tauri::command]
fn atlas_get_local_status() -> BootstrapResponse {
    fngk_status("local")
}

#[tauri::command]
fn atlas_install_fngk(request: InstallRequest) -> Result<BootstrapResponse, String> {
    if request.scope != "user" && request.scope != "system" {
        return Err("Invalid installation scope.".into());
    }
    Ok(response("install-choice", "FNGK installation is not configured yet.", Some("bootstrap_not_configured")))
}

#[tauri::command]
fn atlas_converge_daemon(request: ProfileRequest) -> Result<BootstrapResponse, String> {
    if !valid_profile(&request.profile) {
        return Err("Invalid FNGK profile.".into());
    }
    let result = Command::new("fngk").args(["install", "--profile", &request.profile]).status().map_err(|error| format!("FNGK daemon convergence could not start: {error}"))?;
    if !result.success() { return Ok(response("recoverable-error", "FNGK daemon convergence did not complete.", Some("daemon_convergence_failed"))); }
    Ok(fngk_status(&request.profile))
}

#[tauri::command]
fn atlas_begin_login(request: ProfileRequest) -> Result<BootstrapResponse, String> {
    if !valid_profile(&request.profile) {
        return Err("Invalid FNGK profile.".into());
    }
    Ok(response("login-choice", "FNGK browser login is not configured yet.", Some("bootstrap_not_configured")))
}

#[tauri::command]
fn atlas_cancel_operation(request: CancelRequest) -> Result<BootstrapResponse, String> {
    if !valid_operation_id(&request.operation_id) {
        return Err("Invalid operation ID.".into());
    }
    Ok(response("recoverable-error", "The requested operation was cancelled.", Some("operation_cancelled")))
}

#[tauri::command]
fn atlas_shutdown(app: tauri::AppHandle, runtime: State<DesktopRuntime>) {
    if let Ok(mut server) = runtime.server.lock() { let _ = server.stop(); }
    app.exit(0);
}

fn fngk_status(profile: &str) -> BootstrapResponse {
    let result = Command::new("fngk").args(["status", "--json", "--profile", profile]).output();
    match result {
        Ok(output) if output.status.success() => response("ready", "FNGK is ready.", None),
        Ok(_) => response("recoverable-error", "FNGK needs attention.", Some("fngk_status_failed")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => response("install-choice", "FNGK needs to be installed.", Some("binary_missing")),
        Err(_) => response("recoverable-error", "FNGK could not be checked.", Some("fngk_probe_failed")),
    }
}

fn desktop_server_config(app: &tauri::AppHandle) -> Result<AtlasServerConfig, String> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).ancestors().nth(2).ok_or("Atlas project root is unavailable.")?.to_path_buf();
    let address = reserve_loopback_address().map_err(|error| error.to_string())?;
    let mut random = [0_u8; 32];
    getrandom::fill(&mut random).map_err(|error| format!("Could not create desktop launch capability: {error}"))?;
    let capability = random.iter().map(|byte| format!("{byte:02x}")).collect::<String>();
    let executable = if cfg!(debug_assertions) { std::env::var_os("ATLAS_NODE").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("node")) } else { app.path().resource_dir().map_err(|error| error.to_string())?.join("atlas-server") };
    let mut config = AtlasServerConfig::new(executable, root.clone(), address, capability);
    if cfg!(debug_assertions) { config.arguments = vec![root.join("dist/server/index.js").to_string_lossy().into_owned()]; }
    config.database_path = app.path().app_data_dir().map_err(|error| error.to_string())?.join("atlas.db");
    Ok(config)
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let config = desktop_server_config(&app.handle())?;
            let server = start_atlas_server(config).map_err(|error| error.to_string())?;
            let url = server.base_url().parse().map_err(|error| format!("Atlas server URL is invalid: {error}"))?;
            let capability = server.capability.clone();
            app.manage(DesktopRuntime { server: Mutex::new(server) });
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("Atlas")
                .inner_size(1280.0, 800.0)
                .min_inner_size(960.0, 640.0)
                .initialization_script(&format!("Object.defineProperty(window,'__ATLAS_CAPABILITY__',{{value:{capability:?},configurable:false,writable:false}});"))
                .build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            atlas_get_local_status,
            atlas_install_fngk,
            atlas_converge_daemon,
            atlas_begin_login,
            atlas_cancel_operation,
            atlas_shutdown,
        ])
        .run(tauri::generate_context!())
        .expect("Atlas desktop host failed");
}
