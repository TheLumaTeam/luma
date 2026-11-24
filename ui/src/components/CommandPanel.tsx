import { Box, Text, useInput } from "ink";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DOMElement } from "ink";

import { theme } from "../theme";
import { useTerminalMouse } from "../hooks/useTerminalMouse";

type PanelId =
  | "git"
  | "files"
  | "find_files"
  | "search"
  | "doctor"
  | "monitor"
  | "teammates"
  | "tasks"
  | "approvals"
  | "schedules"
  | "memory"
  | "history"
  | "history_show"
  | "history_delete"
  | "history_prune"
  | "workspace"
  | "status"
  | "version"
  | "tools"
  | "skills"
  | "plugins"
  | "mcp"
  | "context";

export function CommandPanel({
  id,
  output,
  loading,
  error,
  onRun,
  onAttach,
  onAction,
  onDismissNotice,
  onClose,
}: {
  id: PanelId;
  output: string | null;
  loading: boolean;
  error: string | null;
  onRun: (id: string, query: string | null) => void;
  onAttach: (path: string) => void;
  onAction: (
    action: "task_cancel" | "task_retry" | "approval_resolve",
    id: string,
    allowed?: boolean,
  ) => void;
  onDismissNotice: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [gitView, setGitView] = useState("status");
  const [selected, setSelected] = useState(0);
  const [outputOffset, setOutputOffset] = useState(0);
  const [filter, setFilter] = useState("");
  const [filtering, setFiltering] = useState(false);
  const rootElement = useRef<DOMElement>(null);
  const recordElements = useRef<Array<DOMElement | null>>([]);
  const approveElement = useRef<DOMElement>(null);
  const denyElement = useRef<DOMElement>(null);
  const taskActionElement = useRef<DOMElement>(null);
  const gitActionElements = useRef<Array<{ action: string; element: DOMElement | null }>>([]);
  const closeElement = useRef<DOMElement>(null);
  const onRunRef = useRef(onRun);
  onRunRef.current = onRun;
  const records = useMemo(() => {
    if (!output) return [] as Record<string, unknown>[];
    try {
      const parsed: unknown = JSON.parse(output);
      if (Array.isArray(parsed))
        return parsed.filter(
          (item): item is Record<string, unknown> =>
            typeof item === "object" && item !== null,
        );
      if (typeof parsed === "object" && parsed !== null) {
        return Object.values(parsed as Record<string, unknown>)
          .flatMap((value) => (Array.isArray(value) ? value : []))
          .filter(
            (item): item is Record<string, unknown> =>
              typeof item === "object" && item !== null,
          );
      }
    } catch {
      /* Plain-text command output is rendered below. */
    }
    if (id === "files") {
      return output
        .split("\n")
        .filter(
          (line) => line.trim() && !line.startsWith("... [listing capped"),
        )
        .map((path): Record<string, unknown> => ({
          path: path.trim(),
          directory: path.trim().endsWith("/"),
        }));
    }
    return [] as Record<string, unknown>[];
  }, [id, output]);
  const active = records[selected];
  const outputLines = useMemo(
    () =>
      (output ?? "")
        .split("\n")
        .filter(
          (line) =>
            !filter ||
            line.toLocaleLowerCase().includes(filter.toLocaleLowerCase()),
        ),
    [output, filter],
  );
  const visibleOutput = outputLines.slice(outputOffset, outputOffset + 14);
  useEffect(() => {
    setSelected((value) => Math.max(0, Math.min(value, records.length - 1)));
    setOutputOffset(0);
  }, [records.length]);
  useEffect(() => {
    if (id !== "tasks" && id !== "approvals" && id !== "monitor") return;
    const interval = setInterval(
      () => onRunRef.current(id, null),
      id === "monitor" ? 5_000 : 3_000,
    );
    return () => clearInterval(interval);
  }, [id]);
  const title = (
    {
      git: "Git Explorer",
      files: "Workspace Explorer",
      find_files: "Fuzzy File Finder",
      search: "Workspace Search",
      doctor: "Workspace Diagnostics",
      monitor: "Live System Monitor",
      teammates: "Teammate Control Center",
      tasks: "Task Monitor",
      approvals: "Approval Inbox",
      schedules: "Schedules",
      memory: "Memory Explorer",
      history: "Conversation Search",
      history_show: "Conversation Inspector",
      history_delete: "Delete Conversation",
      history_prune: "Prune Conversation History",
      workspace: "Active Workspace",
      status: "Runtime Status",
      version: "Luma Version",
      tools: "Available Tools",
      skills: "Installed Skills",
      plugins: "Plugins",
      mcp: "MCP Connections",
      context: "Context Inspector",
    } satisfies Record<PanelId, string>
  )[id];

  useTerminalMouse(rootElement, (event, contains) => {
    if (event.action === "wheel" && contains(rootElement.current)) {
      if (records.length > 0)
        setSelected((value) => Math.max(0, Math.min(records.length - 1, value + (event.wheelDirection === "down" ? 1 : -1) * 3)));
      else setOutputOffset((value) => Math.max(0, Math.min(Math.max(0, outputLines.length - 14), value + (event.wheelDirection === "down" ? 3 : -3))));
      return;
    }
    if (event.action !== "press" || event.button !== 0) return;
    if (contains(closeElement.current)) { onClose(); return; }
    const gitAction = gitActionElements.current.find(({ element }) => contains(element));
    if (id === "git" && gitAction) {
      if (gitAction.action === "stage" || gitAction.action === "unstage") {
        setGitView(gitAction.action);
        setQuery("");
      } else if (gitAction.action === "diff_selected") {
        const path = typeof records[selected]?.path === "string" ? String(records[selected]?.path) : null;
        if (path) { setGitView(`diff:${path}`); onRun("git", `diff:${path}`); }
      } else {
        setGitView(gitAction.action);
        onRun("git", gitAction.action);
      }
      return;
    }
    const selectedRecord = records[selected];
    const selectedId = typeof selectedRecord?.id === "string" ? selectedRecord.id : null;
    const selectedStatus = typeof selectedRecord?.status === "string" ? selectedRecord.status : "";
    if (id === "approvals" && selectedId && contains(approveElement.current)) {
      onAction("approval_resolve", selectedId, true);
      return;
    }
    if (id === "approvals" && selectedId && contains(denyElement.current)) {
      onAction("approval_resolve", selectedId, false);
      return;
    }
    if (id === "tasks" && selectedId && contains(taskActionElement.current)) {
      if (["queued", "running", "waiting_for_input", "waiting_for_approval"].includes(selectedStatus)) onAction("task_cancel", selectedId);
      else if (["failed", "interrupted"].includes(selectedStatus)) onAction("task_retry", selectedId);
      return;
    }
    const row = recordElements.current.findIndex((element) => contains(element));
    if (row < 0) return;
    setSelected(row);
    const record = records[row];
    if (!record) return;
    const recordId = typeof record.id === "string" ? record.id : null;
    const status = typeof record.status === "string" ? record.status : "";
    if (id === "approvals" && recordId) onAction("approval_resolve", recordId, true);
    else if (id === "tasks" && recordId && ["queued", "running", "waiting_for_input", "waiting_for_approval"].includes(status)) onAction("task_cancel", recordId);
    else if ((id === "files" || id === "find_files") && typeof record.path === "string") {
      if (record.directory === true) onRun("files", record.path);
      else if (id === "files") onAttach(record.path);
      else onRun("read_file", record.path);
    }
  });

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (key.ctrl && input.toLowerCase() === "d") {
      onDismissNotice();
      return;
    }
    if (key.upArrow) {
      setSelected((value) => Math.max(0, value - 1));
      return;
    }
    if (key.downArrow) {
      setSelected((value) => Math.min(records.length - 1, value + 1));
      return;
    }
    if (key.pageUp) {
      setOutputOffset((value) => Math.max(0, value - 10));
      return;
    }
    if (key.pageDown) {
      setOutputOffset((value) =>
        Math.min(Math.max(0, outputLines.length - 14), value + 10),
      );
      return;
    }
    if (key.ctrl && input.toLowerCase() === "f" && !filtering) {
      setFiltering(true);
      setFilter("");
      return;
    }
    if (filtering) {
      if (key.escape || key.return) {
        setFiltering(false);
        return;
      }
      if (key.backspace || key.delete) {
        setFilter((value) => value.slice(0, -1));
        setOutputOffset(0);
        return;
      }
      if (!key.ctrl && !key.meta && input.length === 1) {
        setFilter((value) => value + input);
        setOutputOffset(0);
        return;
      }
    }
    const recordId = typeof active?.id === "string" ? active.id : null;
    const status = typeof active?.status === "string" ? active.status : "";
    if (recordId && id === "approvals" && input.toLowerCase() === "a") {
      onAction("approval_resolve", recordId, true);
      return;
    }
    if (recordId && id === "approvals" && input.toLowerCase() === "d") {
      onAction("approval_resolve", recordId, false);
      return;
    }
    if (
      recordId &&
      id === "tasks" &&
      input.toLowerCase() === "c" &&
      [
        "queued",
        "running",
        "waiting_for_input",
        "waiting_for_approval",
      ].includes(status)
    ) {
      onAction("task_cancel", recordId);
      return;
    }
    if (
      recordId &&
      id === "tasks" &&
      input.toLowerCase() === "r" &&
      ["failed", "interrupted"].includes(status)
    ) {
      onAction("task_retry", recordId);
      return;
    }
    if (id === "git" && !query && ["1", "2", "3", "4", "7"].includes(input)) {
      const next =
        (
          {
            "1": "status",
            "2": "diff",
            "3": "log",
            "4": "branches",
            "7": "diff_staged",
          } as Record<string, string>
        )[input] ?? "status";
      setGitView(next);
      onRun("git", next);
      return;
    }
    if (id === "git" && input === "8") {
      setGitView("status_json");
      onRun("git", "status_json");
      return;
    }
    if (
      id === "git" &&
      input.toLowerCase() === "d" &&
      typeof active?.path === "string"
    ) {
      setGitView(`diff:${active.path}`);
      setOutputOffset(0);
      onRun("git", `diff:${active.path}`);
      return;
    }
    if (
      id === "git" &&
      gitView.startsWith("diff") &&
      (input.toLowerCase() === "n" || input.toLowerCase() === "p")
    ) {
      const direction = input.toLowerCase() === "n" ? 1 : -1;
      const current = outputLines.findIndex(
        (line, index) =>
          index >= outputOffset &&
          ((line.startsWith("+") && !line.startsWith("+++")) ||
            (line.startsWith("-") && !line.startsWith("---"))),
      );
      const anchor = current < 0 ? outputOffset : current;
      for (
        let index = anchor + direction;
        index >= 0 && index < outputLines.length;
        index += direction
      ) {
        const line = outputLines[index] ?? "";
        if (
          (line.startsWith("+") && !line.startsWith("+++")) ||
          (line.startsWith("-") && !line.startsWith("---"))
        ) {
          setOutputOffset(
            Math.min(index, Math.max(0, outputLines.length - 14)),
          );
          break;
        }
      }
      return;
    }
    if (id === "git" && !query && ["5", "6"].includes(input)) {
      setGitView(input === "5" ? "stage" : "unstage");
      setQuery("");
      return;
    }
    if (key.return) {
      if (id === "git" && (gitView === "stage" || gitView === "unstage")) {
        if (query.trim()) onRun("git", `${gitView}:${query.trim()}`);
      } else if (id === "git") onRun("git", gitView);
      else if (id === "files" && query.trim()) onRun("files", query.trim());
      else if (id === "files" && typeof active?.path === "string") {
        if (active.directory === true) onRun("files", active.path);
        else onRun("read_file", active.path);
      } else if (id === "find_files" && typeof active?.path === "string")
        onRun("read_file", active.path);
      else if (id === "find_files" && query.trim())
        onRun("find_files", query.trim());
      else if (id === "search" || id === "history" || id === "memory")
        onRun(id, query.trim() || null);
      else if (id === "history_show") {
        if (query.trim()) onRun("history_show", query.trim());
      } else if (id === "history_delete") {
        if (query.trim()) onRun("history_delete", query.trim());
      } else if (id === "history_prune") {
        if (query.trim()) onRun("history_prune", query.trim());
      } else onRun(id, query.trim() || null);
      return;
    }
    if (key.backspace || key.delete) {
      setQuery((value) => value.slice(0, -1));
      return;
    }
    if (
      (id === "files" || id === "find_files") &&
      input.toLowerCase() === "a" &&
      typeof active?.path === "string" &&
      active.directory !== true
    ) {
      onAttach(active.path);
      return;
    }
    if (!key.ctrl && !key.meta && input && input.length === 1)
      setQuery((value) => value + input);
  });

  return (
    <Box
      ref={rootElement}
      flexDirection="column"
      borderLeft
      borderColor={theme.brand}
      paddingLeft={1}
      marginY={1}
    >
      <Box justifyContent="space-between">
        <Text color={theme.text} bold>
          {title}
        </Text>
        <Box ref={closeElement}><Text color={theme.chrome}>[ × close ]</Text></Box>
      </Box>
      {id === "git" ? (
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          {(["status", "diff", "log", "branches", "stage", "unstage", "diff_staged", "status_json", "diff_selected"] as const).map((action, index) => (
            <Box key={action} ref={(element) => { gitActionElements.current[index] = { action, element }; }}>
              <Text color={gitView === action ? theme.brand : theme.chrome}>
                [{({ status: "Status", diff: "Diff", log: "Log", branches: "Branches", stage: "Stage", unstage: "Unstage", diff_staged: "Staged", status_json: "Changed files", diff_selected: "Diff selected" } as Record<string, string>)[action]}]
              </Text>
            </Box>
          ))}
          <Text color={theme.chrome}>N/P next/previous change · {gitView}</Text>
        </Box>
      ) : null}
      {id === "git" && (gitView === "stage" || gitView === "unstage") ? (
        <Text color={theme.brand}>
          Workspace-relative path: {query || "type a file path, then Enter"}
        </Text>
      ) : null}
      {id === "search" ? (
        <Text color={theme.brand}>
          ⌕ {query || "Type a pattern, then press Enter"}
        </Text>
      ) : null}
      {id === "files" ? (
        <Text color={theme.brand}>
          Path: {query || "(workspace root) · type a file path to preview"}
        </Text>
      ) : null}
      {id === "find_files" ? (
        <Text color={theme.brand}>
          ⌕{" "}
          {query ||
            "Type a path fragment, then Enter · Enter opens the selected result"}
        </Text>
      ) : null}
      {id === "history" ? (
        <Text color={theme.brand}>
          Search · optional workspace:, model:, tool: filters:{" "}
          {query || "type text, then press Enter"}
        </Text>
      ) : null}
      {id === "memory" ? (
        <Text color={theme.brand}>
          Filter: {query || "Type to filter, then press Enter"}
        </Text>
      ) : null}
      {id === "history_show" ? (
        <Text color={theme.brand}>
          Conversation ID: {query || "Enter a saved conversation ID"}
        </Text>
      ) : null}
      {id === "history_delete" ? (
        <Text color={theme.brand}>
          ID to permanently delete: {query || "Enter the exact conversation ID"}
        </Text>
      ) : null}
      {id === "history_prune" ? (
        <Text color={theme.brand}>
          Type confirm to permanently delete all saved conversations:{" "}
          {query || ""}
        </Text>
      ) : null}
      {id === "tasks" ? (
        <Text color={theme.brand}>
          ↑↓ select · C cancel active task · R retry failed task
        </Text>
      ) : null}
      {id === "approvals" ? (
        <Text color={theme.brand}>↑↓ select · A approve · D deny</Text>
      ) : null}
      {id === "context" ? (
        <Text color={theme.muted}>
          Source inventory, not a raw dump of hidden provider/system
          instructions. Select an instruction file to inspect it.
        </Text>
      ) : null}
      {loading ? (
        <Text color={theme.muted}>Loading from Luma Core…</Text>
      ) : null}
      {error ? <Text color={theme.error}>{error}</Text> : null}
      {records.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          {records.slice(0, 18).map((record, index) => {
            const name = String(
              record.title ??
                record.name ??
                record.id ??
                record.key ??
                `Item ${index + 1}`,
            );
            const status = String(record.status ?? record.enabled ?? "");
            return (
              <Box key={String(record.id ?? record.key ?? index)} ref={(element) => { recordElements.current[index] = element; }}>
              <Text
                color={index === selected ? theme.brand : theme.text}
                bold={index === selected}
              >
                {index === selected ? "› " : "  "}
                {name}
                {status ? `  ·  ${status}` : ""}
                {typeof record.additions === "number" ||
                typeof record.deletions === "number"
                  ? `  +${String(record.additions ?? 0)} -${String(record.deletions ?? 0)}`
                  : ""}
              </Text>
              </Box>
            );
          })}
          {(id === "files" || id === "find_files") &&
          active &&
          typeof active.path === "string" ? (
            <Text color={theme.brand}>
              {active.directory === true
                ? "Enter browse directory"
                : "A attach selected file · Enter open/read"}
            </Text>
          ) : null}
          {id === "monitor" ? (
            <MonitorSummary records={records} />
          ) : active ? (
            <>
              {id === "tasks" ? <TaskProgress record={active} /> : null}
              {id === "approvals" ? (
                <Box flexDirection="row" gap={2} marginTop={1}>
                  <Box ref={approveElement}><Text color={theme.success}>[ Approve ]</Text></Box>
                  <Box ref={denyElement}><Text color={theme.error}>[ Deny ]</Text></Box>
                </Box>
              ) : null}
              {id === "tasks" ? (
                <Box ref={taskActionElement} marginTop={1}>
                  <Text color={theme.brand}>
                    {["queued", "running", "waiting_for_input", "waiting_for_approval"].includes(String(active.status))
                      ? "[ Cancel task ]"
                      : ["failed", "interrupted"].includes(String(active.status))
                        ? "[ Retry task ]"
                        : ""}
                  </Text>
                </Box>
              ) : null}
              <Text color={theme.muted}>{JSON.stringify(active, null, 2)}</Text>
            </>
          ) : null}
        </Box>
      ) : output ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color={theme.chrome}>{"─".repeat(48)}</Text>
          {filtering ? (
            <Text color={theme.brand}>
              ⌕ {filter || "Type to filter output"}
            </Text>
          ) : filter ? (
            <Text color={theme.brand}>
              ⌕ {filter} · {outputLines.length} matching lines
            </Text>
          ) : null}
          <Text color={theme.secondary}>{visibleOutput.join("\n")}</Text>
          {outputLines.length > 14 ? (
            <Text color={theme.chrome}>
              Lines {outputOffset + 1}–
              {Math.min(outputOffset + 14, outputLines.length)} of{" "}
              {outputLines.length} · PgUp/PgDn
            </Text>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}

function TaskProgress({ record }: { record: Record<string, unknown> }) {
  const checkpoint =
    record.checkpoint && typeof record.checkpoint === "object"
      ? (record.checkpoint as Record<string, unknown>)
      : null;
  const plan = typeof checkpoint?.plan === "string" ? checkpoint.plan : null;
  const completed = Array.isArray(checkpoint?.completed_actions)
    ? checkpoint.completed_actions.filter(
        (item): item is string => typeof item === "string",
      )
    : [];
  if (!plan && completed.length === 0) return null;
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={theme.brand} bold>
        Task progress
      </Text>
      {plan ? (
        <Text color={theme.secondary}>
          Plan
          {checkpoint?.plan_approved === true
            ? " · approved"
            : " · awaiting approval"}
          {"\n"}
          {plan}
        </Text>
      ) : null}
      <Text color={theme.secondary}>Completed actions: {completed.length}</Text>
      {completed.slice(-8).map((action, index) => (
        <Text key={`${index}-${action}`} color={theme.success}>
          ✓ {action}
        </Text>
      ))}
    </Box>
  );
}

function MonitorSummary({ records }: { records: Record<string, unknown>[] }) {
  const agents = records.filter(
    (record) =>
      typeof record.agent_id === "string" && typeof record.name === "string",
  );
  const tasks = records.filter((record) => typeof record.task_id === "string");
  const metric = (record: Record<string, unknown>) =>
    record.metrics && typeof record.metrics === "object"
      ? (record.metrics as Record<string, unknown>)
      : {};
  const sum = (key: string) =>
    agents.reduce((total, agent) => total + number(metric(agent)[key]), 0);
  const taskCounts = tasks.reduce<Record<string, number>>((counts, task) => {
    const status = string(task.status, "unknown");
    counts[status] = (counts[status] ?? 0) + 1;
    return counts;
  }, {});
  const toolsStarted = sum("tools_started");
  const toolsFinished = sum("tools_finished");
  const toolFailures = sum("tool_failures");

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={theme.brand} bold>
        System totals
      </Text>
      <Text color={theme.secondary}>
        {agents.length} agents · {tasks.length} tasks (
        {Object.entries(taskCounts)
          .map(([status, count]) => `${count} ${status}`)
          .join(", ") || "no task records"}
        )
      </Text>
      <Text color={theme.secondary}>
        {sum("total_tokens").toLocaleString()} tokens ·{" "}
        {sum("prompt_tokens").toLocaleString()} in /{" "}
        {sum("completion_tokens").toLocaleString()} out
      </Text>
      <Text color={theme.secondary}>
        {toolsStarted} tools started · {toolsFinished} finished · {toolFailures}{" "}
        failed
      </Text>
      {agents.length > 0 ? (
        <>
          <Text color={theme.brand} bold>
            Agents
          </Text>
          {agents.slice(0, 8).map((agent) => (
            <Text key={String(agent.agent_id)} color={theme.text}>
              {string(agent.name, "Unnamed agent")} ·{" "}
              {string(agent.status, "unknown")} ·{" "}
              {number(metric(agent).total_tokens).toLocaleString()} tokens ·{" "}
              {number(metric(agent).tools_finished)} tools
            </Text>
          ))}
        </>
      ) : null}
      {tasks.length > 0 ? (
        <>
          <Text color={theme.brand} bold>
            Recent tasks
          </Text>
          {tasks.slice(0, 8).map((task) => (
            <Text key={String(task.task_id)} color={theme.text}>
              {string(task.title, String(task.task_id).slice(0, 8))} ·{" "}
              {string(task.status, "unknown")} ·{" "}
              {number(metric(task).total_tokens).toLocaleString()} tokens
            </Text>
          ))}
        </>
      ) : null}
    </Box>
  );
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function string(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}
