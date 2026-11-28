//! `luma doctor`: finds what is broken in an installation.

use std::{
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

use crate::install::InstallRecord;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Ok,
    Warning,
    Failed,
}

#[derive(Debug)]
pub struct Check {
    pub name: &'static str,
    pub status: Status,
    pub detail: String,
}

impl Check {
    fn new(name: &'static str, status: Status, detail: impl Into<String>) -> Self {
        Self {
            name,
            status,
            detail: detail.into(),
        }
    }
}

type Lookup<'a> = &'a dyn Fn(&str) -> Option<OsString>;

/// `lookup` reads the environment Core runs with.
pub fn diagnose(
    home: Option<&Path>,
    record: &InstallRecord,
    config: &Path,
    lookup: Lookup,
) -> Vec<Check> {
    let mut checks = vec![match home {
        Some(home) => Check::new("Installation", Status::Ok, home.display().to_string()),
        None => Check::new(
            "Installation",
            Status::Warning,
            "this Core was not set up by the installer",
        ),
    }];

    let node = lookup("LUMA_NODE_BIN").map(PathBuf::from);
    checks.push(runnable(
        "Node.js",
        node.or_else(|| find_on_path("node", lookup)),
    ));
    checks.push(runnable("ripgrep", find_on_path("rg", lookup)));
    checks.push(runnable("Git", find_on_path("git", lookup)));
    checks.push(playwright(lookup));
    checks.push(chromium(lookup));
    checks.push(model_settings(config));

    if let Some(home) = home {
        checks.push(install_record(home, record));
        checks.push(desktop_app(home, lookup));
    }

    checks
}

/// One line per check.
pub fn render(checks: &[Check]) -> String {
    checks
        .iter()
        .map(|check| {
            let mark = match check.status {
                Status::Ok => "ok  ",
                Status::Warning => "warn",
                Status::Failed => "FAIL",
            };
            format!("{mark}  {:<16}{}\n", check.name, check.detail)
        })
        .collect()
}

fn find_on_path(program: &str, lookup: Lookup) -> Option<PathBuf> {
    let file = format!("{program}{}", std::env::consts::EXE_SUFFIX);
    std::env::split_paths(&lookup("PATH")?)
        .map(|directory| directory.join(&file))
        .find(|candidate| candidate.is_file())
}

fn runnable(name: &'static str, program: Option<PathBuf>) -> Check {
    let Some(program) = program else {
        return Check::new(name, Status::Failed, "not found");
    };
    let result = Command::new(&program)
        .arg("--version")
        .stdin(Stdio::null())
        .output();
    match result {
        Ok(output) if output.status.success() => {
            let version = String::from_utf8_lossy(&output.stdout);
            let version = version.lines().next().unwrap_or_default().trim();
            Check::new(name, Status::Ok, version)
        }
        _ => Check::new(
            name,
            Status::Failed,
            format!("{} does not run", program.display()),
        ),
    }
}

fn playwright(lookup: Lookup) -> Check {
    match lookup("LUMA_PLAYWRIGHT_MODULE").map(PathBuf::from) {
        Some(module) if module.join("package.json").is_file() => {
            Check::new("Playwright", Status::Ok, module.display().to_string())
        }
        Some(module) => Check::new(
            "Playwright",
            Status::Failed,
            format!("missing from {}", module.display()),
        ),
        None => Check::new("Playwright", Status::Warning, "location is not set"),
    }
}

fn chromium(lookup: Lookup) -> Check {
    let Some(browsers) = lookup("PLAYWRIGHT_BROWSERS_PATH").map(PathBuf::from) else {
        return Check::new("Chromium", Status::Warning, "location is not set");
    };
    let installed = fs::read_dir(&browsers).is_ok_and(|entries| {
        entries
            .flatten()
            .any(|entry| entry.file_name().to_string_lossy().starts_with("chromium"))
    });
    if installed {
        Check::new("Chromium", Status::Ok, browsers.display().to_string())
    } else {
        Check::new(
            "Chromium",
            Status::Failed,
            format!("not installed in {}", browsers.display()),
        )
    }
}

fn model_settings(path: &Path) -> Check {
    let name = "Model settings";
    let Ok(content) = fs::read_to_string(path) else {
        return Check::new(name, Status::Warning, "not set up yet; run `luma setup`");
    };
    match toml::from_str::<crate::config::Config>(&content) {
        Ok(config) => Check::new(
            name,
            Status::Ok,
            format!("{} / {}", config.model.provider, config.model.name),
        ),
        // The parse error quotes the file, which holds API keys.
        Err(_) => Check::new(
            name,
            Status::Failed,
            format!("{} cannot be read", path.display()),
        ),
    }
}

fn install_record(home: &Path, record: &InstallRecord) -> Check {
    let name = "Install record";
    let Some(recorded) = record.luma_home.as_deref() else {
        return Check::new(name, Status::Failed, "missing");
    };
    let same = |path: &Path| fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    if same(Path::new(recorded)) == same(home) {
        Check::new(name, Status::Ok, "matches this installation")
    } else {
        Check::new(
            name,
            Status::Failed,
            format!("names another installation: {recorded}"),
        )
    }
}

