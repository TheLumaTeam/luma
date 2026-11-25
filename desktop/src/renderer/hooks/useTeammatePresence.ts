import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentPresence } from "../../../../shared/protocol";

const SEEN_KEY = "luma.teammate-seen";

/** The last reply sequence the user has had on screen, per Teammate. */
function readSeen(): Record<string, number> {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(SEEN_KEY) ?? "{}");
    return stored && typeof stored === "object" ? stored as Record<string, number> : {};
  } catch {
    return {};
  }
}

/** Live activity for every Teammate, plus which ones have said something new. */
export function useTeammatePresence(visibleAgentId: string) {
  const [presence, setPresence] = useState<Map<string, AgentPresence>>(new Map());
  const [seen, setSeen] = useState(readSeen);
  const [focused, setFocused] = useState(() => document.hasFocus());

  const load = useCallback(async () => {
    try {
      const entries = await window.luma.getPresence();
      setPresence(new Map(entries.map((entry) => [entry.agent_id, entry])));
      // A Teammate met for the first time starts read, not with old news.
      setSeen((current) => {
        const unknown = entries.filter((entry) => current[entry.agent_id] === undefined);
        return unknown.length === 0 ? current : { ...current, ...Object.fromEntries(unknown.map((entry) => [entry.agent_id, entry.last_reply_sequence])) };
      });
    } catch {
      // The next pushed event or the fallback timer tries again.
    }
  }, []);

  useEffect(() => {
    let pending: number | undefined;
    const unsubscribe = window.luma.onEvent((event) => {
      if (event.type !== "runtime_update" || pending !== undefined) return;
      pending = window.setTimeout(() => { pending = undefined; void load(); }, 250);
    });
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => { unsubscribe(); window.clearTimeout(pending); window.clearInterval(timer); };
  }, [load]);

  useEffect(() => {
    const update = () => setFocused(document.hasFocus());
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    return () => { window.removeEventListener("focus", update); window.removeEventListener("blur", update); };
  }, []);

  const visibleSequence = presence.get(visibleAgentId)?.last_reply_sequence;
  useEffect(() => {
    if (!focused || !visibleAgentId || visibleSequence === undefined) return;
    setSeen((current) => current[visibleAgentId] === visibleSequence ? current : { ...current, [visibleAgentId]: visibleSequence });
  }, [focused, visibleAgentId, visibleSequence]);

  useEffect(() => {
    try { window.localStorage.setItem(SEEN_KEY, JSON.stringify(seen)); } catch { /* unread state is optional */ }
  }, [seen]);

  const unreadAgents = useMemo(() => new Set([...presence.values()]
    .filter((entry) => seen[entry.agent_id] !== undefined && entry.last_reply_sequence > seen[entry.agent_id])
    .map((entry) => entry.agent_id)), [presence, seen]);

  return { presence, unreadAgents };
}
