//! Lets a Teammate set up its own future work when the user asks in chat.

use anyhow::{Context, Result, bail};
use chrono::{Local, NaiveDateTime};
use serde::Deserialize;

use crate::{
    recurrence::{Recurrence, resolve_local},
    runtime::{RuntimeStore, ScheduleRecord, unix_now},
};

use super::Tool;

/// Every run costs model usage, so chat can't create a busy loop.
const MIN_INTERVAL_MINUTES: u64 = 15;
const MAX_SCHEDULES_PER_TEAMMATE: usize = 20;

pub struct ScheduleTask {
    store: RuntimeStore,
    agent_id: String,
}

pub struct ListScheduledTasks {
    store: RuntimeStore,
    agent_id: String,
}

pub struct CancelScheduledTask {
    store: RuntimeStore,
    agent_id: String,
}

macro_rules! constructor {
    ($name:ident) => {
        impl $name {
            pub fn new(store: RuntimeStore, agent_id: impl Into<String>) -> Self {
                Self {
                    store,
                    agent_id: agent_id.into(),
                }
            }
        }
    };
}
constructor!(ScheduleTask);
constructor!(ListScheduledTasks);
constructor!(CancelScheduledTask);

#[derive(Deserialize)]
struct ScheduleInput {
    title: String,
    prompt: String,
    #[serde(default)]
    at: Vec<String>,
    #[serde(default)]
    days: Vec<String>,
    every_minutes: Option<u64>,
    once_at: Option<String>,
}

fn day_numbers(days: &[String]) -> Result<Vec<u8>> {
    let mut numbers = Vec::new();
    for day in days {
        let day = day.trim().to_ascii_lowercase();
        match day.as_str() {
            "daily" | "every day" | "everyday" => return Ok(Vec::new()),
            "weekdays" => numbers.extend(1..=5),
            "weekends" => numbers.extend([6, 7]),
            _ => {
                let position = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
                    .iter()
                    .position(|name| day.starts_with(name));
                match position {
                    Some(index) => numbers.push(index as u8 + 1),
                    None => bail!("unknown day '{day}'"),
                }
            }
        }
    }
    Ok(numbers)
}

fn summary(schedule: &ScheduleRecord) -> String {
    let when = if let Some(recurrence) = &schedule.recurrence {
        recurrence.describe()
    } else if let Some(seconds) = schedule.every_seconds {
        format!("every {} minutes", seconds / 60)
    } else {
        "once".to_owned()
    };
    let next = chrono::DateTime::from_timestamp(schedule.next_run_at, 0)
        .map(|moment| {
            moment
                .with_timezone(&Local)
                .format("%a %-d %b %H:%M")
                .to_string()
        })
        .unwrap_or_default();
    let state = if schedule.enabled {
        format!("next {next}")
    } else {
        "off".to_owned()
    };
    format!("{} · {} · {when} · {state}", schedule.id, schedule.title)
}

impl Tool for ScheduleTask {
    fn name(&self) -> &str {
        "schedule_task"
    }

    fn description(&self) -> &str {
        "Schedule work for yourself when the user asks for a reminder or something recurring. The prompt is what you'll receive when it runs, so make it self-contained. Times are the user's local time. Give exactly one of: at (times of day, with optional days such as [\"weekdays\"] or [\"mon\",\"thu\"]), every_minutes (at least 15), or once_at (\"2026-06-01T08:00\"). Examples: {\"title\":\"Morning brief\",\"prompt\":\"Give me today's priorities.\",\"at\":[\"08:00\"],\"days\":[\"weekdays\"]} or {\"title\":\"Call reminder\",\"prompt\":\"Remind me to call Sam.\",\"once_at\":\"2026-06-01T15:00\"}."
    }