/// The application and, where it is separate, its launcher entry.
fn desktop_app(home: &Path, lookup: Lookup) -> Check {
    let directory = |variable: &str| lookup(variable).map(PathBuf::from);
    let required: Vec<Option<PathBuf>> = if cfg!(target_os = "macos") {
        vec![directory("HOME").map(|user| user.join("Applications/Luma.app/Contents/MacOS/Luma"))]
    } else if cfg!(windows) {
        vec![
            Some(home.join("desktop").join("Luma.exe")),
            directory("APPDATA")
                .map(|data| data.join("Microsoft/Windows/Start Menu/Programs/Luma.lnk")),
        ]
    } else {
        let data = directory("XDG_DATA_HOME")
            .or_else(|| directory("HOME").map(|user| user.join(".local/share")));
        vec![
            Some(home.join("desktop/Luma")),
            data.map(|data| data.join("applications/luma.desktop")),
        ]
    };
    match required.into_iter().flatten().find(|path| !path.is_file()) {
        Some(missing) => Check::new(
            "Desktop app",
            Status::Failed,
            format!("missing {}", missing.display()),
        ),
        None => Check::new("Desktop app", Status::Ok, "installed"),
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::{collections::HashMap, os::unix::fs::PermissionsExt};

    struct Fixture {
        root: tempfile::TempDir,
        env: HashMap<&'static str, OsString>,
        record: InstallRecord,
    }

    impl Fixture {
        fn path(&self, relative: &str) -> PathBuf {
            self.root.path().join(relative)
        }

        fn write(&self, relative: &str, content: &str) {
            let path = self.path(relative);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, content).unwrap();
            fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
        }

        /// An installation in which every check passes.
        fn healthy() -> Self {
            let root = tempfile::tempdir().unwrap();
            let mut fixture = Self {
                root,
                env: HashMap::new(),
                record: InstallRecord::default(),
            };
            let tool = "#!/bin/sh\necho 1.0\n";
            fixture.write("luma/runtime/node/bin/node", tool);
            fixture.write("tools/rg", tool);
            fixture.write("tools/git", tool);
            fixture.write("luma/runtime/node_modules/playwright/package.json", "{}");
            fixture.write("browsers/chromium-1234/marker", "");
            fixture.write(
                "config/config.toml",
                "[model]\nprovider = \"ollama\"\nendpoint = \"http://x\"\nname = \"m\"\n",
            );
            if cfg!(target_os = "macos") {
                fixture.write("user/Applications/Luma.app/Contents/MacOS/Luma", tool);
            } else {
                fixture.write("luma/desktop/Luma", tool);
                fixture.write("user/.local/share/applications/luma.desktop", "");
            }
            fixture.record.luma_home = Some(fixture.path("luma").display().to_string());
            for (key, relative) in [
                ("HOME", "user"),
                ("PATH", "tools"),
                ("LUMA_NODE_BIN", "luma/runtime/node/bin/node"),
                (
                    "LUMA_PLAYWRIGHT_MODULE",
                    "luma/runtime/node_modules/playwright",
                ),
                ("PLAYWRIGHT_BROWSERS_PATH", "browsers"),
            ] {
                let value = fixture.path(relative).into_os_string();
                fixture.env.insert(key, value);
            }
            fixture
        }

        fn diagnose(&self) -> Vec<Check> {
            diagnose(
                Some(&self.path("luma")),
                &self.record,
                &self.path("config/config.toml"),
                &|key| self.env.get(key).cloned(),
            )
        }

        /// The names of the checks that are not passing, with their status.
        fn problems(&self) -> Vec<(&'static str, Status)> {
            self.diagnose()
                .into_iter()
                .filter(|check| check.status != Status::Ok)
                .map(|check| (check.name, check.status))
                .collect()
        }
    }

    #[test]
    fn a_healthy_installation_has_no_problems() {
        assert_eq!(Fixture::healthy().problems(), []);
    }

    #[test]
    fn each_missing_or_broken_part_is_reported_by_itself() {
        let app = if cfg!(target_os = "macos") {
            "user/Applications/Luma.app/Contents/MacOS/Luma"
        } else {
            "user/.local/share/applications/luma.desktop"
        };
        for (relative, name) in [
            ("luma/runtime/node/bin/node", "Node.js"),
            ("tools/rg", "ripgrep"),
            ("tools/git", "Git"),
            (
                "luma/runtime/node_modules/playwright/package.json",
                "Playwright",
            ),
            ("browsers/chromium-1234/marker", "Chromium"),
            (app, "Desktop app"),
        ] {
            let fixture = Fixture::healthy();
            let path = fixture.path(relative);
            fs::remove_file(&path).unwrap();
            if name == "Chromium" {
                fs::remove_dir(path.parent().unwrap()).unwrap();
            }
            assert_eq!(fixture.problems(), [(name, Status::Failed)], "{relative}");
        }
    }

    #[test]
    fn a_tool_that_cannot_run_fails() {
        let fixture = Fixture::healthy();
        fixture.write("tools/rg", "#!/bin/sh\nexit 3\n");
        assert_eq!(fixture.problems(), [("ripgrep", Status::Failed)]);
    }

    #[test]
    fn model_settings_may_be_missing_but_not_broken() {
        let fixture = Fixture::healthy();
        fs::remove_file(fixture.path("config/config.toml")).unwrap();
        assert_eq!(fixture.problems(), [("Model settings", Status::Warning)]);
        fixture.write("config/config.toml", "not = [valid");
        assert_eq!(fixture.problems(), [("Model settings", Status::Failed)]);
    }

    #[test]
    fn a_record_naming_another_installation_fails() {
        let mut fixture = Fixture::healthy();
        fixture.record.luma_home = Some("/somewhere/else".into());
        assert_eq!(fixture.problems(), [("Install record", Status::Failed)]);
    }

    #[test]
    fn a_source_build_is_not_checked_as_an_installation() {
        let fixture = Fixture::healthy();
        let checks = diagnose(
            None,
            &InstallRecord::default(),
            &fixture.path("config/config.toml"),
            &|key| fixture.env.get(key).cloned(),
        );
        assert_eq!(checks[0].status, Status::Warning);
        assert!(
            checks
                .iter()
                .all(|check| !["Desktop app", "Install record"].contains(&check.name))
        );
    }
}
