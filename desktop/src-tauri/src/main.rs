use serde::{Deserialize, Serialize};

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
    response("checking", "Checking the local FNGK runtime.", None)
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
    Ok(response("daemon-install-choice", "FNGK daemon convergence is not configured yet.", Some("bootstrap_not_configured")))
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
fn atlas_shutdown(app: tauri::AppHandle) {
    app.exit(0);
}

fn main() {
    tauri::Builder::default()
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
