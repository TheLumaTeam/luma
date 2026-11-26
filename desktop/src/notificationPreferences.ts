// Shared by the main process, which applies these, and the settings UI.

export interface NotificationPreferences {
  enabled: boolean;
  quietHoursEnabled: boolean;
  /** Local "HH:MM". A start later than the end runs overnight. */
  quietStart: string;
  quietEnd: string;
  mutedAgents: string[];
}

export const defaultNotificationPreferences: NotificationPreferences = {
  enabled: true,
  quietHoursEnabled: false,
  quietStart: "22:00",
  quietEnd: "08:00",
  mutedAgents: [],
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function parseNotificationPreferences(value: unknown): NotificationPreferences {
  const input = (value && typeof value === "object" ? value : {}) as Partial<NotificationPreferences>;
  const time = (candidate: unknown, fallback: string) => typeof candidate === "string" && TIME.test(candidate) ? candidate : fallback;
  return {
    enabled: typeof input.enabled === "boolean" ? input.enabled : defaultNotificationPreferences.enabled,
    quietHoursEnabled: input.quietHoursEnabled === true,
    quietStart: time(input.quietStart, defaultNotificationPreferences.quietStart),
    quietEnd: time(input.quietEnd, defaultNotificationPreferences.quietEnd),
    mutedAgents: Array.isArray(input.mutedAgents) ? input.mutedAgents.filter((id): id is string => typeof id === "string").slice(0, 500) : [],
  };
}

export function inQuietHours(preferences: NotificationPreferences, now: Date) {
  if (!preferences.quietHoursEnabled) return false;
  const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  const current = now.getHours() * 60 + now.getMinutes();
  const start = minutes(preferences.quietStart);
  const end = minutes(preferences.quietEnd);
  return start <= end ? current >= start && current < end : current >= start || current < end;
}

export function shouldNotify(preferences: NotificationPreferences, agentId: string, now: Date) {
  return preferences.enabled && !preferences.mutedAgents.includes(agentId) && !inQuietHours(preferences, now);
}
