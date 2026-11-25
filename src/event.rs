use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum AgentEvent {
    Status {
        state: AgentStatus,
    },

    TextDelta(String),

    Thinking,

    PlanGenerated(String),

    /// Proposed file contents, emitted before the corresponding approval request.
    ChangePreview {
        path: String,
        diff: String,
    },

    ToolStarted {
        name: String,
        input: String,
    },

    ToolFinished {
        name: String,
        duration_ms: u128,
        failed: bool,
        #[serde(default)]
        diff: Option<String>,
        /// What the tool returned, shortened for display. The model still sees the full text.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        output: Option<String>,
        /// Why the tool failed, in the tool's own words.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },

    ConfirmationRequired {
        name: String,
        input: String,
    },

    /// Ask the user for information before the agent continues its ReAct loop.
    QuestionRequired {
        question_id: String,
        prompt: String,
        #[serde(default)]
        choices: Vec<String>,
    },

    SystemMessage(String),

    Error(String),

    /// The active request was cancelled by the user.
    Cancelled,

    Usage {
        prompt_tokens: u64,
        completion_tokens: u64,
        total_tokens: u64,
        cost_usd: f64,
    },

    ContextUsage {
        message_count: usize,
        character_count: usize,
        limit_chars: usize,
        compacted: bool,
    },

    Finished,

    /// Detailed tool progress with full output (for Ink retrieval)
    ToolProgress {
        name: String,
        output: String,
        progress_percent: Option<u8>,
    },

    /// Session metadata for UI header
    SessionInfo {
        workspace: String,
        model: String,
        provider: String,
        tool_count: usize,
        messages_count: usize,
    },

    /// Thinking content shown in expanded state
    ThinkingContent(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentStatus {
    Idle,
    Thinking,
    Doing,
    Talking,
    Waiting,
    Error,
}

/// Longest tool output sent to clients. Events are stored with every task, so a huge
/// build log must not be copied into each one; the agent keeps the full text.
const DISPLAY_OUTPUT_LIMIT: usize = 8_000;

/// Shortens tool output for display, cutting on a character boundary and saying so.
pub fn display_excerpt(text: &str) -> String {
    if text.len() <= DISPLAY_OUTPUT_LIMIT {
        return text.to_owned();
    }
    let mut end = DISPLAY_OUTPUT_LIMIT;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    format!(
        "{}\n… [{} more characters not shown]",
        &text[..end],
        text.len() - end
    )
}

#[cfg(test)]
mod tests {
    use super::AgentEvent;

    #[test]
    fn tool_finished_serializes_the_actual_patch_diff() {
        let event = AgentEvent::ToolFinished {
            name: "patch_file".into(),
            duration_ms: 8,
            failed: false,
            diff: Some("--- a/file.rs\n+++ b/file.rs\n-old\n+new".into()),
            output: None,
            error: None,
        };

        let value = serde_json::to_value(event).unwrap();
        assert_eq!(value["type"], "ToolFinished");
        assert_eq!(
            value["data"]["diff"],
            "--- a/file.rs\n+++ b/file.rs\n-old\n+new"
        );
    }

    #[test]
    fn tool_finished_carries_output_and_error_only_when_present() {
        let finished = AgentEvent::ToolFinished {
            name: "run_command".into(),
            duration_ms: 3,
            failed: false,
            diff: None,
            output: Some("exit code: 0 (success)".into()),
            error: None,
        };
        let value = serde_json::to_value(finished).unwrap();
        assert_eq!(value["data"]["output"], "exit code: 0 (success)");
        assert!(value["data"].get("error").is_none());

        // Older senders omit both fields; they must still parse.
        let legacy =
            r#"{"type":"ToolFinished","data":{"name":"read_file","duration_ms":1,"failed":false}}"#;
        let parsed: AgentEvent = serde_json::from_str(legacy).unwrap();
        assert!(matches!(
            parsed,
            AgentEvent::ToolFinished {
                output: None,
                error: None,
                ..
            }
        ));
    }

    #[test]
    fn display_excerpt_keeps_short_text_and_marks_cut_text() {
        assert_eq!(super::display_excerpt("short"), "short");
        let long = "é".repeat(10_000);
        let cut = super::display_excerpt(&long);
        assert!(cut.len() < long.len());
        assert!(cut.contains("more characters not shown"));
    }
}
