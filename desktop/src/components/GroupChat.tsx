import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentRecord, ApprovalRecord, GroupMessage, GroupRecord, TaskRecord } from "../../../shared/protocol";
import { ApprovalCard } from "./ApprovalCard";
import { MascotAvatar } from "./MascotAvatar";
import { QuestionPrompt } from "./QuestionPrompt";
import RichResponse from "./RichResponse";
import "./GroupChat.css";

const ACTIVE = ["queued", "running", "waiting_for_approval", "waiting_for_input", "paused"];

function pendingLabel(status: GroupMessage["status"]) {
  if (status === "queued") return "Queued";
  if (status === "running") return "Thinking…";
  if (status === "waiting_for_approval") return "Needs approval";
  if (status === "waiting_for_input") return "Needs your answer";
  if (status === "failed" || status === "interrupted") return "Didn't finish";
  if (status === "cancelled") return "Stopped";
  return "";
}

function Question({ task, name, onAnswer }: { task: TaskRecord; name: string; onAnswer: (questionId: string, answer: string) => void }) {
  const question = task.checkpoint as { question_id?: string; prompt?: string; choices?: string[] } | null;
  if (!question?.question_id || !question.prompt) return null;
  const questionId = question.question_id;
  return <div className="luma-group-question"><QuestionPrompt key={questionId} title={`${name} needs your input`} prompt={question.prompt} choices={question.choices ?? []} onAnswer={(answer) => onAnswer(questionId, answer)} /></div>;
}

/** One conversation shared by several Teammates. */
export function GroupChat({ group, agents, sendWithEnter, onDeleted }: {
  group: GroupRecord;
  agents: AgentRecord[];
  sendWithEnter: boolean;
  onDeleted: (groups: GroupRecord[]) => void;
}) {
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRecord[]>([]);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const history = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const following = useRef(true);
  const members = group.member_ids.flatMap((id) => agents.find((agent) => agent.id === id) ?? []);
  const activeTaskIds = [...new Set(messages.filter((message) => message.status && ACTIVE.includes(message.status)).map((message) => message.task_id))];

  const load = useCallback(async () => {
    try {
      const [nextMessages, nextApprovals, nextTasks] = await Promise.all([
        window.luma.getGroupTranscript(group.id), window.luma.getApprovals(), window.luma.getTasks(),
      ]);
      setMessages(nextMessages);
      setApprovals(nextApprovals);
      setTasks(nextTasks);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [group.id]);

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
    const element = history.current;
    if (element && following.current) element.scrollTop = element.scrollHeight;
  }, [messages, approvals]);

  async function perform(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try { await action(); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  const post = (text: string) => {
    if (!text.trim() || busy) return;
    following.current = true;
    void perform(async () => {
      await window.luma.postToGroup(group.id, text.trim());
      setDraft("");
    });
  };

  // A reply's button carries text a Teammate wrote, possibly hidden behind the
  // label. It is only drafted, so the user reads it before it goes out as theirs.
  const draftFromReply = (text: string) => {
    setDraft(text);
    composer.current?.focus();
  };

  return <div className="luma-group">
    <header className="luma-group-header">
      <div className="luma-group-faces">{members.map((member) => <MascotAvatar key={member.id} seed={member.name} mascot={member.configuration.mascot} size={26} />)}</div>
      <div className="luma-group-title"><strong>{group.name}</strong><span>{members.map((member) => member.name).join(", ")}</span></div>
      {activeTaskIds.length > 0 && <button type="button" className="luma-btn-secondary" disabled={busy} onClick={() => void perform(() => Promise.all(activeTaskIds.map((id) => window.luma.cancelTask(id))))}>Stop all</button>}
      <button type="button" className="luma-btn-ghost" disabled={busy || activeTaskIds.length > 0} onClick={() => {
        if (!window.confirm(`Delete the group "${group.name}"? Its chat will no longer be shown.`)) return;
        void perform(async () => { onDeleted(await window.luma.deleteGroup(group.id)); });
      }}>Delete group</button>
    </header>
    <div ref={history} className="luma-group-history" onScroll={(event) => { const element = event.currentTarget; following.current = element.scrollHeight - element.clientHeight - element.scrollTop <= 72; }}>
      {messages.length === 0 && <p className="luma-group-empty">Say something to the group. Everyone replies unless you @mention someone, and those with nothing to add stay quiet.</p>}
      {messages.map((message) => {
        if (message.author_id === null) return <div key={message.id} className="luma-group-user"><p>{message.text}</p></div>;
        const author = agents.find((agent) => agent.id === message.author_id);
        const task = tasks.find((item) => item.id === message.task_id);
        const label = pendingLabel(message.status);
        return <article key={message.id} className="luma-group-reply">
          <MascotAvatar seed={author?.name ?? "teammate"} mascot={author?.configuration.mascot} size={32} activity={message.status === "running" ? "thinking" : "idle"} />
          <div>
            <div className="luma-group-author">{author?.name ?? "Teammate"}{label ? <span> · {label}</span> : null}</div>
            {message.text && <div className="luma-group-text"><RichResponse content={message.text} onAction={draftFromReply} /></div>}
            {approvals.filter((approval) => approval.task_id === message.task_id).map((approval) => <ApprovalCard key={approval.id} approval={approval} teammate={author?.name ?? "Teammate"} busy={busy} onResolve={(allowed) => void perform(() => window.luma.resolveApproval(approval.id, allowed))} />)}
            {message.status === "waiting_for_input" && task && <Question task={task} name={author?.name ?? "A teammate"} onAnswer={(questionId, answer) => void perform(() => window.luma.answerTaskQuestion(task.id, questionId, answer))} />}
          </div>
        </article>;
      })}
    </div>
    {error && <p role="alert" className="luma-group-error">{error}</p>}
    <form className="luma-group-composer" onSubmit={(event) => { event.preventDefault(); post(draft); }}>
      <textarea ref={composer} className="luma-input" rows={2} value={draft} aria-label={`Message ${group.name}`} placeholder={`Message ${group.name}; @${members[0]?.name ?? "name"} or @everyone`} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
        if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
        const send = sendWithEnter ? !event.shiftKey : window.luma.platform === "darwin" ? event.metaKey : event.ctrlKey;
        if (send) { event.preventDefault(); post(draft); }
      }} />
      <button type="submit" className="luma-btn-primary" disabled={busy || !draft.trim()}>Send</button>
    </form>
  </div>;
}
