//! What Core knows about the installation it is part of.

use std::{
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct InstallRecord {
    pub luma_home: Option<String>,
    pub browsers_path: Option<String>,
    pub user_name: Option<String>,
    pub default_workspace: Option<String>,
}

/// Where the record lives, beside `config.toml`.
pub fn record_path() -> PathBuf {
    crate::config::config_dir().join("install.json")
}

/// A record that is missing or unreadable must never stop Luma from starting.
pub fn read_record(path: &Path) -> InstallRecord {
    fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_default()
}

/// Saves the values set in `changes` and keeps all others.
pub fn update_record(path: &Path, changes: InstallRecord) -> Result<()> {
    let current = read_record(path);
    let record = InstallRecord {
        luma_home: changes.luma_home.or(current.luma_home),
        browsers_path: changes.browsers_path.or(current.browsers_path),
        user_name: changes.user_name.or(current.user_name),
        default_workspace: changes.default_workspace.or(current.default_workspace),
    };

    if let Some(directory) = path.parent() {
        fs::create_dir_all(directory)
            .with_context(|| format!("Failed to create {}", directory.display()))?;
    }

    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, serde_json::to_string_pretty(&record)?)
        .with_context(|| format!("Failed to write {}", temporary.display()))?;
    fs::rename(&temporary, path).with_context(|| format!("Failed to write {}", path.display()))
}

/// The installation containing `executable`, if it is `<home>/bin/<core>`
/// beside `<home>/bundle.json` and `<home>/runtime`.
pub fn detect_home(executable: &Path) -> Option<PathBuf> {
    // `<bin dir>/luma-core` on the user's PATH is a symlink into the
    // installation. Windows is left alone: canonical paths there gain a
    // `\\?\` prefix that Node and cmd.exe cannot use.
    #[cfg(unix)]
    let executable = fs::canonicalize(executable).ok()?;

    let bin = executable.parent()?;
    if bin.file_name()? != "bin" {
        return None;
    }
    let home = bin.parent()?;
    (home.join("bundle.json").is_file() && home.join("runtime").is_dir())
        .then(|| home.to_path_buf())
}

/// The variables to set so that Core finds the installation's tools.
/// `lookup` reads the current environment, whose values win.
pub fn environment(
    home: &Path,
    record: &InstallRecord,
    lookup: impl Fn(&str) -> Option<OsString>,
) -> Vec<(&'static str, OsString)> {
    let runtime = home.join("runtime");
    let modules = runtime.join("node_modules");
    let node_directory = if cfg!(windows) {
        runtime.join("node")
    } else {
        runtime.join("node/bin")
    };

    let mut defaults: Vec<(&'static str, OsString)> = vec![
        ("LUMA_HOME", home.into()),
        (
            "LUMA_NODE_BIN",
            node_directory
                .join(if cfg!(windows) { "node.exe" } else { "node" })
                .into(),
        ),
        ("LUMA_PLAYWRIGHT_MODULE", modules.join("playwright").into()),
    ];
    let browsers = record
        .browsers_path
        .as_ref()
        .map(OsString::from)
        .or_else(|| default_browsers_path(&lookup));
    if let Some(browsers) = browsers {
        defaults.push(("PLAYWRIGHT_BROWSERS_PATH", browsers));
    }
    if let Some(version) = bundle_version(home) {
        defaults.push(("LUMA_VERSION", version.into()));
    }
    defaults.retain(|(key, _)| lookup(key).is_none());

    let mut tools = vec![
        node_directory,
        modules.join(".bin"),
        modules
            .join("@vscode")
            .join(format!("ripgrep-{}", ripgrep_platform()))
            .join("bin"),
    ];
    if cfg!(windows)
        && let Some(program_files) = lookup("ProgramFiles")
    {
        let git = PathBuf::from(program_files).join("Git");
        tools.extend(["cmd", "bin", "usr/bin"].map(|directory| git.join(directory)));
    }

    let existing = lookup("PATH").unwrap_or_default();
    let existing: Vec<PathBuf> = std::env::split_paths(&existing)
        .filter(|entry| !entry.as_os_str().is_empty())
        .collect();
    tools.retain(|tool| !existing.contains(tool));
    if let Ok(path) = std::env::join_paths(tools.into_iter().chain(existing)) {
        defaults.push(("PATH", path));
    }

    defaults
}

/// Applies [`environment`] when this executable is part of an installation.
///
/// # Safety
///
/// Changes the process environment, so no other thread may be running.
pub unsafe fn apply_environment() {
    let Some(home) = std::env::current_exe()
        .ok()
        .and_then(|executable| detect_home(&executable))
    else {
        return;
    };
    let record = read_record(&record_path());
    for (key, value) in environment(&home, &record, |key| std::env::var_os(key)) {
        // SAFETY: the caller guarantees that this is the only thread.
        unsafe { std::env::set_var(key, value) };
    }
}

fn default_browsers_path(lookup: &impl Fn(&str) -> Option<OsString>) -> Option<OsString> {
    let (base, directory) = if cfg!(windows) {
        ("LOCALAPPDATA", "ms-playwright")
    } else {
        ("HOME", ".cache/ms-playwright")
    };
    lookup(base).map(|base| PathBuf::from(base).join(directory).into())
}

fn bundle_version(home: &Path) -> Option<String> {
    let content = fs::read_to_string(home.join("bundle.json")).ok()?;
    let bundle: serde_json::Value = serde_json::from_str(&content).ok()?;
    bundle.get("version")?.as_str().map(str::to_owned)
}

