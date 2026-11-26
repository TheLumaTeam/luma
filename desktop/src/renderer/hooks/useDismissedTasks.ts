import { useCallback, useEffect, useState } from "react";

const DISMISSED_KEY = "luma.teammate-inbox-dismissed";

function readDismissed(): string[] {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(DISMISSED_KEY) ?? "[]");
    return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** Failed tasks the user cleared from the Inbox. This only hides them in this app; the tasks are unchanged. */
export function useDismissedTasks() {
  const [dismissed, setDismissed] = useState(() => new Set(readDismissed()));

  useEffect(() => {
    try { window.localStorage.setItem(DISMISSED_KEY, JSON.stringify([...dismissed])); } catch { /* the Inbox still works without it */ }
  }, [dismissed]);

  const dismiss = useCallback((ids: string[]) => setDismissed((current) => new Set([...current, ...ids])), []);
  const restore = useCallback((ids: string[]) => setDismissed((current) => {
    const next = new Set(current);
    for (const id of ids) next.delete(id);
    return next;
  }), []);

  return { dismissed, dismiss, restore };
}
