use std::{fs, path::PathBuf};

use crate::fngk_install::{install_fngk_binary, verify_fngk_binary};

#[test]
fn atomically_installs_the_package_trusted_binary_and_keeps_a_backup() {
    let directory = std::env::temp_dir().join(format!("atlas-fngk-install-test-{}", std::process::id()));
    let _ = fs::remove_dir_all(&directory);
    fs::create_dir_all(&directory).unwrap();
    let source = directory.join("package-fngk");
    let target = directory.join("bin").join("fngk");
    fs::write(&source, b"new-fngk").unwrap();
    fs::create_dir_all(target.parent().unwrap()).unwrap();
    fs::write(&target, b"old-fngk").unwrap();

    let result = install_fngk_binary(&source, &target).unwrap();

    assert_eq!(fs::read(&target).unwrap(), b"new-fngk");
    assert_eq!(fs::read(&result.backup_path.unwrap()).unwrap(), b"old-fngk");
    let _ = fs::remove_dir_all(&directory);
}

#[test]
fn rejects_a_missing_package_binary_without_touching_the_target() {
    let directory = std::env::temp_dir().join(format!("atlas-fngk-install-missing-test-{}", std::process::id()));
    let _ = fs::remove_dir_all(&directory);
    fs::create_dir_all(&directory).unwrap();
    let target = directory.join("fngk");
    fs::write(&target, b"old-fngk").unwrap();

    assert!(install_fngk_binary(&PathBuf::from("/definitely/not/fngk"), &target).is_err());
    assert_eq!(fs::read(&target).unwrap(), b"old-fngk");
    let _ = fs::remove_dir_all(&directory);
}

#[test]
fn rejects_a_tampered_package_binary() {
    let directory = std::env::temp_dir().join(format!("atlas-fngk-checksum-test-{}", std::process::id()));
    let _ = fs::remove_dir_all(&directory);
    fs::create_dir_all(&directory).unwrap();
    let source = directory.join("fngk");
    fs::write(&source, b"tampered").unwrap();

    assert!(verify_fngk_binary(&source, "0000000000000000000000000000000000000000000000000000000000000000").is_err());
    let _ = fs::remove_dir_all(&directory);
}
