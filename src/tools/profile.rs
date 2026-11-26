//! Lets a new Teammate record the job the user gives it in conversation.

use anyhow::{Context, Result, bail};
use serde::Deserialize;

use crate::runtime::RuntimeStore;

use super::Tool;

const MAX_ROLE_CHARS: usize = 160;

pub struct SetMyRole {
    store: RuntimeStore,
    agent_id: String,
}

impl SetMyRole {
    pub fn new(store: RuntimeStore, agent_id: impl Into<String>) -> Self {
        Self {
            store,
            agent_id: agent_id.into(),
        }
    }
}

#[derive(Deserialize)]
struct Input {
    role: String,
}

impl Tool for SetMyRole {
    fn name(&self) -> &str {
        "set_my_role"
    }

    fn description(&self) -> &str {
        "Record your job in one short line once the user has told you what it is, or when they change it. The user and your teammates see it. Input JSON: {\"role\":\"Plans my travel and watches fares\"}."
    }

    fn execute(&self, input: &str) -> Result<String> {
        let input: Input =
            serde_json::from_str(input).context("set_my_role: invalid JSON input")?;
        // One line, because it is shown in lists and in teammates' prompts.
        let role = input.role.split_whitespace().collect::<Vec<_>>().join(" ");
        if role.is_empty() || role.chars().count() > MAX_ROLE_CHARS {
            bail!("set_my_role: give a role of 1–{MAX_ROLE_CHARS} characters");
        }
        self.store
            .update_agent(&self.agent_id, None, Some(role), None)?;
        Ok("Saved your role.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::AgentKind;

    #[test]
    fn records_a_one_line_role_without_touching_anything_else() {
        let store = RuntimeStore::open_in_memory_for_tests();
        let agent = store
            .create_agent("Ada", None, AgentKind::Teammates, Default::default())
            .unwrap();
        let tool = SetMyRole::new(store.clone(), agent.id.clone());
        tool.execute(r#"{"role":"Plans travel\n  and watches fares"}"#)
            .unwrap();
        let saved = store.get_agent(&agent.id).unwrap().unwrap();
        assert_eq!(
            saved.description.as_deref(),
            Some("Plans travel and watches fares")
        );
        assert_eq!(saved.name, "Ada");
        assert!(tool.execute(r#"{"role":"  "}"#).is_err());
    }
}
