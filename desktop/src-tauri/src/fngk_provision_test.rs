use std::{cmp::Ordering, fs, path::{Path, PathBuf}};

use crate::fngk_provision::{compare_versions, parse_version_output, provision, sha256_file, stable_target, BundledFngk, ProvisionAction};

fn scratch(name: &str) -> PathBuf {
    let directory = std::env::temp_dir().join(format!("atlas-provision-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&directory);
    fs::create_dir_all(&directory).unwrap();
    directory
}

fn fake_fngk(path: &Path, version: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, format!("#!/bin/sh\necho \"fngk {version}\"\n")).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
    }
}

fn bundled(directory: &Path, version: &str) -> (PathBuf, String) {
    let path = directory.join("bundle").join("fngk");
    fake_fngk(&path, version);
    let sha = sha256_file(&path).unwrap();
    (path, sha)
}

#[test]
fn compares_semantic_versions_with_prereleases() {
    assert_eq!(compare_versions("v1.2.0", "1.1.9"), Some(Ordering::Greater));
    assert_eq!(compare_versions("v1.2.0-rc.1", "v1.2.0"), Some(Ordering::Less));
    assert_eq!(compare_versions("v1.2.0-rc.10", "v1.2.0-rc.9"), Some(Ordering::Greater));
    assert_eq!(compare_versions("v0.1.0-dev", "v0.1.0-dev"), Some(Ordering::Equal));
    assert_eq!(compare_versions("head", "v1.0.0"), None);
    assert_eq!(parse_version_output("fngk v0.3.1\n").as_deref(), Some("v0.3.1"));
    assert_eq!(parse_version_output("signal v0.1.0-dev").as_deref(), Some("v0.1.0-dev"));
    assert_eq!(parse_version_output("usage: fngk"), None);
}

#[test]
fn prefers_a_writable_local_bin_and_falls_back_to_app_data() {
    let directory = scratch("target");
    let app_bin = directory.join("app").join("bin");
    #[cfg(unix)]
    assert_eq!(stable_target(Some(&directory), &app_bin), directory.join(".local/bin/fngk"));
    assert_eq!(stable_target(None, &app_bin), app_bin.join(if cfg!(windows) { "fngk.exe" } else { "fngk" }));
    let _ = fs::remove_dir_all(&directory);
}

#[cfg(unix)]
#[test]
fn installs_on_first_run_and_is_current_afterwards() {
    let directory = scratch("first");
    let (path, sha) = bundled(&directory, "v0.2.0");
    let target = directory.join("home/.local/bin/fngk");
    let marker = directory.join("data/fngk-install.json");
    let input = BundledFngk { path: &path, sha256: &sha, version: "v0.2.0" };
    assert_eq!(provision(&input, &target, &marker).unwrap().action, ProvisionAction::Installed);
    assert_eq!(sha256_file(&target).unwrap(), sha);
    assert!(marker.is_file());
    assert_eq!(provision(&input, &target, &marker).unwrap().action, ProvisionAction::Current);
    let _ = fs::remove_dir_all(&directory);
}

#[cfg(unix)]
#[test]
fn upgrades_an_older_fngk_and_keeps_a_newer_one() {
    let directory = scratch("upgrade");
    let (path, sha) = bundled(&directory, "v0.2.0");
    let target = directory.join("bin/fngk");
    let marker = directory.join("data/fngk-install.json");
    let input = BundledFngk { path: &path, sha256: &sha, version: "v0.2.0" };

    fake_fngk(&target, "v0.1.0");
    let outcome = provision(&input, &target, &marker).unwrap();
    assert_eq!(outcome.action, ProvisionAction::Upgraded);
    assert!(outcome.backup.unwrap().is_file());
    assert_eq!(sha256_file(&target).unwrap(), sha);

    fake_fngk(&target, "v0.3.0");
    let newer = sha256_file(&target).unwrap();
    assert_eq!(provision(&input, &target, &marker).unwrap().action, ProvisionAction::KeptExisting);
    assert_eq!(sha256_file(&target).unwrap(), newer);
    let _ = fs::remove_dir_all(&directory);
}

#[cfg(unix)]
#[test]
fn replaces_a_same_version_binary_only_when_atlas_owns_it() {
    let directory = scratch("owned");
    let (path, sha) = bundled(&directory, "v0.1.0-dev");
    let target = directory.join("bin/fngk");
    let marker = directory.join("data/fngk-install.json");

    // A user-installed binary with the same version string is left alone.
    fake_fngk(&target, "v0.1.0-dev");
    fs::write(&target, format!("{}# user build\n", fs::read_to_string(&target).unwrap())).unwrap();
    let input = BundledFngk { path: &path, sha256: &sha, version: "v0.1.0-dev" };
    assert_eq!(provision(&input, &target, &marker).unwrap().action, ProvisionAction::KeptExisting);

    // Once Atlas has installed it, a rebuilt bundle with the same version replaces it.
    fs::remove_file(&target).unwrap();
    assert_eq!(provision(&input, &target, &marker).unwrap().action, ProvisionAction::Installed);
    let (rebuilt, rebuilt_sha) = { fs::write(&path, format!("{}# rebuilt\n", fs::read_to_string(&path).unwrap())).unwrap(); (path.clone(), sha256_file(&path).unwrap()) };
    let input = BundledFngk { path: &rebuilt, sha256: &rebuilt_sha, version: "v0.1.0-dev" };
    assert_eq!(provision(&input, &target, &marker).unwrap().action, ProvisionAction::Upgraded);
    assert_eq!(sha256_file(&target).unwrap(), rebuilt_sha);
    let _ = fs::remove_dir_all(&directory);
}

#[test]
fn refuses_a_bundle_that_fails_its_checksum() {
    let directory = scratch("tampered");
    let (path, _) = bundled(&directory, "v0.2.0");
    let input = BundledFngk { path: &path, sha256: &"0".repeat(64), version: "v0.2.0" };
    assert!(provision(&input, &directory.join("bin/fngk"), &directory.join("marker.json")).is_err());
    assert!(!directory.join("bin/fngk").exists());
    let _ = fs::remove_dir_all(&directory);
}
