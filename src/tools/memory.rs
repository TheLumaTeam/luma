//! Durable memory tools exposed to Teammates.

use anyhow::{Context, Result, bail};
use serde::Deserialize;
use std::collections::HashSet;

use crate::runtime::{GLOBAL_AGENT_ID, MemoryEntry, MemoryScope, RuntimeStore};

use super::Tool;

pub struct SaveMemory {
    store: RuntimeStore,
    agent_id: String,
}

pub struct RecallMemory {
    store: RuntimeStore,
    agent_id: String,
    workspace_id: String,
    inherit_global: bool,
}

impl SaveMemory {
    pub fn new(store: RuntimeStore, agent_id: impl Into<String>) -> Self {
        Self {
            store,
            agent_id: agent_id.into(),
        }
    }
}

impl RecallMemory {
    pub fn new(
        store: RuntimeStore,
        agent_id: impl Into<String>,
        workspace_id: impl Into<String>,
        inherit_global: bool,
    ) -> Self {
        Self {
            store,
            agent_id: agent_id.into(),
            workspace_id: workspace_id.into(),
            inherit_global,
        }
    }
}

#[derive(Deserialize)]
struct SaveInput {
    content: String,
    /// Load this at the start of every task, whatever the message says.
    #[serde(default)]
    core: bool,
}

/// What `save_memory` records for an ordinary entry. Any other source means the
/// user wrote the entry or the Teammate marked it as core.
const TEAMMATE_SOURCE: &str = "teammate";
const CORE_SOURCE: &str = "teammate:core";
const MAX_CORE_ENTRIES: usize = 30;
const MAX_CORE_CHARS: usize = 6_000;

/// The memories every task starts with: what the user wrote and what the
/// Teammate marked as core. Newest first, within a fixed budget.
pub(crate) fn core_memories(
    store: &RuntimeStore,
    agent_id: &str,
    inherit_global: bool,
) -> Result<Vec<MemoryEntry>> {
    let mut scopes = vec![(MemoryScope::Agent, agent_id)];
    if inherit_global {
        scopes.push((MemoryScope::User, "default"));
        if agent_id != GLOBAL_AGENT_ID {
            scopes.push((MemoryScope::Agent, GLOBAL_AGENT_ID));
        }
    }
    let mut entries = Vec::new();
    for (scope, scope_id) in scopes {
        entries.extend(
            store
                .list_memory(scope, scope_id, None, 500)?
                .into_iter()
                .filter(|entry| entry.source.as_deref() != Some(TEAMMATE_SOURCE)),
        );
    }
    entries.sort_by_key(|entry| std::cmp::Reverse(entry.updated_at));
    let mut seen = HashSet::new();
    let mut used = 0;
    entries.retain(|entry| {
        let length = entry.content.chars().count();
        let keep = seen.len() < MAX_CORE_ENTRIES
            && used + length <= MAX_CORE_CHARS
            && seen.insert(normalize(&entry.content));
        if keep {
            used += length;
        }
        keep
    });
    Ok(entries)
}

#[derive(Deserialize)]
struct RecallInput {
    query: String,
}

impl Tool for SaveMemory {
    fn name(&self) -> &str {
        "save_memory"
    }

    fn description(&self) -> &str {
        "Save a durable fact, user preference, project decision, or useful lesson for this teammate to remember across future tasks. Do not save temporary task state, secrets, credentials, or sensitive personal information. Input JSON: {\"content\":\"...\",\"core\":false}. Set core to true only for things you must always know: the user's name, standing preferences and standing rules. Saves to this teammate's private memory."
    }

    fn execute(&self, input: &str) -> Result<String> {
        let input: SaveInput =
            serde_json::from_str(input).context("save_memory: invalid JSON input")?;
        let content = input.content.trim();
        if content.is_empty() || content.len() > 8_000 {
            bail!("save_memory: content must contain 1–8000 characters");
        }
        let existing = self
            .store
            .list_memory(MemoryScope::Agent, &self.agent_id, None, 500)?;
        let normalized = normalize(content);
        if let Some(entry) = existing
            .into_iter()
            .find(|entry| normalize(&entry.content) == normalized)
        {
            let promote = input.core && entry.source.as_deref() == Some(TEAMMATE_SOURCE);
            if !promote {
                return Ok(format!("Already remembered ({}).", entry.id));
            }
            self.store.delete_memory(&entry.id)?;
        }
        let entry = self.store.add_memory(
            MemoryScope::Agent,
            &self.agent_id,
            content,
            Some(
                if input.core {
                    CORE_SOURCE
                } else {
                    TEAMMATE_SOURCE
                }
                .into(),
            ),
        )?;
        Ok(format!(
            "Saved to your long-term memory ({}). You can recall it in future tasks.",
            entry.id
        ))
    }
}

