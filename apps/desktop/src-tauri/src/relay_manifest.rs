//! Certified Orbit Relay sidecar metadata.

use std::fs::File;
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

pub const RELAY_VERSION: &str = "0.1.0";
pub const PROTOCOL_VERSION: &str = "1.1.0";
pub const MINIMUM_CLIENT_PROTOCOL_VERSION: &str = "1.0.0";
pub const PROTOCOL_COMPATIBILITY_RANGE: &str = ">=1.0.0 <2.0.0";
pub const TARGET_TRIPLE: &str = "x86_64-pc-windows-msvc";
pub const SIDECAR_NAME: &str = "orbit-relay";
pub const PACKAGED_SIDECAR_FILE_NAME: &str = "orbit-relay.exe";
pub const SIDECAR_FILE_NAME: &str = "orbit-relay-x86_64-pc-windows-msvc.exe";
pub const CERTIFIED_COMMIT: &str = "a1ac82ada113d72533a599d9fafaded95b562bdc";
pub const EXPECTED_SHA256: &str =
    "F092C9F798F5CE43E6904855709366F4432A595BE00A4EBBAFC14F13913925B3";

pub fn file_sha256(path: impl AsRef<Path>) -> Result<String, String> {
    let file = File::open(path.as_ref()).map_err(|e| e.to_string())?;
    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 8192];
    loop {
        let read = reader.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:X}", hasher.finalize()))
}

pub fn verify_sha256(path: impl AsRef<Path>) -> Result<(), String> {
    let actual = file_sha256(path)?;
    if actual == EXPECTED_SHA256 {
        Ok(())
    } else {
        Err(format!(
            "Relay sidecar checksum mismatch: expected {EXPECTED_SHA256}, got {actual}"
        ))
    }
}

pub fn resolve_sidecar_path() -> Result<PathBuf, String> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf));
    if let Some(dir) = exe_dir {
        for file_name in [PACKAGED_SIDECAR_FILE_NAME, SIDECAR_FILE_NAME] {
            let path = dir.join(file_name);
            if path.exists() {
                return Ok(path);
            }
        }
    }

    let dev_candidate = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(SIDECAR_FILE_NAME);
    if dev_candidate.exists() {
        return Ok(dev_candidate);
    }

    Err(format!(
        "Relay sidecar was not found next to the app executable or in src-tauri/binaries/{SIDECAR_FILE_NAME}"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn certified_sidecar_metadata_is_v1_1() {
        assert_eq!(RELAY_VERSION, "0.1.0");
        assert_eq!(PROTOCOL_VERSION, "1.1.0");
        assert_eq!(MINIMUM_CLIENT_PROTOCOL_VERSION, "1.0.0");
        assert_eq!(PROTOCOL_COMPATIBILITY_RANGE, ">=1.0.0 <2.0.0");
        assert_eq!(TARGET_TRIPLE, "x86_64-pc-windows-msvc");
        assert_eq!(SIDECAR_NAME, "orbit-relay");
        assert_eq!(PACKAGED_SIDECAR_FILE_NAME, "orbit-relay.exe");
        assert_eq!(SIDECAR_FILE_NAME, "orbit-relay-x86_64-pc-windows-msvc.exe");
        assert_eq!(CERTIFIED_COMMIT.len(), 40);
        assert_eq!(EXPECTED_SHA256.len(), 64);
    }

    #[test]
    fn bundled_certified_sidecar_matches_expected_hash() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(SIDECAR_FILE_NAME);
        verify_sha256(&path).expect("bundled Relay sidecar hash must match certification");
    }

    #[test]
    fn resolves_sidecar_from_development_bundle_path() {
        let path = resolve_sidecar_path().expect("development sidecar path");
        assert_eq!(
            path.file_name().and_then(|name| name.to_str()),
            Some(SIDECAR_FILE_NAME)
        );
    }
}
