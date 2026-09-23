use std::{fs, io, path::{Path, PathBuf}};
use sha2::{Digest, Sha256};

#[derive(Debug)]
pub struct InstallReceipt {
    pub installed_path: PathBuf,
    pub backup_path: Option<PathBuf>,
}

pub fn install_fngk_binary(source: &Path, target: &Path) -> io::Result<InstallReceipt> {
    let metadata = fs::metadata(source)?;
    if !metadata.is_file() || metadata.len() == 0 { return Err(io::Error::new(io::ErrorKind::InvalidInput, "The packaged FNGK binary is invalid.")); }
    let parent = target.parent().ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "The FNGK installation directory is invalid."))?;
    fs::create_dir_all(parent)?;
    let backup = target.with_extension("atlas-backup");
    let backup_path = if target.is_file() { fs::copy(target, &backup)?; Some(backup) } else { None };
    let temporary = parent.join(format!(".fngk-{}.new", random_suffix()?));
    let result = (|| {
        fs::copy(source, &temporary)?;
        #[cfg(unix)]
        { use std::os::unix::fs::PermissionsExt; fs::set_permissions(&temporary, fs::Permissions::from_mode(0o755))?; }
        fs::rename(&temporary, target)?;
        Ok(InstallReceipt { installed_path: target.to_path_buf(), backup_path })
    })();
    if result.is_err() { let _ = fs::remove_file(&temporary); }
    result
}

pub fn verify_fngk_binary(source: &Path, expected_sha256: &str) -> io::Result<()> {
    if expected_sha256.len() != 64 || !expected_sha256.bytes().all(|byte| byte.is_ascii_hexdigit()) { return Err(io::Error::new(io::ErrorKind::InvalidInput, "The packaged FNGK checksum is invalid.")); }
    let metadata = fs::metadata(source)?;
    if !metadata.is_file() || metadata.len() == 0 { return Err(io::Error::new(io::ErrorKind::InvalidInput, "The packaged FNGK binary is invalid.")); }
    let actual = format!("{:x}", Sha256::digest(fs::read(source)?));
    if actual.eq_ignore_ascii_case(expected_sha256.trim()) { Ok(()) } else { Err(io::Error::new(io::ErrorKind::InvalidData, "The packaged FNGK checksum did not match.")) }
}

fn random_suffix() -> io::Result<String> {
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes).map_err(|error| io::Error::other(error.to_string()))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}
