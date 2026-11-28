pub mod setup;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, fs, path::PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Config {
    pub model: ModelConfig,

    #[serde(default)]
    pub providers: Vec<crate::provider::SupportedProvider>,

    /// Credentials remembered per provider so changing models does not
    /// require entering the same API key again.
    #[serde(default)]
    pub provider_api_keys: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ModelConfig {
    pub provider: String,

    pub endpoint: String,

    pub name: String,

    pub api_key: Option<String>,
}

/// Returns the directory containing Luma's configuration.
///
/// macOS:
/// ~/Library/Application Support/luma
///
/// Linux:
/// ~/.config/luma
///
/// Windows:
/// %APPDATA%/luma
pub fn config_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("luma")
}

/// Returns the path to Luma's configuration file.
pub fn config_path() -> PathBuf {
    config_dir().join("config.toml")
}

pub fn exists() -> bool {
    config_path().is_file()
}

pub fn load() -> Result<Config> {
    let path = config_path();

    let content = fs::read_to_string(&path)
        .with_context(|| format!("Failed to read Luma config at {}", path.display()))?;

    let config = toml::from_str(&content)
        .with_context(|| format!("Failed to parse Luma config at {}", path.display()))?;

    Ok(config)
}

pub fn load_or_default() -> Result<Config> {
    if !exists() {
        return Ok(Config::default());
    }

    load()
}

pub fn save(config: &Config) -> Result<()> {
    let directory = config_dir();
    let path = config_path();

    fs::create_dir_all(&directory).with_context(|| {
        format!(
            "Failed to create Luma config directory at {}",
            directory.display()
        )
    })?;

    let content = toml::to_string_pretty(config).context("Failed to serialize Luma config")?;

    let temporary_path = directory.join("config.toml.tmp");

    write_private(&temporary_path, &content).with_context(|| {
        format!(
            "Failed to write temporary config at {}",
            temporary_path.display()
        )
    })?;

    fs::rename(&temporary_path, &path)
        .with_context(|| format!("Failed to move config into place at {}", path.display()))?;

    Ok(())
}

/// Writes a file that holds API keys, readable only by its owner on Unix.
fn write_private(path: &std::path::Path, content: &str) -> std::io::Result<()> {
    use std::io::Write;

    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    // `mode` only applies to new files.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(fs::Permissions::from_mode(0o600))?;
    }
    file.write_all(content.as_bytes())
}

#[cfg(all(test, unix))]
mod permission_tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn writes_credentials_readable_only_by_the_owner() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.toml.tmp");
        // A leftover file with wider permissions must be tightened too.
        fs::write(&path, "old").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
        write_private(&path, "api_key = \"secret\"").unwrap();
        let mode = fs::metadata(&path).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
        assert_eq!(fs::read_to_string(&path).unwrap(), "api_key = \"secret\"");
    }
}
