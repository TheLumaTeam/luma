import type { ScheduleRecord } from "../../../shared/protocol";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** "Weekdays at 08:00", "Every 2 hours" or "One-time". */
export function describeSchedule(schedule: ScheduleRecord) {
  if (schedule.recurrence) {
    const { days, times } = schedule.recurrence;
    const when = days.length === 0 ? "Every day" : days.join() === "1,2,3,4,5" ? "Weekdays" : days.map((day) => DAYS[day - 1]).join(", ");
    return `${when} at ${times.join(" and ")}`;
  }
  if (!schedule.every_seconds) return "One-time";
  const minutes = Math.round(schedule.every_seconds / 60);
  return minutes < 60 ? `Every ${minutes} minutes` : `Every ${Math.round(minutes / 6) / 10} hours`;
}
