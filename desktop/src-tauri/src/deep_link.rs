//! `fngk-atlas://` deep links: focus the main window and forward the URL to
//! the web UI through `POST /api/desktop/deep-link` on the loopback server.
use tauri::{AppHandle, Manager};

use crate::loopback::Loopback;

pub const SCHEME: &str = "fngk-atlas";
const MAX_URL_LENGTH: usize = 2048;

pub fn accepted(url: &str) -> bool {
    url.len() <= MAX_URL_LENGTH
        && url.get(..SCHEME.len() + 3).is_some_and(|prefix| prefix.eq_ignore_ascii_case("fngk-atlas://"))
        && !url.chars().any(char::is_control)
}

pub fn focus_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Focuses Atlas and hands the URL to the web UI. Unknown schemes are ignored.
pub fn handle(app: &AppHandle, url: &str) {
    if !accepted(url) {
        eprintln!("atlas-deep-link: ignored a URL that is not {SCHEME}://");
        return;
    }
    focus_main_window(app);
    let Some(loopback) = app.try_state::<Loopback>().map(|state| state.inner().clone()) else { return };
    let url = url.to_string();
    std::thread::spawn(move || match loopback.post_json("/api/desktop/deep-link", &serde_json::json!({ "url": url })) {
        Ok(status) if (200..300).contains(&status) => {}
        Ok(status) => eprintln!("atlas-deep-link: Atlas rejected the deep link ({status})."),
        Err(error) => eprintln!("atlas-deep-link: could not forward the deep link: {error}"),
    });
}

#[cfg(test)]
mod tests {
    use super::accepted;

    #[test]
    fn accepts_only_bounded_fngk_atlas_urls() {
        assert!(accepted("fngk-atlas://auth/complete?state=abc"));
        assert!(accepted("FNGK-ATLAS://auth/complete"));
        assert!(!accepted("https://evil.example/fngk-atlas://"));
        assert!(!accepted("fngk-atlas:/x"));
        assert!(!accepted("fngk-atlas://a\nb"));
        assert!(!accepted(&format!("fngk-atlas://{}", "a".repeat(2048))));
    }
}
