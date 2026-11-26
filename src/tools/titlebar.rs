use std::{
    env, fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

use anyhow::{Context, Result, bail};
use serde::Deserialize;

use super::Tool;

#[derive(Deserialize)]
struct TitlebarStatusInput {
    text: String,
    #[serde(default = "default_color")]
    color: String,
}

fn unix_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or_default()
}

fn default_color() -> String {
    "blue".to_string()
}

/// Where the desktop app watches for status updates. `LUMA_TITLEBAR_STATUS_FILE`
/// wins when set; otherwise both sides use the same file in the shared config
/// directory, so task workers and a long-running gateway reach the app too.
fn status_path() -> Option<PathBuf> {
    env::var_os("LUMA_TITLEBAR_STATUS_FILE")
        .map(PathBuf::from)
        .or_else(|| dirs::config_dir().map(|dir| dir.join("luma").join("titlebar-status.json")))
}

pub struct SetTitlebarStatus;

impl Tool for SetTitlebarStatus {
    fn name(&self) -> &str {
        "set_titlebar_status"
    }

    fn description(&self) -> &str {
        "Update the desktop app's titlebar status pill while you work. JSON input: {\"text\":\"Running tests\",\"color\":\"blue|green|amber|red|muted\"}. Use concise status text; set text to an empty string to restore the automatic status. The app clears it on its own when the work ends."
    }

    fn execute(&self, input: &str) -> Result<String> {
        let value: TitlebarStatusInput = serde_json::from_str(input)
            .context("set_titlebar_status expects JSON with text and optional color")?;
        if value.text.chars().count() > 48 {
            bail!("Titlebar status text must be 48 characters or fewer.");
        }
        if !["blue", "green", "amber", "red", "muted"].contains(&value.color.as_str()) {
            bail!("Unsupported status color. Choose blue, green, amber, red, or muted.");
        }
        let Some(path) = status_path() else {
            bail!("The desktop titlebar status channel is unavailable in this session.");
        };
        let parent = path
            .parent()
            .context("titlebar status path has no parent")?;
        fs::create_dir_all(parent).context("creating titlebar status directory")?;
        let temporary = path.with_extension("json.tmp");
        fs::write(
            &temporary,
            serde_json::json!({ "text": value.text, "color": value.color, "at": unix_seconds() })
                .to_string(),
        )
        .context("writing titlebar status")?;
        fs::rename(&temporary, &path).context("publishing titlebar status")?;
        Ok("Desktop titlebar status updated.".to_string())
    }

    fn is_read_only(&self) -> bool {
        true
    }
}
