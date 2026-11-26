import { useEffect, useState } from "react";
import type { NotificationPreferences } from "../notificationPreferences";

/** When Teammates may notify you: this one's mute switch and global quiet hours. */
export function NotificationSettings({ agentId, name }: { agentId: string; name: string }) {
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void window.luma.getNotificationPreferences().then(setPreferences).catch((reason: unknown) => setError(String(reason)));
  }, []);

  if (!preferences) return error ? <p role="alert" className="luma-inspector-empty">{error}</p> : null;

  const save = (change: Partial<NotificationPreferences>) => {
    const next = { ...preferences, ...change };
    setPreferences(next);
    setError("");
    void window.luma.setNotificationPreferences(next).catch((reason: unknown) => setError(String(reason)));
  };
  const muted = preferences.mutedAgents.includes(agentId);

  return <>
    <div className="luma-settings-subheading"><h3>Notifications</h3><p>Shown when Luma is open but not in front.</p></div>
    <div className="flex flex-col gap-2 text-[12.5px]">
      <label className="flex items-center gap-2"><input type="checkbox" checked={preferences.enabled} onChange={(event) => save({ enabled: event.target.checked })} /> Notify me when Teammates reply or need me</label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={muted} disabled={!preferences.enabled} onChange={(event) => save({ mutedAgents: event.target.checked ? [...preferences.mutedAgents, agentId] : preferences.mutedAgents.filter((id) => id !== agentId) })} /> Mute {name}</label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={preferences.quietHoursEnabled} disabled={!preferences.enabled} onChange={(event) => save({ quietHoursEnabled: event.target.checked })} /> Quiet hours for all Teammates</label>
      {preferences.quietHoursEnabled && <div className="flex items-center gap-2 pl-6">
        <input type="time" aria-label="Quiet hours start" className="luma-input" value={preferences.quietStart} onChange={(event) => save({ quietStart: event.target.value })} />
        <span>to</span>
        <input type="time" aria-label="Quiet hours end" className="luma-input" value={preferences.quietEnd} onChange={(event) => save({ quietEnd: event.target.value })} />
      </div>}
      {error && <p role="alert" className="text-[var(--luma-danger)]">{error}</p>}
    </div>
  </>;
}