/// The suffix of the `@vscode/ripgrep` package for this platform.
fn ripgrep_platform() -> String {
    let os = match std::env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        other => other,
    };
    let arch = match std::env::consts::ARCH {
        "aarch64" => "arm64",
        "x86_64" => "x64",
        other => other,
    };
    format!("{os}-{arch}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn installation(root: &Path) -> PathBuf {
        let home = root.join("Luma Home").join("luma");
        fs::create_dir_all(home.join("bin")).unwrap();
        fs::create_dir_all(home.join("runtime")).unwrap();
        fs::write(home.join("bundle.json"), r#"{"version":"9.8.7"}"#).unwrap();
        fs::write(home.join("bin/luma-core"), "").unwrap();
        home
    }

    fn resolved(
        home: &Path,
        record: &InstallRecord,
        existing: &[(&str, &str)],
    ) -> HashMap<&'static str, OsString> {
        let existing: HashMap<String, OsString> = existing
            .iter()
            .map(|(key, value)| (key.to_string(), OsString::from(value)))
            .collect();
        environment(home, record, |key| existing.get(key).cloned())
            .into_iter()
            .collect()
    }

    #[test]
    fn detects_a_core_inside_an_installation() {
        let root = tempfile::tempdir().unwrap();
        let home = installation(root.path());
        let found = detect_home(&home.join("bin/luma-core")).unwrap();
        assert_eq!(found, fs::canonicalize(&home).unwrap());
    }

    #[test]
    fn ignores_a_core_without_every_installation_marker() {
        for missing in ["bundle.json", "runtime"] {
            let root = tempfile::tempdir().unwrap();
            let home = installation(root.path());
            let path = home.join(missing);
            if path.is_dir() {
                fs::remove_dir_all(path).unwrap();
            } else {
                fs::remove_file(path).unwrap();
            }
            assert_eq!(detect_home(&home.join("bin/luma-core")), None, "{missing}");
        }
    }

    #[test]
    fn ignores_a_core_outside_a_bin_directory() {
        let root = tempfile::tempdir().unwrap();
        let home = installation(root.path());
        fs::write(home.join("luma-core"), "").unwrap();
        assert_eq!(detect_home(&home.join("luma-core")), None);
    }

    #[test]
    fn points_the_tools_at_the_installation() {
        let root = tempfile::tempdir().unwrap();
        let home = installation(root.path());
        let record = InstallRecord {
            browsers_path: Some("/custom/browsers".into()),
            ..Default::default()
        };
        let env = resolved(&home, &record, &[("PATH", "/usr/bin")]);
        assert_eq!(env["LUMA_HOME"], home.as_os_str());
        assert_eq!(env["LUMA_VERSION"], "9.8.7");
        assert_eq!(env["PLAYWRIGHT_BROWSERS_PATH"], "/custom/browsers");
        assert_eq!(
            env["LUMA_PLAYWRIGHT_MODULE"],
            home.join("runtime/node_modules/playwright").as_os_str()
        );
        let node = PathBuf::from(&env["LUMA_NODE_BIN"]);
        assert!(node.starts_with(home.join("runtime/node")));
        let path: Vec<_> = std::env::split_paths(&env["PATH"]).collect();
        assert!(path.contains(&home.join("runtime/node_modules/.bin")));
        assert_eq!(path.last(), Some(&PathBuf::from("/usr/bin")));
    }

    #[test]
    fn keeps_variables_that_are_already_set() {
        let root = tempfile::tempdir().unwrap();
        let home = installation(root.path());
        let env = resolved(
            &home,
            &InstallRecord::default(),
            &[
                ("LUMA_NODE_BIN", "/mine/node"),
                ("PLAYWRIGHT_BROWSERS_PATH", "/mine/browsers"),
            ],
        );
        assert!(!env.contains_key("LUMA_NODE_BIN"));
        assert!(!env.contains_key("PLAYWRIGHT_BROWSERS_PATH"));
    }

    #[test]
    fn does_not_repeat_path_entries() {
        let root = tempfile::tempdir().unwrap();
        let home = installation(root.path());
        let record = InstallRecord::default();
        let first = resolved(&home, &record, &[("PATH", "/usr/bin")]);
        let again = resolved(&home, &record, &[("PATH", first["PATH"].to_str().unwrap())]);
        assert_eq!(again["PATH"], first["PATH"]);
    }

    #[test]
    fn a_missing_or_corrupt_record_reads_as_empty() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("install.json");
        assert_eq!(read_record(&path), InstallRecord::default());
        fs::write(&path, "{not json").unwrap();
        assert_eq!(read_record(&path), InstallRecord::default());
    }

    #[test]
    fn updating_a_record_keeps_the_values_it_does_not_set() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("new directory/install.json");
        update_record(
            &path,
            InstallRecord {
                user_name: Some("Ada".into()),
                luma_home: Some("/old".into()),
                ..Default::default()
            },
        )
        .unwrap();
        update_record(
            &path,
            InstallRecord {
                luma_home: Some("/new".into()),
                ..Default::default()
            },
        )
        .unwrap();
        let record = read_record(&path);
        assert_eq!(record.user_name.as_deref(), Some("Ada"));
        assert_eq!(record.luma_home.as_deref(), Some("/new"));
    }
}