impl Tool for RecallMemory {
    fn name(&self) -> &str {
        "recall_memory"
    }

    fn description(&self) -> &str {
        "Search durable memories before making assumptions about previously discussed preferences, decisions, project context, or lessons. Input JSON: {\"query\":\"keywords or topic\"}. Searches this teammate's memory and any shared context it is allowed to use."
    }

    fn execute(&self, input: &str) -> Result<String> {
        let input: RecallInput =
            serde_json::from_str(input).context("recall_memory: invalid JSON input")?;
        let query = input.query.trim();
        if query.is_empty() || query.len() > 1_000 {
            bail!("recall_memory: query must contain 1–1000 characters");
        }
        let mut scopes = vec![
            (MemoryScope::Agent, self.agent_id.as_str(), "this teammate"),
            (
                MemoryScope::Project,
                self.workspace_id.as_str(),
                "this workspace",
            ),
        ];
        if self.inherit_global {
            scopes.push((MemoryScope::Agent, GLOBAL_AGENT_ID, "Global teammate"));
            scopes.push((MemoryScope::User, "default", "shared user"));
        }
        let mut candidates = Vec::new();
        for (scope, scope_id, label) in scopes {
            for entry in self.store.list_memory(scope, scope_id, None, 500)? {
                let score = relevance_score(query, &entry.content);
                if score > 0 {
                    candidates.push((score, entry.updated_at, label, entry));
                }
            }
        }
        candidates.sort_by(|left, right| right.0.cmp(&left.0).then_with(|| right.1.cmp(&left.1)));
        let mut seen = HashSet::new();
        let matches = candidates
            .into_iter()
            .filter_map(|(_, _, label, entry)| {
                let key = normalize(&entry.content);
                seen.insert(key)
                    .then(|| format!("- [{label}] {}", entry.content))
            })
            .take(12)
            .collect::<Vec<_>>();
        if matches.is_empty() {
            Ok("No matching saved memories. You can still answer using the current conversation and available project context.".into())
        } else {
            Ok(format!("Relevant saved memories:\n{}", matches.join("\n")))
        }
    }

    fn is_read_only(&self) -> bool {
        true
    }
}

/// Rank by meaningful query terms instead of requiring one contiguous SQL
/// substring. Exact phrases and coverage of distinct terms score highest.
pub(crate) fn relevance_score(query: &str, content: &str) -> usize {
    let query_terms = terms(query);
    if query_terms.is_empty() {
        return 0;
    }
    let content_lower = content.to_lowercase();
    let content_terms = terms(content);
    let matched = query_terms
        .iter()
        .filter(|term| content_terms.contains(*term))
        .count();
    if matched == 0 {
        return 0;
    }
    let phrase_bonus = usize::from(content_lower.contains(&query.to_lowercase())) * 3;
    matched * 10 + phrase_bonus + usize::from(matched == query_terms.len()) * 5
}

fn terms(value: &str) -> HashSet<String> {
    value
        .split(|character: char| !character.is_alphanumeric())
        .filter(|term| term.chars().count() >= 2)
        .map(str::to_lowercase)
        .collect()
}

