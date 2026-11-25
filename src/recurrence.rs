//! Calendar recurrence for schedules, such as "weekdays at 08:00" in the
//! user's local time.

use anyhow::{Result, anyhow, bail};
use chrono::{DateTime, Datelike, Duration, NaiveDateTime, NaiveTime, TimeZone};
use serde::{Deserialize, Serialize};

const MAX_TIMES: usize = 8;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Recurrence {
    /// Local times of day as "HH:MM".
    pub times: Vec<String>,
    /// Days to run, Monday = 1 through Sunday = 7. Empty means every day.
    #[serde(default)]
    pub days: Vec<u8>,
}

pub fn parse_time(value: &str) -> Result<NaiveTime> {
    NaiveTime::parse_from_str(value.trim(), "%H:%M")
        .map_err(|_| anyhow!("'{value}' is not a 24-hour HH:MM time"))
}

impl Recurrence {
    /// Check the rule and put it in a canonical order.
    pub fn normalized(mut self) -> Result<Self> {
        if self.times.is_empty() || self.times.len() > MAX_TIMES {
            bail!("give between 1 and {MAX_TIMES} times of day");
        }
        let mut times = self
            .times
            .iter()
            .map(|time| parse_time(time))
            .collect::<Result<Vec<_>>>()?;
        times.sort();
        times.dedup();
        self.times = times
            .iter()
            .map(|time| time.format("%H:%M").to_string())
            .collect();
        if self.days.iter().any(|day| !(1..=7).contains(day)) {
            bail!("days run from 1 (Monday) to 7 (Sunday)");
        }
        self.days.sort_unstable();
        self.days.dedup();
        Ok(self)
    }

    /// The first occurrence strictly after `after` (Unix seconds) in `zone`.
    pub fn next_after<Z: TimeZone>(&self, zone: &Z, after: i64) -> Result<i64> {
        let start: DateTime<Z> = zone
            .timestamp_opt(after, 0)
            .earliest()
            .ok_or_else(|| anyhow!("invalid timestamp"))?;
        let today = start.date_naive();
        // Eight days covers a weekly rule whose time has passed today.
        for offset in 0..=8 {
            let date = today + Duration::days(offset);
            let weekday = date.weekday().number_from_monday() as u8;
            if !self.days.is_empty() && !self.days.contains(&weekday) {
                continue;
            }
            for time in &self.times {
                let local = date.and_time(parse_time(time)?);
                if let Some(timestamp) = resolve_local(zone, local)
                    && timestamp > after
                {
                    return Ok(timestamp);
                }
            }
        }
        bail!("the schedule has no upcoming time")
    }

    pub fn describe(&self) -> String {
        const NAMES: [&str; 7] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
        let days = match self.days.as_slice() {
            [] => "every day".to_owned(),
            [1, 2, 3, 4, 5] => "weekdays".to_owned(),
            days => days
                .iter()
                .filter_map(|day| NAMES.get(usize::from(day.saturating_sub(1))))
                .copied()
                .collect::<Vec<_>>()
                .join(", "),
        };
        format!("{days} at {}", self.times.join(" and "))
    }
}

/// A local time as Unix seconds. A time skipped by a clock change runs an hour
/// later; a repeated one runs the first time.
pub fn resolve_local<Z: TimeZone>(zone: &Z, local: NaiveDateTime) -> Option<i64> {
    zone.from_local_datetime(&local)
        .earliest()
        .or_else(|| {
            zone.from_local_datetime(&(local + Duration::hours(1)))
                .earliest()
        })
        .map(|moment| moment.timestamp())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{FixedOffset, NaiveDate};

    fn zone() -> FixedOffset {
        FixedOffset::east_opt(3 * 3600 + 1800).unwrap()
    }

    fn at(day: u32, hour: u32, minute: u32) -> i64 {
        // June 2026: the 5th is a Friday.
        let local = NaiveDate::from_ymd_opt(2026, 6, day)
            .unwrap()
            .and_hms_opt(hour, minute, 0)
            .unwrap();
        resolve_local(&zone(), local).unwrap()
    }

    #[test]
    fn weekday_rules_skip_the_weekend() {
        let rule = Recurrence {
            times: vec!["15:00".into(), "9:00".into()],
            days: vec![5, 1, 2, 3, 4],
        }
        .normalized()
        .unwrap();
        assert_eq!(rule.describe(), "weekdays at 09:00 and 15:00");
        assert_eq!(rule.next_after(&zone(), at(5, 8, 0)).unwrap(), at(5, 9, 0));
        assert_eq!(rule.next_after(&zone(), at(5, 9, 0)).unwrap(), at(5, 15, 0));
        assert_eq!(rule.next_after(&zone(), at(5, 15, 0)).unwrap(), at(8, 9, 0));
    }

    #[test]
    fn a_weekly_rule_waits_a_full_week_once_its_time_passes() {
        let rule = Recurrence {
            times: vec!["08:00".into()],
            days: vec![5],
        };
        assert_eq!(rule.next_after(&zone(), at(5, 8, 0)).unwrap(), at(12, 8, 0));
    }

    #[test]
    fn rejects_empty_or_impossible_rules() {
        let rule = |times: &[&str], days: &[u8]| {
            Recurrence {
                times: times.iter().map(|time| (*time).into()).collect(),
                days: days.to_vec(),
            }
            .normalized()
        };
        assert!(rule(&[], &[]).is_err());
        assert!(rule(&["25:00"], &[]).is_err());
        assert!(rule(&["08:00"], &[8]).is_err());
    }
}
