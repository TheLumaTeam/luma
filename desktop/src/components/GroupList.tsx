import { useState } from "react";
import type { AgentRecord, GroupRecord } from "../../../shared/protocol";
import "./GroupChat.css";

const MAX_MEMBERS = 6;

/** The sidebar's group chats, with a small form to start a new one. */
export function GroupList({ groups, agents, selectedId, onSelect, onCreated }: {
  groups: GroupRecord[];
  agents: AgentRecord[];
  selectedId: string;
  onSelect: (id: string) => void;
  onCreated: (groups: GroupRecord[], createdName: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [members, setMembers] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const teammates = agents.filter((agent) => agent.kind === "teammates");
  if (teammates.length < 2) return null;

  const create = async () => {
    setBusy(true);
    setError("");
    try {
      onCreated(await window.luma.createGroup(name.trim(), members), name.trim());
      setOpen(false);
      setName("");
      setMembers([]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return <div className="luma-group-list">
    <div className="luma-teammate-sidebar-heading"><span>Groups</span></div>
    {groups.map((group) => <button key={group.id} type="button" aria-current={selectedId === group.id ? "page" : undefined} className={`luma-teammate-nav-item w-full text-left ${selectedId === group.id ? "is-selected" : ""}`} onClick={() => onSelect(group.id)}>
      <span className="luma-group-list-name">{group.name}</span>
      <span className="luma-group-list-members">{group.member_ids.map((id) => agents.find((agent) => agent.id === id)?.name).filter(Boolean).join(", ")}</span>
    </button>)}
    {open ? <form className="luma-group-new" onSubmit={(event) => { event.preventDefault(); void create(); }}>
      <input className="luma-input" autoFocus aria-label="Group name" placeholder="Group name" maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
      <fieldset><legend>2 to {MAX_MEMBERS} teammates</legend>{teammates.map((agent) => <label key={agent.id}><input type="checkbox" checked={members.includes(agent.id)} disabled={!members.includes(agent.id) && members.length >= MAX_MEMBERS} onChange={(event) => setMembers(event.target.checked ? [...members, agent.id] : members.filter((id) => id !== agent.id))} /> {agent.name}</label>)}</fieldset>
      {error && <p role="alert" className="luma-group-error">{error}</p>}
      <div><button type="button" className="luma-btn-ghost" onClick={() => setOpen(false)}>Cancel</button><button type="submit" className="luma-btn-primary" disabled={busy || !name.trim() || members.length < 2}>Create group</button></div>
    </form> : <button type="button" className="luma-teammate-add-button" onClick={() => setOpen(true)}><span aria-hidden="true">+</span>New group</button>}
  </div>;
}