fn normalize(value: &str) -> String {
    let mut terms = terms(value).into_iter().collect::<Vec<_>>();
    terms.sort();
    terms.join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::{AgentConfiguration, AgentKind};

    #[test]
    fn core_memory_holds_user_notes_and_flagged_saves_only() {
        let store = RuntimeStore::open_in_memory_for_tests();
        let agent = store
            .create_agent(
                "Ada",
                None,
                AgentKind::Teammates,
                AgentConfiguration::default(),
            )
            .unwrap();
        let save = SaveMemory::new(store.clone(), agent.id.clone());
        save.execute(r#"{"content":"Trip research is in the travel folder."}"#)
            .unwrap();
        save.execute(r#"{"content":"The user is called Sam.","core":true}"#)
            .unwrap();
        store
            .add_memory(
                MemoryScope::Agent,
                &agent.id,
                "Never book red-eye flights.",
                Some("desktop".into()),
            )
            .unwrap();
        store
            .add_memory(MemoryScope::User, "default", "Prefers metric units.", None)
            .unwrap();
        let contents = |inherit_global| {
            let mut contents = core_memories(&store, &agent.id, inherit_global)
                .unwrap()
                .into_iter()
                .map(|entry| entry.content)
                .collect::<Vec<_>>();
            contents.sort();
            contents
        };
        assert_eq!(
            contents(false),
            ["Never book red-eye flights.", "The user is called Sam."]
        );
        assert_eq!(contents(true).len(), 3);

        // Saving an existing fact as core promotes it without duplicating it.
        save.execute(r#"{"content":"Trip research is in the travel folder.","core":true}"#)
            .unwrap();
        assert_eq!(contents(false).len(), 3);
    }

    #[test]
    fn teammate_can_save_and_recall_its_own_memories() {
        let store = RuntimeStore::open_in_memory_for_tests();
        let agent = store
            .create_agent(
                "Researcher",
                None,
                AgentKind::Teammates,
                AgentConfiguration::default(),
            )
            .unwrap();
        let save = SaveMemory::new(store.clone(), agent.id.clone());
        let recall = RecallMemory::new(store.clone(), agent.id.clone(), "/workspace", false);
        assert!(
            save.execute(r#"{"content":"The project uses SQLite for durable runtime state."}"#)
                .unwrap()
                .contains("Saved")
        );
        let result = recall.execute(r#"{"query":"SQLite"}"#).unwrap();
        assert!(result.contains("SQLite for durable runtime state"));
        assert!(!result.contains("shared user"));
        assert!(
            save.execute(r#"{"content":"The project uses SQLite for durable runtime state."}"#)
                .unwrap()
                .contains("Already remembered")
        );
        assert_eq!(
            store
                .list_memory(MemoryScope::Agent, &agent.id, None, 20)
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn recall_only_includes_shared_memories_when_global_context_is_enabled() {
        let store = RuntimeStore::open_in_memory_for_tests();
        let agent = store
            .create_agent(
                "Private",
                None,
                AgentKind::Teammates,
                AgentConfiguration::default(),
            )
            .unwrap();
        store
            .add_memory(
                MemoryScope::Agent,
                GLOBAL_AGENT_ID,
                "Shared project convention: use conventional commits.",
                Some("test".into()),
            )
            .unwrap();
        let private_recall =
            RecallMemory::new(store.clone(), agent.id.clone(), "/workspace", false);
        assert!(
            private_recall
                .execute(r#"{"query":"conventional commits"}"#)
                .unwrap()
                .contains("No matching saved memories")
        );
        let shared_recall = RecallMemory::new(store, agent.id, "/workspace", true);
        assert!(
            shared_recall
                .execute(r#"{"query":"conventional commits"}"#)
                .unwrap()
                .contains("Shared project convention")
        );
    }

    #[test]
    fn recall_ranks_related_terms_without_contiguous_substring_match() {
        let store = RuntimeStore::open_in_memory_for_tests();
        let agent = store
            .create_agent(
                "Researcher",
                None,
                AgentKind::Teammates,
                AgentConfiguration::default(),
            )
            .unwrap();
        store
            .add_memory(
                MemoryScope::Agent,
                &agent.id,
                "The user prefers concise technical explanations.",
                None,
            )
            .unwrap();
        store
            .add_memory(
                MemoryScope::Agent,
                &agent.id,
                "The project uses a blue sidebar.",
                None,
            )
            .unwrap();
        let recall = RecallMemory::new(store, agent.id, "/workspace", false);
        let result = recall
            .execute(r#"{"query":"technical concise preferences"}"#)
            .unwrap();
        assert!(result.contains("prefers concise technical explanations"));
        assert!(!result.contains("blue sidebar"));
    }

    #[test]
    fn saving_same_fact_with_different_punctuation_does_not_duplicate_it() {
        let store = RuntimeStore::open_in_memory_for_tests();
        let agent = store
            .create_agent(
                "Researcher",
                None,
                AgentKind::Teammates,
                AgentConfiguration::default(),
            )
            .unwrap();
        let save = SaveMemory::new(store.clone(), agent.id.clone());
        save.execute(r#"{"content":"Prefer concise, technical answers."}"#)
            .unwrap();
        assert!(
            save.execute(r#"{"content":"Prefer concise technical answers"}"#)
                .unwrap()
                .contains("Already remembered")
        );
        assert_eq!(
            store
                .list_memory(MemoryScope::Agent, &agent.id, None, 20)
                .unwrap()
                .len(),
            1
        );
    }
}
