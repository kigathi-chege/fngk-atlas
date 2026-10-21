//! Copies the bundled, checksum-verified FNGK to a stable per-user location.
//!
//! A packaged Atlas runs from a location that may vanish when Atlas quits (an
//! AppImage is a temporary FUSE mount). `fngk install` writes its own path into
//! the daemon service definition, so the daemon must be installed from a path
//! that outlives Atlas. On launch Atlas makes sure that stable copy exists, and
//! refreshes it when the bundled FNGK is newer.
use std::{
    cmp::Ordering,
    fs, io,
    path::{Path, PathBuf},
    process::Command,
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::fngk_install::{install_fngk_binary, verify_fngk_binary};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProvisionAction {
    /// No FNGK was at the stable path; Atlas copied its bundled one there.
    Installed,
    /// An older FNGK was replaced by the newer bundled one (a backup was kept).
    Upgraded,
    /// The stable path already holds the exact bundled binary.
    Current,
    /// The stable path holds a newer or user-managed FNGK, which Atlas keeps.
    KeptExisting,
}

impl ProvisionAction {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Installed => "installed",
            Self::Upgraded => "upgraded",
            Self::Current => "current",
            Self::KeptExisting => "kept-existing",
        }
    }
}

#[derive(Debug)]
pub struct ProvisionOutcome {
    pub path: PathBuf,
    pub action: ProvisionAction,
    pub backup: Option<PathBuf>,
}

pub struct BundledFngk<'a> {
    pub path: &'a Path,
    pub sha256: &'a str,
    pub version: &'a str,
}

/// Records which binary Atlas itself placed at the stable path, so Atlas only
/// ever replaces a same-version binary that it owns.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Marker {
    path: PathBuf,
    sha256: String,
    version: String,
}

/// `~/.local/bin/fngk` when that directory is (or can be made) writable,
/// otherwise Atlas's application-data `bin` directory.
pub fn stable_target(home: Option<&Path>, app_data_bin: &Path) -> PathBuf {
    let name = if cfg!(windows) { "fngk.exe" } else { "fngk" };
    if !cfg!(windows) {
        if let Some(home) = home {
            let directory = home.join(".local").join("bin");
            if writable_directory(&directory) {
                return directory.join(name);
            }
        }
    }
    app_data_bin.join(name)
}

fn writable_directory(directory: &Path) -> bool {
    if fs::create_dir_all(directory).is_err() {
        return false;
    }
    let probe = directory.join(format!(".atlas-write-probe-{}", std::process::id()));
    let writable = fs::write(&probe, b"").is_ok();
    let _ = fs::remove_file(&probe);
    writable
}

pub fn provision(bundled: &BundledFngk, target: &Path, marker_path: &Path) -> io::Result<ProvisionOutcome> {
    verify_fngk_binary(bundled.path, bundled.sha256)?;
    let outcome = |action, backup| ProvisionOutcome { path: target.to_path_buf(), action, backup };
    if !target.is_file() {
        install_verified(bundled, target, marker_path)?;
        return Ok(outcome(ProvisionAction::Installed, None));
    }
    let current_sha = sha256_file(target)?;
    if current_sha.eq_ignore_ascii_case(bundled.sha256) {
        write_marker(marker_path, target, bundled)?;
        return Ok(outcome(ProvisionAction::Current, None));
    }
    let atlas_owned = read_marker(marker_path).is_some_and(|marker| marker.path == target && marker.sha256.eq_ignore_ascii_case(&current_sha));
    let installed_version = probe_version(target);
    let replace = match installed_version.as_deref().and_then(|installed| compare_versions(bundled.version, installed)) {
        Some(Ordering::Greater) => true,
        Some(Ordering::Less) => false,
        // Same or unknown version but different bytes: only replace a binary Atlas put there.
        Some(Ordering::Equal) | None => atlas_owned,
    };
    if !replace {
        return Ok(outcome(ProvisionAction::KeptExisting, None));
    }
    let backup = install_verified(bundled, target, marker_path)?;
    Ok(outcome(ProvisionAction::Upgraded, backup))
}

