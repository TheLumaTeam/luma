//! Group chats: one conversation shared by a Team of two to six Teammates.

use std::collections::HashSet;

use anyhow::{Result, anyhow, bail};
use serde::{Deserialize, Serialize};

use crate::runtime::{AgentRecord, AgentStatus, TaskStatus};

pub const MIN_MEMBERS: usize = 2;
pub const MAX_MEMBERS: usize = 6;
const GROUP_PREFIX: &str = "conversation_group_";

pub fn conversation_id(team_id: &str) -> String {
    format!("{GROUP_PREFIX}{team_id}")
}

/// The Team a conversation belongs to, if it is a group chat.
pub fn team_of(conversation_id: &str) -> Option<&str> {
    conversation_id.strip_prefix(GROUP_PREFIX)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GroupRecord {
    pub id: String,
    pub name: String,
    pub member_ids: Vec<String>,
}

/// One line of a group transcript. `author_id` is `None` for the user.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GroupMessage {
    pub id: String,
    pub task_id: String,
    pub author_id: Option<String>,
    pub text: String,
    pub status: Option<TaskStatus>,
    pub created_at: i64,
}

/// Whether `text` addresses `name` with an @mention.
pub fn mentions(text: &str, name: &str) -> bool {
    let text = text.to_lowercase();
    let needle = format!("@{}", name.to_lowercase());
    text.match_indices(&needle).any(|(start, found)| {
        let before = text[..start].chars().next_back();
        let after = text[start + found.len()..].chars().next();
        !before.is_some_and(char::is_alphanumeric) && !after.is_some_and(char::is_alphanumeric)
    })
}

/// Who a message from the user is for: those mentioned, or else everyone who
/// can currently reply.
pub fn recipients<'a>(text: &str, members: &'a [AgentRecord]) -> Result<Vec<&'a AgentRecord>> {
    let named = members
        .iter()
        .filter(|member| mentions(text, &member.name))
        .collect::<Vec<_>>();
    let everyone = named.is_empty() || mentions(text, "everyone");
    let addressed: Vec<_> = if everyone {
        members.iter().collect()
    } else {
        named
    };
    let available = addressed
        .into_iter()
        .filter(|member| !matches!(member.status, AgentStatus::Paused | AgentStatus::Stopped))
        .collect::<Vec<_>>();
    if available.is_empty() {
        bail!("everyone you addressed is paused or stopped");
    }
    Ok(available)
}

pub fn validate_members(member_ids: &[String]) -> Result<()> {
    let unique = member_ids.iter().collect::<HashSet<_>>();
    if unique.len() != member_ids.len() {
        return Err(anyhow!("each teammate can be in a group once"));
    }
    if !(MIN_MEMBERS..=MAX_MEMBERS).contains(&member_ids.len()) {
        bail!("a group needs {MIN_MEMBERS} to {MAX_MEMBERS} teammates");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mentions_match_whole_names_only() {
        assert!(mentions("thanks @Bo, over to you", "bo"));
        assert!(mentions("@Research Lead: thoughts?", "research lead"));
        assert!(!mentions("ask @Bob", "Bo"));
        assert!(!mentions("mail sam@bo.test", "bo"));
    }

    #[test]
    fn groups_hold_two_to_six_distinct_members() {
        let ids = |count: usize| (0..count).map(|n| n.to_string()).collect::<Vec<_>>();
        assert!(validate_members(&ids(2)).is_ok());
        assert!(validate_members(&ids(6)).is_ok());
        assert!(validate_members(&ids(1)).is_err());
        assert!(validate_members(&ids(7)).is_err());
        assert!(validate_members(&["a".into(), "a".into()]).is_err());
    }
}
