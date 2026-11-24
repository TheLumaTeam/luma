import { Box, Text, useInput } from "ink";
import { useMemo, useState } from "react";
import type { ChatSummary } from "../protocol";
import { theme } from "../theme";

type WorkspaceEntry = { path: string; chats: ChatSummary[]; latest: ChatSummary };

export function WorkspaceSwitcher({ mode, chats, activeChatId, activeWorkspace, gitBranch, changedFiles, dashboardOutput, onRestore, onSwitchWorkspace, onClose }: {
  mode: "sessions" | "workspaces";
  chats: ChatSummary[];
  activeChatId: string | null;
  activeWorkspace: string;
  gitBranch?: string;
  changedFiles?: number;
  dashboardOutput?: string | null;
  onRestore: (id: string) => void;
  onSwitchWorkspace: (path: string, chatId?: string) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState(0);
  const [query, setQuery] = useState("");
  const workspaces = useMemo(() => {
    const grouped = new Map<string, ChatSummary[]>();
    for (const chat of chats) grouped.set(chat.workspace, [...(grouped.get(chat.workspace) ?? []), chat]);
    if (!grouped.has(activeWorkspace)) grouped.set(activeWorkspace, []);
    return [...grouped.entries()].map(([path, items]) => ({
      path,
      chats: items,
      latest: items[0] ?? { id: "", created_at: 0, updated_at: 0, workspace: path, title: "New workspace session", messages: 0, summary: null },
    })).sort((a, b) => Number(b.path === activeWorkspace) - Number(a.path === activeWorkspace) || (b.latest.updated_at - a.latest.updated_at));
  }, [chats, activeWorkspace]);
  const items = mode === "sessions" ? chats : workspaces;
  const filtered = items.filter((item) => {
    const label = mode === "sessions" ? (item as ChatSummary).title : (item as WorkspaceEntry).path;
    const workspace = mode === "sessions" ? (item as ChatSummary).workspace : "";
    return `${label} ${workspace}`.toLowerCase().includes(query.toLowerCase());
  });
  const current = filtered[selected];

  useInput((input, key) => {
    if (key.escape) { onClose(); return; }
    if (key.upArrow) { setSelected((value) => Math.max(0, value - 1)); return; }
    if (key.downArrow) { setSelected((value) => Math.min(Math.max(0, filtered.length - 1), value + 1)); return; }
    if (key.return && mode === "workspaces" && query.trim().startsWith("/")) {
      onSwitchWorkspace(query.trim());
      onClose();
      return;
    }
    if (key.return && current) {
      if (mode === "sessions") onRestore((current as ChatSummary).id);
      else {
        const workspace = current as WorkspaceEntry;
        onSwitchWorkspace(workspace.path, workspace.latest.id || undefined);
      }
      onClose();
      return;
    }
    if (key.backspace || key.delete) { setQuery((value) => value.slice(0, -1)); setSelected(0); return; }
    if (!key.ctrl && !key.meta && input) { setQuery((value) => value + input); setSelected(0); }
  });

  let dashboard: Record<string, unknown> | null = null;
  if (dashboardOutput) {
    try { dashboard = JSON.parse(dashboardOutput) as Record<string, unknown>; } catch { /* dashboard may still be loading */ }
  }
  const tasks = Array.isArray(dashboard?.recent_tasks) ? dashboard.recent_tasks : [];
  const agents = Array.isArray(dashboard?.active_teammates) ? dashboard.active_teammates : [];
  const git = dashboard?.git && typeof dashboard.git === "object" ? dashboard.git as Record<string, unknown> : null;

  return <Box flexDirection="column" borderStyle="round" borderColor={theme.brand} paddingX={1} paddingY={1} marginY={1}>
    <Box justifyContent="space-between">
      <Text color={theme.text} bold>{mode === "sessions" ? "Saved sessions" : "Workspaces"}</Text>
      <Text color={theme.chrome}>Esc close · ↑↓ navigate · Enter open</Text>
    </Box>
    <Text color={theme.brand}>⌕ {query || (mode === "sessions" ? "Find a conversation…" : "Find a project or type an absolute path…")}</Text>
    <Box flexDirection="row" columnGap={2} marginTop={1}>
      <Box flexDirection="column" width="55%">
        {filtered.slice(0, 10).map((item, index) => {
          const title = mode === "sessions" ? (item as ChatSummary).title : ((item as WorkspaceEntry).path.split("/").filter(Boolean).at(-1) || (item as WorkspaceEntry).path);
          const subtitle = mode === "sessions" ? (item as ChatSummary).workspace : `${(item as WorkspaceEntry).chats.length} saved sessions`;
          const active = mode === "sessions" ? (item as ChatSummary).id === activeChatId : (item as WorkspaceEntry).path === activeWorkspace;
          return <Box key={mode === "sessions" ? (item as ChatSummary).id : (item as WorkspaceEntry).path} flexDirection="column">
            <Text color={index === selected ? theme.brand : theme.text} bold={index === selected}>{index === selected ? "› " : "  "}{title}{active ? "  · current" : ""}</Text>
            <Text color={theme.chrome}>   {subtitle}</Text>
            {mode === "sessions" && (item as ChatSummary).summary ? <Text color={theme.muted}>   {(item as ChatSummary).summary}</Text> : null}
          </Box>;
        })}
        {filtered.length === 0 ? <Text color={theme.muted}>No saved entries yet.</Text> : null}
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        <Text color={theme.secondary} bold>Workspace dashboard</Text>
        <Text color={theme.muted}>{activeWorkspace}</Text>
        <Text color={theme.chrome}>Git: {gitBranch ?? "loading"} · {changedFiles ?? "…"} changed</Text>
        <Text color={theme.chrome}>Recent tasks: {tasks.length} · Active Teammates: {agents.length}</Text>
        {git && typeof git.branch === "string" ? <Text color={theme.muted}>Branch: {git.branch}</Text> : null}
        {tasks.slice(0, 4).map((task, index) => {
          const value = task as Record<string, unknown>;
          return <Text key={String(value.id ?? index)} color={theme.muted}>· {String(value.title ?? value.request ?? "Task")} — {String(value.status ?? "unknown")}</Text>;
        })}
        {agents.slice(0, 4).map((agent, index) => {
          const value = agent as Record<string, unknown>;
          return <Text key={String(value.id ?? index)} color={theme.muted}>· {String(value.name ?? "Teammate")} — {String(value.status ?? "active")}</Text>;
        })}
        {!dashboard ? <Text color={theme.chrome}>Loading project activity…</Text> : null}
      </Box>
    </Box>
  </Box>;
}