fn install_verified(bundled: &BundledFngk, target: &Path, marker_path: &Path) -> io::Result<Option<PathBuf>> {
    let receipt = install_fngk_binary(bundled.path, target)?;
    if let Err(error) = verify_fngk_binary(target, bundled.sha256) {
        if let Some(backup) = &receipt.backup_path {
            let _ = install_fngk_binary(backup, target);
        }
        return Err(error);
    }
    write_marker(marker_path, target, bundled)?;
    Ok(receipt.backup_path)
}

fn write_marker(marker_path: &Path, target: &Path, bundled: &BundledFngk) -> io::Result<()> {
    if let Some(parent) = marker_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let marker = Marker { path: target.to_path_buf(), sha256: bundled.sha256.to_ascii_lowercase(), version: bundled.version.to_string() };
    fs::write(marker_path, serde_json::to_vec_pretty(&marker).map_err(io::Error::other)?)
}

fn read_marker(marker_path: &Path) -> Option<Marker> {
    serde_json::from_slice(&fs::read(marker_path).ok()?).ok()
}

pub fn sha256_file(path: &Path) -> io::Result<String> {
    Ok(format!("{:x}", Sha256::digest(fs::read(path)?)))
}

/// `fngk version` prints `fngk v1.2.3` (or the legacy `signal v1.2.3`).
pub fn probe_version(executable: &Path) -> Option<String> {
    let output = Command::new(executable).arg("version").output().ok()?;
    if !output.status.success() {
        return None;
    }
    parse_version_output(&String::from_utf8_lossy(&output.stdout))
}

pub fn parse_version_output(output: &str) -> Option<String> {
    output.split_whitespace().last().filter(|token| token.trim_start_matches('v').starts_with(|c: char| c.is_ascii_digit())).map(str::to_string)
}

/// Semantic-version comparison (`v` prefix optional). A pre-release sorts
/// before its release. Returns `None` when either side is not a version.
pub fn compare_versions(left: &str, right: &str) -> Option<Ordering> {
    let (left_core, left_pre) = split_version(left)?;
    let (right_core, right_pre) = split_version(right)?;
    Some(left_core.cmp(&right_core).then_with(|| match (left_pre, right_pre) {
        (None, None) => Ordering::Equal,
        (None, Some(_)) => Ordering::Greater,
        (Some(_), None) => Ordering::Less,
        (Some(left), Some(right)) => compare_prerelease(left, right),
    }))
}

fn split_version(value: &str) -> Option<([u64; 3], Option<&str>)> {
    let value = value.trim().trim_start_matches('v');
    let value = value.split('+').next()?;
    let (core, pre) = match value.split_once('-') {
        Some((core, pre)) => (core, Some(pre)),
        None => (value, None),
    };
    let mut parts = core.split('.');
    let mut numbers = [0_u64; 3];
    for slot in &mut numbers {
        *slot = parts.next()?.parse().ok()?;
    }
    if parts.next().is_some() {
        return None;
    }
    Some((numbers, pre))
}

fn compare_prerelease(left: &str, right: &str) -> Ordering {
    let mut left_parts = left.split('.');
    let mut right_parts = right.split('.');
    loop {
        match (left_parts.next(), right_parts.next()) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(left), Some(right)) => {
                let order = match (left.parse::<u64>(), right.parse::<u64>()) {
                    (Ok(left), Ok(right)) => left.cmp(&right),
                    (Ok(_), Err(_)) => Ordering::Less,
                    (Err(_), Ok(_)) => Ordering::Greater,
                    (Err(_), Err(_)) => left.cmp(right),
                };
                if order != Ordering::Equal {
                    return order;
                }
            }
        }
    }
}
