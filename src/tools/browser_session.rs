//! A Teammate's own browser: a profile that keeps its sign-ins, a picture of
//! what it last showed, and one lock so only one side drives it at a time.

use std::{
    fs::{File, OpenOptions, TryLockError},
    path::{Path, PathBuf},
};

use anyhow::{Context, Result, anyhow, bail};
use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::runtime::RuntimeStore;

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
        Self::under(&browser_directory(), agent_id)
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

/// Delete a Teammate together with its sign-ins. Every way of deleting one
/// must come through here. Nothing is deleted while its browser is in use.
pub fn delete_teammate(store: &RuntimeStore, agent_id: &str) -> Result<bool> {
    delete_teammate_in(&browser_directory(), store, agent_id)
}

fn delete_teammate_in(base: &Path, store: &RuntimeStore, agent_id: &str) -> Result<bool> {
    let profile = BrowserProfile::under(base, agent_id).ok();
    // A Teammate that never browsed has nothing to lock or remove.
    let Some(profile) = profile.filter(|profile| profile.root.exists()) else {
        return store.delete_agent(agent_id);
    };
    let Some(lock) = profile.try_lock()? else {
        bail!("this Teammate's browser is in use; press I'm done or stop its work first");
    };
    let deleted = store.delete_agent(agent_id)?;
    if deleted {
        // Windows can't remove a file that is still open.
        drop(lock);
        std::fs::remove_dir_all(&profile.root).with_context(|| {
            format!(
                "the Teammate was deleted, but its browser sign-ins remain in {}. Luma will try again when it next starts",
                profile.root.display()
            )
        })?;
    }
    Ok(deleted)
}

/// Remove browser data whose Teammate no longer exists, such as after a failed
/// removal.
pub fn remove_orphaned_profiles(store: &RuntimeStore) -> Result<()> {
    remove_orphans_in(&browser_directory(), store)
}

fn remove_orphans_in(base: &Path, store: &RuntimeStore) -> Result<()> {
    let entries = match std::fs::read_dir(base) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error).context("could not list browser data"),
    };
    for entry in entries.flatten() {
        let Some(agent_id) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if entry.file_type().is_ok_and(|kind| kind.is_dir())
            && store.get_agent(&agent_id)?.is_none()
            && let Ok(profile) = BrowserProfile::under(base, &agent_id)
            && let Err(error) = profile.clear()
        {
            tracing::warn!(%error, "could not remove orphaned browser data");
        }
    }
    Ok(())
}

fn browser_directory() -> PathBuf {
    crate::config::config_dir().join("browser")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::AgentKind;

    #[test]
    fn deleting_a_teammate_never_leaves_sign_ins_behind_silently() {
        let directory = tempfile::tempdir().unwrap();
        let store = RuntimeStore::open_in_memory_for_tests();
        let create = |name: &str| {
            store
                .create_agent(name, None, AgentKind::Teammates, Default::default())
                .unwrap()
                .id
        };
        let profile = |id: &str| BrowserProfile::under(directory.path(), id).unwrap();

        let busy = create("Ada");
        let held = profile(&busy).try_lock().unwrap().unwrap();
        assert!(delete_teammate_in(directory.path(), &store, &busy).is_err());
        assert!(store.get_agent(&busy).unwrap().is_some());
        drop(held);
        assert!(delete_teammate_in(directory.path(), &store, &busy).unwrap());
        assert!(!profile(&busy).root.exists());

        let never_browsed = create("Bo");
        assert!(delete_teammate_in(directory.path(), &store, &never_browsed).unwrap());
        assert!(!profile(&never_browsed).root.exists());

        let kept = create("Cy");
        profile(&kept).prepare().unwrap();
        profile("agent_gone").prepare().unwrap();
        remove_orphans_in(directory.path(), &store).unwrap();
        assert!(profile(&kept).root.exists());
        assert!(!profile("agent_gone").root.exists());
    }

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
