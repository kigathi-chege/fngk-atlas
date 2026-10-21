//! Atlas self-update through tauri-plugin-updater.
//!
//! Atlas checks `https://downloads.signol.org/atlas/latest.json` (see
//! `plugins.updater` in tauri.conf.json) at launch and every six hours. When an
//! update exists it shows a native "Update available" prompt; accepting
//! downloads it, verifies its minisign signature against the pinned public
//! key, installs it and restarts Atlas. The state is also reported to the web
//! UI (About Atlas) through the loopback server.
use std::time::Duration;

use serde_json::json;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::loopback::Loopback;

const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);

/// Why the updater is not running, if it is not.
pub fn disabled_reason(app: &AppHandle) -> Option<&'static str> {
    if std::env::var_os("ATLAS_UPDATER_DISABLED").is_some_and(|value| value == "1") {
        return Some("disabled by ATLAS_UPDATER_DISABLED");
    }
    let pubkey = app.config().plugins.0.get("updater").and_then(|config| config.get("pubkey")).and_then(|value| value.as_str()).unwrap_or("");
    if pubkey.trim().is_empty() {
        return Some("no updater public key is pinned in this build");
    }
    // The Linux updater replaces the running AppImage; a .deb is updated by its package manager.
    if cfg!(target_os = "linux") && std::env::var_os("APPIMAGE").is_none() {
        return Some("only the AppImage updates itself on Linux");
    }
    None
}

pub fn start(app: AppHandle) {
    if let Some(reason) = disabled_reason(&app) {
        eprintln!("atlas-updater: {reason}");
        report(&app, json!({ "status": "disabled", "message": reason }));
        return;
    }
    tauri::async_runtime::spawn(async move {
        loop {
            check_once(&app).await;
            tokio::time::sleep(CHECK_INTERVAL).await;
        }
    });
}

async fn check_once(app: &AppHandle) {
    let current = app.package_info().version.to_string();
    let mut builder = app.updater_builder();
    if let Some(endpoint) = std::env::var("ATLAS_UPDATER_ENDPOINT").ok().filter(|value| !value.is_empty()) {
        match endpoint.parse().map_err(|error| format!("{error}")).and_then(|url| builder.endpoints(vec![url]).map_err(|error| error.to_string())) {
            Ok(next) => builder = next,
            Err(error) => return failed(app, &current, &format!("invalid ATLAS_UPDATER_ENDPOINT: {error}")),
        }
    }
    let updater = match builder.build() {
        Ok(updater) => updater,
        Err(error) => return failed(app, &current, &error.to_string()),
    };
    match updater.check().await {
        Ok(Some(update)) => {
            eprintln!("atlas-updater: Atlas {} is available (running {current}).", update.version);
            report(app, json!({ "status": "available", "version": update.version, "currentVersion": current }));
            if std::env::var_os("ATLAS_UPDATER_VERIFY_ONLY").is_some_and(|value| value == "1") {
                verify_only(app, update, current).await;
            } else {
                prompt(app.clone(), update);
            }
        }
        Ok(None) => {
            eprintln!("atlas-updater: Atlas {current} is up to date.");
            report(app, json!({ "status": "current", "currentVersion": current }));
        }
        Err(error) => failed(app, &current, &error.to_string()),
    }
}

/// Test hook: download and verify the signature without installing.
async fn verify_only(app: &AppHandle, update: Update, current: String) {
    match update.download(|_, _| {}, || {}).await {
        Ok(bytes) => {
            eprintln!("atlas-updater: downloaded {} bytes and verified the signature (verify-only; not installing).", bytes.len());
            report(app, json!({ "status": "verified", "version": update.version, "currentVersion": current }));
        }
        Err(error) => failed(app, &current, &format!("download or signature verification failed: {error}")),
    }
}

fn prompt(app: AppHandle, update: Update) {
    let message = format!("Atlas {} is available. You are running {}.\n\nRestart Atlas now to install it?", update.version, update.current_version);
    let handle = app.clone();
    app.dialog()
        .message(message)
        .title("Update available")
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom("Restart and update".into(), "Later".into()))
        .show(move |accepted| {
            if !accepted {
                return;
            }
            tauri::async_runtime::spawn(async move {
                let current = update.current_version.clone();
                report(&handle, json!({ "status": "installing", "version": update.version, "currentVersion": current }));
                match update.download_and_install(|_, _| {}, || {}).await {
                    Ok(()) => {
                        if let Some(runtime) = handle.try_state::<crate::DesktopRuntime>() {
                            if let Ok(mut server) = runtime.server.lock() {
                                let _ = server.stop();
                            }
                        }
                        handle.restart();
                    }
                    Err(error) => failed(&handle, &current, &format!("installation failed: {error}")),
                }
            });
        });
}

fn failed(app: &AppHandle, current: &str, message: &str) {
    eprintln!("atlas-updater: {message}");
    report(app, json!({ "status": "error", "currentVersion": current, "message": message.chars().take(400).collect::<String>() }));
}

fn report(app: &AppHandle, body: serde_json::Value) {
    let Some(loopback) = app.try_state::<Loopback>().map(|state| state.inner().clone()) else { return };
    std::thread::spawn(move || {
        if let Err(error) = loopback.post_json("/api/desktop/update-state", &body) {
            eprintln!("atlas-updater: could not report update state: {error}");
        }
    });
}
