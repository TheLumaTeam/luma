// Main-process notifications for what Teammates say while the user is elsewhere.
import { Notification } from "electron";
import fs from "node:fs/promises";
import type { RuntimeEvent } from "../../shared/protocol";
import type { NotificationPreferences } from "./notificationPreferences";
import { defaultNotificationPreferences, parseNotificationPreferences, shouldNotify } from "./notificationPreferences";

let preferences: NotificationPreferences = defaultNotificationPreferences;

export function getNotificationPreferences() {
  return preferences;
}

export async function loadNotificationPreferences(file: string) {
  try {
    preferences = parseNotificationPreferences(JSON.parse(await fs.readFile(file, "utf8")));
  } catch {
    // First launch or an unreadable file: keep the defaults.
  }
}

export async function saveNotificationPreferences(file: string, value: unknown) {
  const next = parseNotificationPreferences(value);
  await fs.writeFile(file, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  preferences = next;
  return next;
}

// Held until closed; a collected notification loses its click handler.
const showing = new Set<Notification>();

export function notifyFromRuntimeEvents(events: RuntimeEvent[], options: { appFocused: () => boolean; open: (agentId: string) => void }) {
  for (const event of events) {
    if (event.event_type !== "teammate.notification" || !event.agent_id) continue;
    const payload = event.payload as { name?: unknown; body?: unknown };
    if (typeof payload.name !== "string" || typeof payload.body !== "string") continue;
    if (!Notification.isSupported() || options.appFocused() || !shouldNotify(preferences, event.agent_id, new Date())) continue;
    const agentId = event.agent_id;
    const notification = new Notification({ title: payload.name, body: payload.body });
    showing.add(notification);
    notification.on("click", () => { showing.delete(notification); options.open(agentId); });
    notification.on("close", () => showing.delete(notification));
    notification.show();
  }
}
