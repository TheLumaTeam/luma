import type { AgentPresence, AgentRecord } from "../../../shared/protocol";
import { summarizeActivity } from "../utils/summarizeActivity";
import { MascotAvatar } from "./MascotAvatar";
import "./TeammatePresenceRow.css";

function statusLine(agent: AgentRecord, presence?: AgentPresence): { text: string; tone: "live" | "attention" | "quiet" } {
  if (agent.status === "paused") return { text: "Paused", tone: "quiet" };
  if (agent.status === "stopped") return { text: "Stopped", tone: "quiet" };
  if (presence?.state === "needs_you") return { text: "Needs you", tone: "attention" };
  if (presence?.state === "waiting_for_workspace") return { text: "Waiting for the files…", tone: "live" };
  if (presence?.state === "working") {
    return { text: presence.tool ? summarizeActivity([{ name: presence.tool }], true) : "Thinking…", tone: "live" };
  }
  return { text: presence?.preview ?? agent.description ?? (agent.id === "agent_global" ? "Global teammate" : "Say hello"), tone: "quiet" };
}

/** "14:05" today, "Mon" this week, otherwise "3 Jun". */
function shortTime(seconds: number, now = new Date()) {
  const date = new Date(seconds * 1000);
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const recent = now.getTime() - date.getTime() < 6 * 86_400_000;
  return date.toLocaleDateString(undefined, recent ? { weekday: "short" } : { day: "numeric", month: "short" });
}

export function TeammatePresenceRow({ agent, presence, unread }: { agent: AgentRecord; presence?: AgentPresence; unread: boolean }) {
  const status = statusLine(agent, presence);
  const activity = status.tone === "live" ? (presence?.tool ? "working" : "thinking") : "idle";
  return <div className="luma-presence-row" data-unread={unread || undefined}>
    <MascotAvatar seed={agent.name} mascot={agent.configuration.mascot} size={30} active={status.tone === "live"} activity={activity} />
    <span className="luma-presence-text">
      <span className="luma-presence-head">
        <span className="luma-presence-name">{agent.name}</span>
        {presence?.last_reply_at ? <time className="luma-presence-time">{shortTime(presence.last_reply_at)}</time> : null}
      </span>
      <span className="luma-presence-head">
        <span className="luma-presence-status" data-tone={status.tone}>{status.text}</span>
        {unread ? <span className="luma-presence-dot" role="img" aria-label="Unread reply" /> : null}
      </span>
    </span>
  </div>;
}
