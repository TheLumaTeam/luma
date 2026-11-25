//! A Teammate's own browser: a profile that keeps its sign-ins, a picture of
//! what it last showed, and one lock so only one side drives it at a time.

use std::{
    fs::{File, OpenOptions, TryLockError},
    path::{Path, PathBuf},
};

use anyhow::{Context, Result, anyhow, bail};
use base64::Engine;
use serde::{Deserialize, Serialize};

const MAX_IMAGE_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Debug, Clone)]
pub struct BrowserProfile {
    root: PathBuf,
}

/// The files the browser process reads and writes.
#[derive(Debug, Clone, Serialize)]
pub struct SessionPaths {
    pub profile_dir: PathBuf,
    pub image_path: PathBuf,
    pub state_path: PathBuf,
}

#[derive(Debug, Default, Deserialize)]
struct State {
    url: Option<String>,
    title: Option<String>,
    updated_at: Option<i64>,
}

/// What a client shows of a Teammate's browser.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BrowserView {
    pub agent_id: String,
    pub url: Option<String>,
    pub title: Option<String>,
    pub updated_at: Option<i64>,
    /// The latest JPEG screenshot, base64 encoded.
    pub image: Option<String>,
    pub in_control: bool,
}

impl BrowserProfile {
    pub fn for_agent(agent_id: &str) -> Result<Self> {
        Self::under(&crate::config::config_dir().join("browser"), agent_id)
    }

    fn under(base: &Path, agent_id: &str) -> Result<Self> {
        // The ID becomes a directory name.
        if agent_id.is_empty()
            || !agent_id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        {
            bail!("invalid teammate ID");
        }
        Ok(Self {
            root: base.join(agent_id),
        })
    }

    /// Create the directories, readable only by the user: they hold sign-ins.
    pub fn prepare(&self) -> Result<SessionPaths> {
        let paths = self.paths();
        std::fs::create_dir_all(&paths.profile_dir)
            .context("could not create the browser profile")?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            for directory in [&self.root, &paths.profile_dir] {
                std::fs::set_permissions(directory, std::fs::Permissions::from_mode(0o700))?;
            }
        }
        Ok(paths)
    }

    fn paths(&self) -> SessionPaths {
        SessionPaths {
            profile_dir: self.root.join("profile"),
            image_path: self.root.join("latest.jpg"),
            state_path: self.root.join("state.json"),
        }
    }

    /// Hold the browser until the returned file is dropped; `None` means someone
    /// else has it. The system releases it if the holder dies.
    pub fn try_lock(&self) -> Result<Option<File>> {
        self.prepare()?;
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(self.root.join("lock"))
            .context("could not open the browser lock")?;
        match file.try_lock() {
            Ok(()) => Ok(Some(file)),
            Err(TryLockError::WouldBlock) => Ok(None),
            Err(TryLockError::Error(error)) => {
                Err(anyhow!(error).context("could not lock the browser"))
            }
        }
    }

    pub fn view(&self, agent_id: &str, in_control: bool) -> BrowserView {
        let paths = self.paths();
        let state = std::fs::read(&paths.state_path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<State>(&bytes).ok())
            .unwrap_or_default();
        let image = std::fs::metadata(&paths.image_path)
            .ok()
            .filter(|metadata| metadata.len() <= MAX_IMAGE_BYTES)
            .and_then(|_| std::fs::read(&paths.image_path).ok())
            .map(|bytes| base64::engine::general_purpose::STANDARD.encode(bytes));
        BrowserView {
            agent_id: agent_id.to_owned(),
            url: state.url,
            title: state.title,
            updated_at: state.updated_at,
            image,
            in_control,
        }
    }

    /// Forget every sign-in and what the browser last showed.
    pub fn clear(&self) -> Result<()> {
        let Some(lock) = self.try_lock()? else {
            bail!("the browser is in use; finish with it first");
        };
        drop(lock);
        match std::fs::remove_dir_all(&self.root) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error).context("could not clear the browser data"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_holder_at_a_time_and_clearing_forgets_everything() {
        let directory = tempfile::tempdir().unwrap();
        let profile = BrowserProfile::under(directory.path(), "agent_1").unwrap();
        let held = profile.try_lock().unwrap().unwrap();
        assert!(profile.try_lock().unwrap().is_none());
        assert!(profile.clear().is_err());
        drop(held);

        let paths = profile.prepare().unwrap();
        std::fs::write(&paths.state_path, r#"{"url":"https://example.com/"}"#).unwrap();
        std::fs::write(&paths.image_path, b"jpg").unwrap();
        let view = profile.view("agent_1", false);
        assert_eq!(view.url.as_deref(), Some("https://example.com/"));
        assert_eq!(view.image.as_deref(), Some("anBn"));
        profile.clear().unwrap();
        assert!(profile.view("agent_1", false).image.is_none());
        assert!(BrowserProfile::under(directory.path(), "../escape").is_err());
    }
}