    fn execute(&self, input: &str) -> Result<String> {
        let input: ScheduleInput =
            serde_json::from_str(input).context("schedule_task: invalid JSON input")?;
        let title = input.title.trim();
        let prompt = input.prompt.trim();
        if title.is_empty() || title.len() > 120 || prompt.is_empty() || prompt.len() > 8_000 {
            bail!("schedule_task: give a title (1–120 characters) and a prompt (1–8000)");
        }
        let chosen = usize::from(!input.at.is_empty())
            + usize::from(input.every_minutes.is_some())
            + usize::from(input.once_at.is_some());
        if chosen != 1 {
            bail!("schedule_task: give exactly one of at, every_minutes or once_at");
        }
        if input.at.is_empty() && !input.days.is_empty() {
            bail!("schedule_task: days only apply together with at");
        }
        let existing = self.store.list_schedules(Some(&self.agent_id))?;
        if existing.iter().filter(|schedule| schedule.enabled).count() >= MAX_SCHEDULES_PER_TEAMMATE
        {
            bail!("schedule_task: too many active schedules; cancel one first");
        }
        let schedule = if let Some(minutes) = input.every_minutes {
            if minutes < MIN_INTERVAL_MINUTES {
                bail!("schedule_task: every_minutes must be at least {MIN_INTERVAL_MINUTES}");
            }
            self.store.create_schedule(
                &self.agent_id,
                title,
                prompt,
                None,
                Some(minutes.saturating_mul(60)),
            )?
        } else if let Some(once_at) = input.once_at {
            let local = NaiveDateTime::parse_from_str(once_at.trim(), "%Y-%m-%dT%H:%M")
                .context("schedule_task: once_at must look like 2026-06-01T08:00")?;
            let timestamp = resolve_local(&Local, local)
                .filter(|timestamp| *timestamp > unix_now())
                .context("schedule_task: once_at must be in the future")?;
            self.store
                .create_schedule(&self.agent_id, title, prompt, Some(timestamp), None)?
        } else {
            self.store.create_recurring_schedule(
                &self.agent_id,
                title,
                prompt,
                Recurrence {
                    times: input.at,
                    days: day_numbers(&input.days)?,
                },
            )?
        };
        Ok(format!("Scheduled. {}", summary(&schedule)))
    }
}

impl Tool for ListScheduledTasks {
    fn name(&self) -> &str {
        "list_scheduled_tasks"
    }

    fn description(&self) -> &str {
        "List your own scheduled tasks and reminders with their IDs. Input JSON: {}."
    }

    fn execute(&self, _input: &str) -> Result<String> {
        let lines = self
            .store
            .list_schedules(Some(&self.agent_id))?
            .iter()
            .map(summary)
            .collect::<Vec<_>>();
        Ok(if lines.is_empty() {
            "Nothing is scheduled.".into()
        } else {
            lines.join("\n")
        })
    }

    fn is_read_only(&self) -> bool {
        true
    }
}

#[derive(Deserialize)]
struct CancelInput {
    id: String,
}

impl Tool for CancelScheduledTask {
    fn name(&self) -> &str {
        "cancel_scheduled_task"
    }

    fn description(&self) -> &str {
        "Delete one of your own scheduled tasks. Input JSON: {\"id\":\"sch_...\"}; get the ID from list_scheduled_tasks."
    }

    fn execute(&self, input: &str) -> Result<String> {
        let input: CancelInput =
            serde_json::from_str(input).context("cancel_scheduled_task: invalid JSON input")?;
        let owned = self
            .store
            .list_schedules(Some(&self.agent_id))?
            .into_iter()
            .any(|schedule| schedule.id == input.id);
        if !owned {
            bail!("cancel_scheduled_task: you have no schedule with that ID");
        }
        self.store.delete_schedule(&input.id)?;
        Ok("Cancelled.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::AgentKind;

    #[test]
    fn schedules_by_calendar_and_only_cancels_its_own() {
        let store = RuntimeStore::open_in_memory_for_tests();
        let create = |name: &str| {
            store
                .create_agent(name, None, AgentKind::Teammates, Default::default())
                .unwrap()
        };
        let (ada, bo) = (create("Ada"), create("Bo"));
        let schedule = ScheduleTask::new(store.clone(), ada.id.clone());
        let reply = schedule
            .execute(
                r#"{"title":"Brief","prompt":"Priorities","at":["08:00"],"days":["weekdays"]}"#,
            )
            .unwrap();
        assert!(reply.contains("weekdays at 08:00"), "{reply}");
        for rejected in [
            r#"{"title":"a","prompt":"b"}"#,
            r#"{"title":"a","prompt":"b","every_minutes":5}"#,
            r#"{"title":"a","prompt":"b","at":["08:00"],"every_minutes":60}"#,
            r#"{"title":"a","prompt":"b","once_at":"2001-01-01T08:00"}"#,
        ] {
            assert!(schedule.execute(rejected).is_err(), "{rejected}");
        }

        let id = store.list_schedules(Some(&ada.id)).unwrap()[0].id.clone();
        let input = format!(r#"{{"id":"{id}"}}"#);
        assert!(
            CancelScheduledTask::new(store.clone(), bo.id)
                .execute(&input)
                .is_err()
        );
        CancelScheduledTask::new(store.clone(), ada.id.clone())
            .execute(&input)
            .unwrap();
        assert!(store.list_schedules(Some(&ada.id)).unwrap().is_empty());
    }
}
