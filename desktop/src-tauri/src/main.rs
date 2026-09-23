use std::{path::{Path, PathBuf}, process::Command, sync::Mutex};

use serde::{Deserialize, Serialize};
use tauri::{Manager, State, WebviewUrl, WebviewWindowBuilder};

mod process_supervisor;
mod fngk_install;
#[cfg(test)]
mod process_supervisor_test;
#[cfg(test)]
mod fngk_install_test;

use fngk_install::{install_fngk_binary, verify_fngk_binary};
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
    fngk: FngkPaths,
}

struct FngkPaths {
    bundled: PathBuf,
    installed: PathBuf,
}

impl FngkPaths {
    fn executable(&self) -> &Path { if self.installed.is_file() { &self.installed } else { &self.bundled } }
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
    use std::path::PathBuf;

    use super::{packaged_runtime_root, valid_operation_id, valid_profile};

    #[test]
    fn rejects_path_like_profiles_and_operation_ids() {
        assert!(valid_profile("local"));
        assert!(!valid_profile("../other"));
        assert!(valid_operation_id("install-1:step"));
        assert!(!valid_operation_id("/bin/sh"));
    }

    #[test]
    fn keeps_packaged_runtime_under_a_named_resource_directory() {
        assert_eq!(packaged_runtime_root(PathBuf::from("/resources")), PathBuf::from("/resources/runtime"));
    }
}

#[tauri::command]
fn atlas_get_local_status(runtime: State<DesktopRuntime>) -> BootstrapResponse {
    fngk_status(runtime.fngk.executable(), "local")
}

#[tauri::command]
fn atlas_install_fngk(request: InstallRequest, runtime: State<DesktopRuntime>) -> Result<BootstrapResponse, String> {
    if request.scope != "user" && request.scope != "system" {
        return Err("Invalid installation scope.".into());
    }
    if request.scope == "system" { return Err("System installation requires explicit operating-system elevation and is unavailable in this build.".into()); }
    let receipt = install_fngk_binary(&runtime.fngk.bundled, &runtime.fngk.installed).map_err(|error| format!("The packaged FNGK binary could not be installed safely: {error}"))?;
    let mut result = fngk_status(&receipt.installed_path, "local");
    if result.state == "ready" { result.message = "FNGK was installed for this user and is ready."; }
    Ok(result)
}

#[tauri::command]
fn atlas_converge_daemon(request: ProfileRequest, runtime: State<DesktopRuntime>) -> Result<BootstrapResponse, String> {
    if !valid_profile(&request.profile) {
        return Err("Invalid FNGK profile.".into());
    }
    let result = Command::new(runtime.fngk.executable()).args(["install", "--profile", &request.profile]).status().map_err(|error| format!("FNGK daemon convergence could not start: {error}"))?;
    if !result.success() { return Ok(response("recoverable-error", "FNGK daemon convergence did not complete.", Some("daemon_convergence_failed"))); }
    Ok(fngk_status(runtime.fngk.executable(), &request.profile))
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

fn fngk_status(executable: &Path, profile: &str) -> BootstrapResponse {
    let result = Command::new(executable).args(["status", "--json", "--profile", profile]).output();
    match result {
        Ok(output) if output.status.success() => response("ready", "FNGK is ready.", None),
        Ok(_) => response("recoverable-error", "FNGK needs attention.", Some("fngk_status_failed")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => response("install-choice", "FNGK needs to be installed.", Some("binary_missing")),
        Err(_) => response("recoverable-error", "FNGK could not be checked.", Some("fngk_probe_failed")),
    }
}

fn fngk_paths(app: &tauri::AppHandle) -> Result<FngkPaths, String> {
    let installed = app.path().app_data_dir().map_err(|error| error.to_string())?.join("bin").join("fngk");
    let bundled = if cfg!(debug_assertions) { configured_fngk().ok_or("FNGK is not available on PATH for desktop development.")? } else { packaged_runtime_root(app.path().resource_dir().map_err(|error| error.to_string())?).join("fngk") };
    if !bundled.is_file() { return Err("The packaged FNGK binary is unavailable.".into()); }
    if !cfg!(debug_assertions) {
        let checksum = packaged_runtime_root(app.path().resource_dir().map_err(|error| error.to_string())?).join("fngk.sha256");
        let expected = std::fs::read_to_string(checksum).map_err(|_| "The packaged FNGK checksum is unavailable.")?;
        verify_fngk_binary(&bundled, expected.trim()).map_err(|_| "The packaged FNGK binary did not pass checksum verification.")?;
    }
    Ok(FngkPaths { bundled, installed })
}

fn packaged_runtime_root(resource_dir: PathBuf) -> PathBuf {
    resource_dir.join("runtime")
}

fn configured_fngk() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("FNGK_BIN").map(PathBuf::from).filter(|path| path.is_file()) { return Some(path); }
    std::env::var_os("PATH").and_then(|paths| std::env::split_paths(&paths).map(|directory| directory.join("fngk")).find(|path| path.is_file()))
}

fn desktop_server_config(app: &tauri::AppHandle, fngk: &FngkPaths) -> Result<AtlasServerConfig, String> {
    let root = if cfg!(debug_assertions) { PathBuf::from(env!("CARGO_MANIFEST_DIR")).ancestors().nth(2).ok_or("Atlas project root is unavailable.")?.to_path_buf() } else { packaged_runtime_root(app.path().resource_dir().map_err(|error| error.to_string())?) };
    let address = reserve_loopback_address().map_err(|error| error.to_string())?;
    let mut random = [0_u8; 32];
    getrandom::fill(&mut random).map_err(|error| format!("Could not create desktop launch capability: {error}"))?;
    let capability = random.iter().map(|byte| format!("{byte:02x}")).collect::<String>();
    let executable = if cfg!(debug_assertions) { std::env::var_os("ATLAS_NODE").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("node")) } else { root.join("node") };
    let mut config = AtlasServerConfig::new(executable, root.clone(), address, capability);
    config.arguments = vec![root.join("dist/server/index.js").to_string_lossy().into_owned()];
    config.database_path = app.path().app_data_dir().map_err(|error| error.to_string())?.join("atlas.db");
    config.environment.push(("FNGK_BIN".into(), fngk.executable().to_string_lossy().into_owned()));
    Ok(config)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let fngk = fngk_paths(&app.handle())?;
            let config = desktop_server_config(&app.handle(), &fngk)?;
            let server = start_atlas_server(config).map_err(|error| error.to_string())?;
            let url = server.base_url().parse().map_err(|error| format!("Atlas server URL is invalid: {error}"))?;
            let capability = server.capability.clone();
            app.manage(DesktopRuntime { server: Mutex::new(server), fngk });
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
            atlas_cancel_operation,
            atlas_shutdown,
        ])
        .run(tauri::generate_context!())
        .expect("Atlas desktop host failed");
}
