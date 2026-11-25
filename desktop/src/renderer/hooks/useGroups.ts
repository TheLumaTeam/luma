import { useCallback, useEffect, useState } from "react";
import type { GroupRecord } from "../../../../shared/protocol";

/** The group chats, reloaded when a team changes. */
export function useGroups() {
  const [groups, setGroups] = useState<GroupRecord[]>([]);

  const reload = useCallback(async () => {
    try {
      setGroups(await window.luma.getGroups());
    } catch {
      // The next pushed event or the fallback timer tries again.
    }
  }, []);

  useEffect(() => {
    const unsubscribe = window.luma.onEvent((event) => {
      if (event.type === "runtime_update" && event.data.events.some((item) => item.event_type.startsWith("team."))) void reload();
    });
    void reload();
    const timer = window.setInterval(() => void reload(), 15_000);
    return () => { unsubscribe(); window.clearInterval(timer); };
  }, [reload]);

  return { groups, setGroups };
}
