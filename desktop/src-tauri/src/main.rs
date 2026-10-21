use std::{path::{Path, PathBuf}, process::Command, sync::Mutex};

use serde::{Deserialize, Serialize};
use tauri::{Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_deep_link::DeepLinkExt;

mod deep_link;
mod fngk_install;
mod fngk_provision;
mod loopback;
mod process_supervisor;
mod updater;
#[cfg(test)]
mod fngk_install_test;
#[cfg(test)]
mod fngk_provision_test;
#[cfg(test)]
mod process_supervisor_test;

use fngk_install::verify_fngk_binary;
use fngk_provision::{provision, stable_target, BundledFngk, ProvisionAction};
use loopback::Loopback;
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

pub(crate) struct DesktopRuntime {
    pub(crate) server: Mutex<LocalServerHandle>,
    fngk: FngkPaths,
}

/// Where FNGK lives for this launch.
///
/// `stable` is what Atlas, `fngk install` and therefore the daemon service use.
/// In a packaged build it is a per-user copy of the bundled binary (see
/// `fngk_provision`); in development it is the configured FNGK.
struct FngkPaths {
    bundled: PathBuf,
    bundled_sha256: Option<String>,
    bundled_version: String,
    stable: PathBuf,
    marker: PathBuf,
    provision: Result<ProvisionAction, String>,
}

impl FngkPaths {
    fn executable(&self) -> &Path { if self.stable.is_file() { &self.stable } else { &self.bundled } }
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

// These commands are kept for native callers. The loopback page is not granted
// them (see build.rs and capabilities/): it uses the equivalent server routes.
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
    let sha = runtime.fngk.bundled_sha256.as_deref().ok_or("Only a packaged Atlas installs its bundled FNGK.")?;
    let bundled = BundledFngk { path: &runtime.fngk.bundled, sha256: sha, version: &runtime.fngk.bundled_version };
    let outcome = provision(&bundled, &runtime.fngk.stable, &runtime.fngk.marker).map_err(|error| format!("The packaged FNGK binary could not be installed safely: {error}"))?;
    let mut result = fngk_status(&outcome.path, "local");
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

/// Resolves the bundled FNGK and, in a packaged build, provisions the stable
/// per-user copy before anything (the server, `fngk install`) runs it.
fn fngk_paths(app: &tauri::AppHandle) -> Result<FngkPaths, String> {
    let data = app.path().app_data_dir().map_err(|error| error.to_string())?;
    let marker = data.join("fngk-install.json");
    if cfg!(debug_assertions) {
        let configured = configured_fngk().ok_or("FNGK is not available on PATH for desktop development.")?;
        let version = fngk_provision::probe_version(&configured).unwrap_or_else(|| "unknown".into());
        return Ok(FngkPaths { bundled: configured.clone(), bundled_sha256: None, bundled_version: version, stable: configured, marker, provision: Ok(ProvisionAction::KeptExisting) });
    }
    let runtime_root = packaged_runtime_root(app.path().resource_dir().map_err(|error| error.to_string())?);
    let bundled = runtime_root.join("fngk");
    if !bundled.is_file() { return Err("The packaged FNGK binary is unavailable.".into()); }
    let expected = std::fs::read_to_string(runtime_root.join("fngk.sha256")).map_err(|_| "The packaged FNGK checksum is unavailable.")?.trim().to_string();
    verify_fngk_binary(&bundled, &expected).map_err(|_| "The packaged FNGK binary did not pass checksum verification.")?;
    let version = std::fs::read_to_string(runtime_root.join("fngk.version")).map(|value| value.trim().to_string()).unwrap_or_else(|_| "unknown".into());
    let home = app.path().home_dir().ok();
    let stable = stable_target(home.as_deref(), &data.join("bin"));
    let outcome = provision(&BundledFngk { path: &bundled, sha256: &expected, version: &version }, &stable, &marker);
    let provision = match outcome {
        Ok(outcome) => {
            eprintln!("atlas-fngk: {} FNGK at {}{}", outcome.action.as_str(), outcome.path.display(), outcome.backup.as_ref().map(|backup| format!(" (backup {})", backup.display())).unwrap_or_default());
            Ok(outcome.action)
        }
        Err(error) => {
            eprintln!("atlas-fngk: could not provision a stable FNGK at {}: {error}", stable.display());
            Err(error.to_string())
        }
    };
    Ok(FngkPaths { bundled, bundled_sha256: Some(expected), bundled_version: version, stable, marker, provision })
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
    let text = |path: &Path| path.to_string_lossy().into_owned();
    config.environment.extend([
        ("FNGK_BIN".into(), text(fngk.executable())),
        ("ATLAS_DESKTOP".into(), "1".into()),
        ("ATLAS_VERSION".into(), app.package_info().version.to_string()),
        ("ATLAS_FNGK_BUNDLED".into(), text(&fngk.bundled)),
        ("ATLAS_FNGK_BUNDLED_VERSION".into(), fngk.bundled_version.clone()),
        ("ATLAS_FNGK_INSTALL_PATH".into(), text(&fngk.stable)),
        ("ATLAS_FNGK_INSTALL_MARKER".into(), text(&fngk.marker)),
        ("ATLAS_FNGK_PROVISION".into(), match &fngk.provision { Ok(action) => action.as_str().into(), Err(_) => "failed".into() }),
    ]);
    if !cfg!(debug_assertions) {
        // A release trusts only the pinned FNGK manifest key, whatever the user's environment says.
        // A dev build may stage a dev key (prepare-desktop-runtime.sh); release CI refuses that file.
        let dev_key = std::fs::read_to_string(root.join("fngk-manifest-dev.pub")).unwrap_or_default();
        config.environment.push(("ATLAS_FNGK_MANIFEST_PUBLIC_KEY".into(), dev_key.trim().to_string()));
    }
    if let Some(sha) = &fngk.bundled_sha256 { config.environment.push(("ATLAS_FNGK_BUNDLED_SHA256".into(), sha.clone())); }
    if let Err(error) = &fngk.provision { config.environment.push(("ATLAS_FNGK_PROVISION_ERROR".into(), error.chars().take(400).collect())); }
    Ok(config)
}

fn main() {
    tauri::Builder::default()
        // Must be first: a second launch (for example from a deep link) focuses this one.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| deep_link::focus_main_window(app)))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let fngk = fngk_paths(app.handle())?;
            let config = desktop_server_config(app.handle(), &fngk)?;
            let server = start_atlas_server(config).map_err(|error| error.to_string())?;
            let url = server.base_url().parse().map_err(|error| format!("Atlas server URL is invalid: {error}"))?;
            let capability = server.capability.clone();
            eprintln!("atlas-desktop: Atlas {} serving on {}", app.package_info().version, server.base_url());
            app.manage(Loopback { address: server.address, capability: capability.clone() });
            app.manage(DesktopRuntime { server: Mutex::new(server), fngk });
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("Atlas")
                .inner_size(1280.0, 800.0)
                .min_inner_size(960.0, 640.0)
                .initialization_script(format!("Object.defineProperty(window,'__ATLAS_CAPABILITY__',{{value:{capability:?},configurable:false,writable:false}});"))
                .build()?;

            // Linux AppImages and development builds register the scheme at runtime;
            // .deb and macOS bundles declare it statically.
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            if let Err(error) = app.deep_link().register_all() { eprintln!("atlas-deep-link: could not register {}://: {error}", deep_link::SCHEME); }
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| for url in event.urls() { deep_link::handle(&handle, url.as_str()); });
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                for url in urls { deep_link::handle(app.handle(), url.as_str()); }
            }
            updater::start(app.handle().clone());
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
