//! Workspace leases: only one run at a time may change files in a workspace.
//!
//! Teammate runs take a lease just before their first tool that could change
//! files, so reading and chatting never wait. A lease is held until the run ends.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex, MutexGuard},
};

/// Tools that are not read-only but never touch workspace files. Anything that
/// isn't read-only or listed here needs the lease, including unknown MCP and
/// plugin tools.
const NEVER_TOUCHES_WORKSPACE: &[&str] = &[
    "save_memory",
    "message_user",
    "schedule_task",
    "cancel_scheduled_task",
    "create_team",
    "add_team_member",
    "add_task_dependency",
    "create_monitor",
    "delegate_task",
    "learn_workflow",
    "http_request",
    "create_issue",
    "comment_on_issue",
    "create_pull_request",
];

pub fn needs_workspace_lease(tool: &str, read_only: bool) -> bool {
    !read_only && !NEVER_TOUCHES_WORKSPACE.contains(&tool)
}

#[derive(Default)]
struct State {
    holders: HashMap<String, String>,
    /// How many leases on each workspace have ended.
    releases: HashMap<String, u64>,
}

#[derive(Clone, Default)]
pub struct WorkspaceLeases {
    state: Arc<Mutex<State>>,
}

impl WorkspaceLeases {
    fn state(&self) -> MutexGuard<'_, State> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Whether `task_id` now holds the workspace.
    pub fn try_acquire(&self, workspace: &str, task_id: &str) -> bool {
        self.state()
            .holders
            .entry(workspace.to_owned())
            .or_insert_with(|| task_id.to_owned())
            == task_id
    }

    /// Changes whenever another run may have modified the workspace.
    pub fn version(&self, workspace: &str) -> u64 {
        self.state().releases.get(workspace).copied().unwrap_or(0)
    }

    /// Releases whatever `task_id` holds when the returned guard is dropped,
    /// however the run ends.
    pub fn release_on_drop(&self, task_id: &str) -> ReleaseGuard {
        ReleaseGuard {
            leases: self.clone(),
            task_id: task_id.to_owned(),
        }
    }

    fn release(&self, task_id: &str) {
        let mut state = self.state();
        let held = state
            .holders
            .iter()
            .filter(|(_, holder)| *holder == task_id)
            .map(|(workspace, _)| workspace.clone())
            .collect::<Vec<_>>();
        for workspace in held {
            state.holders.remove(&workspace);
            *state.releases.entry(workspace).or_default() += 1;
        }
    }
}

pub struct ReleaseGuard {
    leases: WorkspaceLeases,
    task_id: String,
}

impl Drop for ReleaseGuard {
    fn drop(&mut self) {
        self.leases.release(&self.task_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_run_at_a_time_holds_a_workspace_until_it_ends() {
        let leases = WorkspaceLeases::default();
        let guard = leases.release_on_drop("a");
        assert!(leases.try_acquire("/repo", "a"));
        assert!(leases.try_acquire("/repo", "a"));
        assert!(!leases.try_acquire("/repo", "b"));
        assert!(leases.try_acquire("/other", "b"));
        assert_eq!(leases.version("/repo"), 0);
        drop(guard);
        assert_eq!(leases.version("/repo"), 1);
        assert_eq!(leases.version("/other"), 0);
        assert!(leases.try_acquire("/repo", "b"));
    }

    #[test]
    fn only_tools_that_may_change_files_need_a_lease() {
        assert!(needs_workspace_lease("write_file", false));
        assert!(needs_workspace_lease("run_command", false));
        assert!(needs_workspace_lease("mcp__anything__tool", false));
        assert!(!needs_workspace_lease("read_file", true));
        assert!(!needs_workspace_lease("save_memory", false));
    }
}
