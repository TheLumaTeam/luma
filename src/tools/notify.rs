//! Lets a Teammate start a message instead of only replying to one.

use std::sync::atomic::{AtomicUsize, Ordering};

use anyhow::{Context, Result, bail};
use serde::Deserialize;

use crate::runtime::RuntimeStore;

use super::Tool;

/// A run that needs to say more than this should put it in its reply.
const MAX_MESSAGES_PER_RUN: usize = 3;

pub struct MessageUser {
    store: RuntimeStore,
    agent_id: String,
    sent: AtomicUsize,
}

impl MessageUser {
    pub fn new(store: RuntimeStore, agent_id: impl Into<String>) -> Self {
        Self {
            store,
            agent_id: agent_id.into(),
            sent: AtomicUsize::new(0),
        }
    }
}

#[derive(Deserialize)]
struct Input {
    message: String,
}

impl Tool for MessageUser {
    fn name(&self) -> &str {
        "message_user"
    }

    fn description(&self) -> &str {
        "Send the user a short message in your main chat right now, with a notification. Use it only for something they should know before this run ends, or when your reply won't reach them (delegated or side work). Your final answer is already delivered, so never repeat it here. At most 3 per run. Input JSON: {\"message\":\"...\"}."
    }

    fn execute(&self, input: &str) -> Result<String> {
        let input: Input =
            serde_json::from_str(input).context("message_user: invalid JSON input")?;
        if self.sent.fetch_add(1, Ordering::SeqCst) >= MAX_MESSAGES_PER_RUN {
            bail!("message_user: limit reached; put the rest in your final answer");
        }
        self.store
            .send_teammate_message(&self.agent_id, &input.message)?;
        Ok("Message delivered to the user.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::{AgentKind, TaskStatus, main_conversation_id};

    #[test]
    fn a_message_lands_in_the_main_chat_and_is_rate_limited() {
        let store = RuntimeStore::open_in_memory_for_tests();
        let agent = store
            .create_agent("Ada", None, AgentKind::Teammates, Default::default())
            .unwrap();
        let tool = MessageUser::new(store.clone(), agent.id.clone());
        for _ in 0..MAX_MESSAGES_PER_RUN {
            tool.execute(r#"{"message":"Flights dropped to €90."}"#)
                .unwrap();
        }
        assert!(tool.execute(r#"{"message":"One more"}"#).is_err());

        let tasks = store.list_tasks(Some(&agent.id), 10).unwrap();
        assert_eq!(tasks.len(), MAX_MESSAGES_PER_RUN);
        assert_eq!(tasks[0].status, TaskStatus::Completed);
        assert_eq!(tasks[0].conversation_id, main_conversation_id(&agent.id));
        assert!(tasks[0].is_teammate_initiated());
        assert_eq!(
            store.task_text_response(&tasks[0].id).unwrap(),
            "Flights dropped to €90."
        );
        let notices = store
            .events_since(0, 100)
            .unwrap()
            .into_iter()
            .filter(|event| event.event_type == "teammate.notification")
            .count();
        assert_eq!(notices, MAX_MESSAGES_PER_RUN);
    }
}
