import { useEffect, useRef, useState } from "react";
import { userError } from "./errors";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import type { DOMElement } from "ink";
import { randomUUID } from "node:crypto";
import { LumaClient } from "./client";
import { startDesktopServer, stopDesktopServer } from "./server";
import type {
  AgentConfiguration,
  AgentRecord,
  AgentStatus,
  ClientMessage,
  RuntimeEvent,
  ServerEvent,
  TaskRecord,
} from "./protocol";
import { Markdown } from "./components/Markdown";
import { theme, themeLabel } from "./theme";
import { useMotionFrame } from "./hooks/useMotionFrame";
import { useTerminalMouse } from "./hooks/useTerminalMouse";
import { useTerminalFullscreen } from "./hooks/useTerminalFullscreen";
import { useTerminalTheme } from "./hooks/useTerminalTheme";
import { isTerminalControlInput } from "./hooks/isTerminalControlInput";

type RequestEvent = Extract<ServerEvent, { data: { request_id: string } }>;
type View = "list" | "settings" | "chat";
type SettingField = "personality" | "workspace" | "skills" | "mascot";
type ChatLine = {
  id: string;
  role: "user" | "assistant" | "status" | "tool";
  content: string;
};
type PendingQuestion = {
  taskId: string;
  questionId: string;
  prompt: string;
  choices: string[];
};

function TaskActivity({ taskId }: { taskId: string }) {
  const frame = useMotionFrame(true);
  const spinner = ["◐", "◓", "◑", "◒"][Math.floor(frame / 6) % 4];
  return (
    <Text color={theme.brand}>
      {spinner} Task running · {taskId.slice(0, 8)} · Ctrl+C cancels this task.
    </Text>
  );
}

function request<T extends RequestEvent["type"]>(
  client: LumaClient,
  message: ClientMessage,
  expectedType: T,
  requestId: string,
): Promise<Extract<RequestEvent, { type: T }>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for ${expectedType}.`));
    }, 15_000);
    const unsubscribe = client.subscribe((event) => {
      if (
        event.type === "error" &&
        (event.data.request_id === requestId || event.data.request_id === null)
      ) {
        clearTimeout(timer);
        unsubscribe();
        reject(new Error(event.data.message));
        return;
      }
      if (
        event.type === expectedType &&
        "request_id" in event.data &&
        event.data.request_id === requestId
      ) {
        clearTimeout(timer);
        unsubscribe();
        resolve(event as Extract<RequestEvent, { type: T }>);
      }
    });
    try {
      client.send(message);
    } catch (error) {
      clearTimeout(timer);
      unsubscribe();
      reject(error);
    }
  });
}

export function TeammatesManager({
  embedded = false,
  onExit,
  onRequestExit,
  exitConfirmation = false,
  client: sharedClient,
}: {
  embedded?: boolean;
  onExit?: () => void;
  onRequestExit?: () => void;
  exitConfirmation?: boolean;
  client?: LumaClient;
}) {
  const { exit } = useApp();
  const [confirmExit, setConfirmExit] = useState(false);
  const leave = () => {
    if (embedded) onExit?.();
    else setConfirmExit(true);
  };
  const { stdout } = useStdout();
  const [ownedClient] = useState(() => (embedded ? null : new LumaClient()));
  const client = sharedClient ?? ownedClient!;
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [selected, setSelected] = useState(0);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("list");
  const [editing, setEditing] = useState<SettingField | null>(null);
  const [editValue, setEditValue] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [chatCursor, setChatCursor] = useState(0);
  const [chatOffset, setChatOffset] = useState(0);
  const [fullScreen, setFullScreen] = useState(false);
  const [chatLines, setChatLines] = useState<ChatLine[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [pendingQuestion, setPendingQuestion] =
    useState<PendingQuestion | null>(null);
  const sequence = useRef(0);
  const polling = useRef(false);
  const rootElement = useRef<DOMElement>(null);
  const agentRowElements = useRef<Array<DOMElement | null>>([]);
  const chatAction = useRef<DOMElement>(null);
  const settingsAction = useRef<DOMElement>(null);
  const pauseAction = useRef<DOMElement>(null);
  const createAction = useRef<DOMElement>(null);
  const deleteAction = useRef<DOMElement>(null);
  const settingActions = useRef<Array<{ field: SettingField; element: DOMElement | null }>>([]);
  const globalContextAction = useRef<DOMElement>(null);
  const networkAction = useRef<DOMElement>(null);
  const chatInputAction = useRef<DOMElement>(null);
  const chatSendAction = useRef<DOMElement>(null);
  const createSubmitAction = useRef<DOMElement>(null);
  const createCancelAction = useRef<DOMElement>(null);
  const deleteConfirmAction = useRef<DOMElement>(null);
  const deleteCancelAction = useRef<DOMElement>(null);
  const editSaveAction = useRef<DOMElement>(null);
  const editCancelAction = useRef<DOMElement>(null);
  const backAction = useRef<DOMElement>(null);
  const exitConfirmAction = useRef<DOMElement>(null);
  const exitCancelAction = useRef<DOMElement>(null);
  const chatWindowSize = Math.max(5, (stdout.rows || 24) - 12);
  const chatEnd =
    chatOffset > 0
      ? Math.max(0, chatLines.length - chatOffset)
      : chatLines.length;
  const visibleChatLines = chatLines.slice(
    Math.max(0, chatEnd - chatWindowSize),
    chatEnd,
  );
  const wideLayout = (stdout.columns || 80) >= 92;
  const selectedTheme = useTerminalTheme(!busy && !editing && !confirmDelete);
  useTerminalFullscreen(fullScreen);

  useTerminalMouse(rootElement, (event, contains) => {
    if (embedded && exitConfirmation) return;
    if (confirmExit && event.action === "press" && event.button === 0) {
      if (contains(exitConfirmAction.current)) exit();
      else if (contains(exitCancelAction.current)) setConfirmExit(false);
      return;
    }
    if (
      event.action === "wheel" &&
      view === "chat" &&
      contains(rootElement.current)
    ) {
      setChatOffset((offset) =>
        Math.max(
          0,
          Math.min(
            Math.max(0, chatLines.length - chatWindowSize),
            offset + (event.wheelDirection === "down" ? -3 : 3),
          ),
        ),
      );
      return;
    }
    if (
      event.action === "wheel" &&
      view === "list" &&
      contains(rootElement.current)
    ) {
      setSelected((index) =>
        Math.max(
          0,
          Math.min(
            agents.length - 1,
            index + (event.wheelDirection === "down" ? 1 : -1) * 3,
          ),
        ),
      );
      return;
    }
    if (event.action !== "press" || event.button !== 0 || busy) return;
    if (creating) {
      if (contains(createSubmitAction.current)) void createTeammate();
      else if (contains(createCancelAction.current)) { setCreating(false); setNewName(""); }
    } else if (confirmDelete) {
      if (contains(deleteConfirmAction.current)) void deleteSelected();
      else if (contains(deleteCancelAction.current)) setConfirmDelete(false);
    } else if (editing) {
      if (contains(editSaveAction.current)) void saveSetting();
      else if (contains(editCancelAction.current)) { setEditing(null); setEditValue(""); }
    } else if (view === "list") {
      const row = agentRowElements.current.findIndex((element) =>
        contains(element),
      );
      if (row >= 0) setSelected(row);
      else if (contains(chatAction.current) && selectedAgent) {
        setChatLines([]);
        setView("chat");
      } else if (contains(settingsAction.current) && selectedAgent)
        setView("settings");
      else if (contains(pauseAction.current) && selectedAgent)
        void toggleSelectedStatus();
      else if (contains(createAction.current)) {
        setCreating(true);
        setNewName("");
      } else if (contains(deleteAction.current) && selectedAgent && selectedAgent.id !== "agent_global")
        setConfirmDelete(true);
    } else if (view === "settings" && selectedAgent) {
      const setting = settingActions.current.find(({ element }) => contains(element));
      if (setting) {
        setEditing(setting.field);
        setEditValue(
          setting.field === "personality"
            ? selectedAgent.configuration.system_prompt
            : setting.field === "workspace"
              ? (selectedAgent.configuration.workspace ?? "")
              : setting.field === "skills"
                ? selectedAgent.configuration.skills.join(", ")
                : selectedAgent.configuration.mascot,
        );
      } else if (contains(globalContextAction.current)) void toggleGlobalContext();
      else if (contains(networkAction.current)) void toggleNetworkAccess();
    } else if (view === "chat") {
      if (contains(chatInputAction.current)) setChatCursor(chatInput.length);
      else if (contains(chatSendAction.current)) void sendChat();
    }
    if (contains(backAction.current)) {
      if (view === "list") leave();
      else { setView("list"); setEditing(null); }
    }
  });

  const selectedAgent = agents[selected];

  async function refresh(): Promise<AgentRecord[]> {
    const requestId = randomUUID();
    const response = await request(
      client,
      { type: "agents_list", data: { request_id: requestId } },
      "agents",
      requestId,
    );
    setAgents(response.data.agents);
    setSelected((index) =>
      Math.min(index, Math.max(0, response.data.agents.length - 1)),
    );
    return response.data.agents;
  }

  async function createTeammate() {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    setError("");
    try {
      const workspace = process.cwd();
      const configuration: AgentConfiguration = {
        system_prompt: "",
        specialization: null,
        mascot: "auto",
        use_global_context: true,
        skills: [],
        provider: null,
        model: null,
        endpoint: null,
        workspace,
        allowed_workspaces: [workspace],
        enabled_tools: [],
        network_access: true,
        permissions: {
          allowed_tools: [
            "read_file",
            "list_directory",
            "search_files",
            "git_status",
            "git_diff",
            "find_symbols",
            "find_references",
            "git_log",
            "git_show",
            "git_blame",
            "git_branches",
            "file_metadata",
            "find_todos",
            "count_lines",
            "inspect_project",
            "list_skills",
            "load_skill",
            "web_search",
            "fetch_url",
          ],
          denied_tools: [],
          auto_approve_read_only: true,
          require_approval_for_mutations: true,
          allow_network: true,
        },
        max_concurrent_tasks: 1,
        recover_interrupted_tasks: false,
      };
      const requestId = randomUUID();
      const response = await request(
        client,
        {
          type: "agent_create",
          data: {
            request_id: requestId,
            name,
            description: null,
            kind: "teammates",
            configuration,
          },
        },
        "agent_saved",
        requestId,
      );
      setCreating(false);
      setNewName("");
      const refreshed = await refresh();
      const createdIndex = refreshed.findIndex(
        (agent) => agent.id === response.data.agent.id,
      );
      if (createdIndex >= 0) setSelected(createdIndex);
    } catch (reason) {
      setError(userError(reason));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let active = true;
    if (!embedded) startDesktopServer();
    void client
      .connect()
      .then(async () => {
        if (!active) return;
        setConnected(true);
        await refresh();
      })
      .catch((reason) => {
        if (active) setError(userError(reason));
      });
    return () => {
      active = false;
      if (!embedded) {
        client.disconnect();
        stopDesktopServer();
      }
    };
  }, [client, embedded]);

  async function deleteSelected() {
    const agent = selectedAgent;
    if (!agent || agent.id === "agent_global") return;
    setBusy(true);
    setError("");
    try {
      const requestId = randomUUID();
      const response = await request(
        client,
        { type: "agent_delete", data: { request_id: requestId, id: agent.id } },
        "agent_deleted",
        requestId,
      );
      if (!response.data.deleted) throw new Error("Teammate no longer exists.");
      setConfirmDelete(false);
      setView("list");
      await refresh();
    } catch (reason) {
      setError(userError(reason));
    } finally {
      setBusy(false);
    }
  }

  async function toggleSelectedStatus() {
    const agent = selectedAgent;
    if (!agent || busy) return;
    const status: AgentStatus = agent.status === "paused" ? "idle" : "paused";
    setBusy(true);
    setError("");
    try {
      const requestId = randomUUID();
      const response = await request(
        client,
        {
          type: "agent_set_status",
          data: { request_id: requestId, id: agent.id, status },
        },
        "agent_saved",
        requestId,
      );
      setAgents((items) =>
        items.map((item) =>
          item.id === response.data.agent.id ? response.data.agent : item,
        ),
      );
    } catch (reason) {
      setError(userError(reason));
    } finally {
      setBusy(false);
    }
  }

  async function saveSetting() {
    if (!selectedAgent || !editing) return;
    setBusy(true);
    setError("");
    try {
      const configuration: AgentConfiguration = {
        ...selectedAgent.configuration,
      };
      if (editing === "personality") configuration.system_prompt = editValue;
      if (editing === "workspace") {
        const workspace = editValue.trim() || null;
        configuration.workspace = workspace;
        configuration.allowed_workspaces = workspace ? [workspace] : [];
      }
      if (editing === "skills")
        configuration.skills = [
          ...new Set(
            editValue
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean),
          ),
        ];
      if (editing === "mascot")
        configuration.mascot = editValue.trim() || "auto";
      const requestId = randomUUID();
      const response = await request(
        client,
        {
          type: "agent_update",
          data: {
            request_id: requestId,
            id: selectedAgent.id,
            name: null,
            description: null,
            configuration,
          },
        },
        "agent_saved",
        requestId,
      );
      setAgents((items) =>
        items.map((agent) =>
          agent.id === response.data.agent.id ? response.data.agent : agent,
        ),
      );
      setEditing(null);
      setEditValue("");
    } catch (reason) {
      setError(userError(reason));
    } finally {
      setBusy(false);
    }
  }

  async function toggleGlobalContext() {
    if (!selectedAgent) return;
    setBusy(true);
    setError("");
    try {
      const configuration = {
        ...selectedAgent.configuration,
        use_global_context: !selectedAgent.configuration.use_global_context,
      };
      const requestId = randomUUID();
      const response = await request(
        client,
        {
          type: "agent_update",
          data: {
            request_id: requestId,
            id: selectedAgent.id,
            name: null,
            description: null,
            configuration,
          },
        },
        "agent_saved",
        requestId,
      );
      setAgents((items) =>
        items.map((agent) =>
          agent.id === response.data.agent.id ? response.data.agent : agent,
        ),
      );
    } catch (reason) {
      setError(userError(reason));
    } finally {
      setBusy(false);
    }
  }

  async function toggleNetworkAccess() {
    if (!selectedAgent) return;
    setBusy(true);
    setError("");
    try {
      const enabled = !(selectedAgent.configuration.network_access ?? true);
      const configuration = {
        ...selectedAgent.configuration,
        network_access: enabled,
        permissions: {
          ...selectedAgent.configuration.permissions,
          allow_network: enabled,
        },
      };
      const requestId = randomUUID();
      const response = await request(
        client,
        {
          type: "agent_update",
          data: {
            request_id: requestId,
            id: selectedAgent.id,
            name: null,
            description: null,
            configuration,
          },
        },
        "agent_saved",
        requestId,
      );
      setAgents((items) =>
        items.map((agent) =>
          agent.id === response.data.agent.id ? response.data.agent : agent,
        ),
      );
    } catch (reason) {
      setError(userError(reason));
    } finally {
      setBusy(false);
    }
  }

  async function sendChat() {
    const agent = selectedAgent;
    const prompt = chatInput.trim();
    if (
      !agent ||
      !prompt ||
      busy ||
      (activeTaskId && pendingQuestion?.taskId !== activeTaskId)
    )
      return;
    setChatOffset(0);
    if (pendingQuestion && activeTaskId === pendingQuestion.taskId) {
      setBusy(true);
      setError("");
      try {
        const requestId = randomUUID();
        await request(
          client,
          {
            type: "task_answer_question",
            data: {
              request_id: requestId,
              id: pendingQuestion.taskId,
              question_id: pendingQuestion.questionId,
              answer: prompt,
            },
          },
          "task_saved",
          requestId,
        );
        setChatLines((lines) => [
          ...lines,
          { id: randomUUID(), role: "user", content: prompt },
          { id: randomUUID(), role: "status", content: "Answer sent." },
        ]);
        setPendingQuestion(null);
        setChatInput("");
        setChatCursor(0);
      } catch (reason) {
        setError(userError(reason));
      } finally {
        setBusy(false);
      }
      return;
    }
    setChatLines((lines) => [
      ...lines,
      { id: randomUUID(), role: "user", content: prompt },
      {
        id: `pending-${randomUUID()}`,
        role: "assistant",
        content: "Thinking…",
      },
    ]);
    setBusy(true);
    setError("");
    try {
      const requestId = randomUUID();
      const response = await request(
        client,
        {
          type: "task_create",
          data: {
            request_id: requestId,
            agent_id: agent.id,
            request: prompt,
            title: null,
            workspace: agent.configuration.workspace || process.cwd(),
            recover_on_restart: false,
          },
        },
        "task_saved",
        requestId,
      );
      setActiveTaskId(response.data.task.id);
      setChatInput("");
      setChatCursor(0);
    } catch (reason) {
      setChatLines((lines) => [
        ...lines.filter((line) => line.content !== "Thinking…"),
        {
          id: randomUUID(),
          role: "assistant",
          content: `Could not send message: ${userError(reason)}`,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function cancelActiveTask() {
    const taskId = activeTaskId;
    if (!taskId || busy) return;
    setBusy(true);
    setError("");
    try {
      const requestId = randomUUID();
      const response = await request(
        client,
        {
          type: "task_cancel",
          data: { request_id: requestId, id: taskId },
        },
        "task_saved",
        requestId,
      );
      if (response.data.task.status === "cancelled") setActiveTaskId(null);
      setChatLines((lines) => [
        ...lines.filter((line) => line.content !== "Thinking…"),
        {
          id: randomUUID(),
          role: "status",
          content:
            response.data.task.status === "cancelled"
              ? "Task cancelled."
              : "Cancellation requested…",
        },
      ]);
    } catch (reason) {
      setError(userError(reason));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (view !== "chat" || !selectedAgent) return;
    let active = true;
    const agentId = selectedAgent.id;
    setHistoryLoading(true);
    setChatLines([]);
    setChatInput("");
    setChatCursor(0);
    setActiveTaskId(null);
    setPendingQuestion(null);
    setError("");

    void (async () => {
      const tasksRequestId = randomUUID();
      const tasksResponse = await request(
        client,
        {
          type: "tasks_list",
          data: { request_id: tasksRequestId, agent_id: agentId, limit: 500 },
        },
        "tasks",
        tasksRequestId,
      );
      const tasks = [...tasksResponse.data.tasks]
        .filter((task) => task.schedule_id === null)
        .sort(
          (left, right) => left.created_at - right.created_at,
        ) as TaskRecord[];

      const events: RuntimeEvent[] = [];
      let cursor = 0;
      while (true) {
        const eventsRequestId = randomUUID();
        const response = await request(
          client,
          {
            type: "events_since",
            data: {
              request_id: eventsRequestId,
              sequence: cursor,
              limit: 1000,
              agent_id: agentId,
            },
          },
          "runtime_events",
          eventsRequestId,
        );
        events.push(...response.data.events);
        const last = response.data.events.at(-1);
        if (!last || response.data.events.length < 1000) break;
        cursor = last.sequence;
      }
      if (!active) return;
      sequence.current = events.at(-1)?.sequence ?? 0;

      const byTask = new Map<string, RuntimeEvent[]>();
      for (const event of events) {
        if (!event.task_id) continue;
        const entries = byTask.get(event.task_id) ?? [];
        entries.push(event);
        byTask.set(event.task_id, entries);
      }

      const restored: ChatLine[] = [];
      for (const task of tasks) {
        restored.push({
          id: `${task.id}-user`,
          role: "user",
          content: task.request,
        });
        for (const event of byTask.get(task.id) ?? []) {
          if (event.event_type !== "task.agent_event") continue;
          const payload = event.payload as { type?: string; data?: unknown };
          if (
            payload.type === "TextDelta" &&
            typeof payload.data === "string"
          ) {
            const last = restored[restored.length - 1];
            if (last?.role === "assistant")
              restored[restored.length - 1] = {
                ...last,
                content: last.content + payload.data,
              };
            else
              restored.push({
                id: event.event_id,
                role: "assistant",
                content: payload.data,
              });
          } else if (
            payload.type === "ToolStarted" &&
            typeof payload.data === "object" &&
            payload.data !== null &&
            "name" in payload.data
          ) {
            const tool = payload.data as { name: string; input?: string };
            restored.push({
              id: event.event_id,
              role: "tool",
              content: `${tool.name}: ${tool.input ?? ""}`,
            });
          } else if (
            payload.type === "ToolFinished" &&
            typeof payload.data === "object" &&
            payload.data !== null &&
            "name" in payload.data
          ) {
            const tool = payload.data as {
              name: string;
              duration_ms?: number;
              failed?: boolean;
            };
            for (let index = restored.length - 1; index >= 0; index -= 1) {
              const line = restored[index];
              if (
                line?.role === "tool" &&
                line.content.startsWith(`${tool.name}:`)
              ) {
                restored[index] = {
                  ...line,
                  content: `${line.content}  ·  ${tool.duration_ms ?? 0} ms${tool.failed ? " · failed" : " · done"}`,
                };
                break;
              }
            }
          } else if (
            (payload.type === "SystemMessage" || payload.type === "Error") &&
            typeof payload.data === "string"
          ) {
            restored.push({
              id: event.event_id,
              role: "status",
              content: payload.data,
            });
          } else if (
            payload.type === "QuestionRequired" &&
            typeof payload.data === "object" &&
            payload.data !== null
          ) {
            const question = payload.data as {
              question_id?: string;
              prompt?: string;
              choices?: string[];
            };
            if (
              typeof question.question_id === "string" &&
              typeof question.prompt === "string" &&
              Array.isArray(question.choices)
            ) {
              restored.push({
                id: event.event_id,
                role: "status",
                content: `Question: ${question.prompt}${question.choices.length ? ` (Options: ${question.choices.join(" · ")})` : ""}`,
              });
              if (task.status === "waiting_for_input") {
                setPendingQuestion({
                  taskId: task.id,
                  questionId: question.question_id,
                  prompt: question.prompt,
                  choices: question.choices.filter(
                    (choice): choice is string => typeof choice === "string",
                  ),
                });
              }
            }
          }
        }
        if (task.error && !["completed", "cancelled"].includes(task.status)) {
          restored.push({
            id: `${task.id}-error`,
            role: "status",
            content: `${task.status.replaceAll("_", " ")}: ${task.error}`,
          });
        }
      }
      setChatLines(restored);
      const activeTask = [...tasks]
        .reverse()
        .find((task) =>
          [
            "queued",
            "running",
            "waiting_for_approval",
            "waiting_for_input",
          ].includes(task.status),
        );
      setActiveTaskId(activeTask?.id ?? null);
      if (!activeTask || activeTask.status !== "waiting_for_input")
        setPendingQuestion(null);
    })()
      .catch((reason) => {
        if (active) setError(userError(reason));
      })
      .finally(() => {
        if (active) setHistoryLoading(false);
      });

    return () => {
      active = false;
    };
  }, [client, selectedAgent?.id, view]);

  useEffect(() => {
    if (!activeTaskId || !selectedAgent) return;
    let active = true;
    const poll = async () => {
      if (polling.current) return;
      polling.current = true;
      try {
        const requestId = randomUUID();
        const response = await request(
          client,
          {
            type: "events_since",
            data: {
              request_id: requestId,
              sequence: sequence.current,
              limit: 100,
              agent_id: selectedAgent.id,
            },
          },
          "runtime_events",
          requestId,
        );
        if (!active) return;
        for (const event of response.data.events) {
          sequence.current = Math.max(sequence.current, event.sequence);
          if (event.task_id !== activeTaskId) continue;
          if (event.event_type === "task.agent_event") {
            const agentEvent = event.payload as {
              type?: string;
              data?: unknown;
            };
            if (
              agentEvent.type === "TextDelta" &&
              typeof agentEvent.data === "string"
            ) {
              setChatLines((lines) => {
                const next = [...lines];
                const last = next[next.length - 1];
                if (last?.role === "assistant")
                  next[next.length - 1] = {
                    ...last,
                    content:
                      last.content === "Thinking…"
                        ? (agentEvent.data as string)
                        : last.content + (agentEvent.data as string),
                  };
                else
                  next.push({
                    id: randomUUID(),
                    role: "assistant",
                    content: agentEvent.data as string,
                  });
                return next;
              });
            } else if (
              agentEvent.type === "ToolStarted" &&
              typeof agentEvent.data === "object" &&
              agentEvent.data !== null &&
              "name" in agentEvent.data
            ) {
              const tool = agentEvent.data as { name: string; input?: string };
              setChatLines((lines) => [
                ...lines.filter((line) => line.content !== "Thinking…"),
                {
                  id: randomUUID(),
                  role: "tool",
                  content: `${tool.name}: ${tool.input ?? ""}`,
                },
              ]);
            } else if (
              agentEvent.type === "ToolFinished" &&
              typeof agentEvent.data === "object" &&
              agentEvent.data !== null &&
              "name" in agentEvent.data
            ) {
              const tool = agentEvent.data as {
                name: string;
                duration_ms?: number;
                failed?: boolean;
              };
              setChatLines((lines) => {
                const next = [...lines];
                let index = -1;
                for (let cursor = next.length - 1; cursor >= 0; cursor -= 1) {
                  const candidate = next[cursor];
                  if (
                    candidate?.role === "tool" &&
                    candidate.content.startsWith(`${tool.name}:`)
                  ) {
                    index = cursor;
                    break;
                  }
                }
                const target = index >= 0 ? next[index] : undefined;
                if (target)
                  next[index] = {
                    ...target,
                    content: `${target.content}  ·  ${tool.duration_ms ?? 0} ms${tool.failed ? " · failed" : " · done"}`,
                  };
                return next;
              });
            } else if (
              agentEvent.type === "SystemMessage" &&
              typeof agentEvent.data === "string"
            ) {
              setChatLines((lines) => [
                ...lines.filter((line) => line.content !== "Thinking…"),
                {
                  id: randomUUID(),
                  role: "status",
                  content: agentEvent.data as string,
                },
              ]);
            } else if (
              agentEvent.type === "Error" &&
              typeof agentEvent.data === "string"
            ) {
              setChatLines((lines) => [
                ...lines.filter((line) => line.content !== "Thinking…"),
                {
                  id: randomUUID(),
                  role: "status",
                  content: `Task note: ${agentEvent.data as string}`,
                },
              ]);
            } else if (
              agentEvent.type === "QuestionRequired" &&
              typeof agentEvent.data === "object" &&
              agentEvent.data !== null
            ) {
              const question = agentEvent.data as {
                question_id?: string;
                prompt?: string;
                choices?: string[];
              };
              if (
                typeof question.question_id === "string" &&
                typeof question.prompt === "string" &&
                Array.isArray(question.choices)
              ) {
                const choices = question.choices.filter(
                  (choice): choice is string => typeof choice === "string",
                );
                setPendingQuestion({
                  taskId: activeTaskId,
                  questionId: question.question_id,
                  prompt: question.prompt,
                  choices,
                });
                setChatLines((lines) => [
                  ...lines.filter((line) => line.content !== "Thinking…"),
                  {
                    id: randomUUID(),
                    role: "status",
                    content: `Question: ${question.prompt}${choices.length ? ` (Options: ${choices.join(" · ")})` : ""}`,
                  },
                ]);
              }
            }
          }
          if (
            [
              "task.completed",
              "task.failed",
              "task.cancelled",
              "task.interrupted",
            ].includes(event.event_type)
          ) {
            setChatLines((lines) =>
              lines.filter((line) => line.content !== "Thinking…"),
            );
            if (event.event_type !== "task.completed") {
              const task = event.payload as { error?: string | null };
              if (task.error)
                setChatLines((lines) => [
                  ...lines.filter((line) => line.content !== "Thinking…"),
                  {
                    id: randomUUID(),
                    role: "assistant",
                    content: `**${event.event_type.replace("task.", "").replaceAll("_", " ")}:** ${task.error}`,
                  },
                ]);
            }
            setActiveTaskId(null);
            setPendingQuestion(null);
          }
        }
      } catch (reason) {
        if (active) setError(userError(reason));
      } finally {
        polling.current = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 900);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [activeTaskId, client, selectedAgent]);

  useInput((input, key) => {
    if (isTerminalControlInput(input)) return;
    if (embedded && exitConfirmation) return;
    if (confirmExit) {
      if (input.toLowerCase() === "y" || key.return) exit();
      else if (
        input.toLowerCase() === "n" ||
        key.escape ||
        ((key.ctrl || key.meta) && input.toLowerCase() === "c")
      ) setConfirmExit(false);
      return;
    }
    if ((key.ctrl || key.meta) && input.toLowerCase() === "f") {
      setFullScreen((current) => !current);
      return;
    }
    if ((key.ctrl || key.meta) && input.toLowerCase() === "c") {
      if (creating && newName.length > 0) {
        setNewName("");
      } else if (editing && editValue.length > 0) {
        setEditValue("");
      } else if (view === "chat" && chatInput.length > 0) {
        setChatInput("");
        setChatCursor(0);
      } else if (activeTaskId) void cancelActiveTask();
      else if (embedded) onRequestExit?.();
      else setConfirmExit(true);
      return;
    }
    if (key.escape) {
      if (creating && newName.length > 0) {
        setNewName("");
        return;
      }
      if (editing && editValue.length > 0) {
        setEditValue("");
        return;
      }
      if (view === "chat" && chatInput.length > 0) {
        setChatInput("");
        setChatCursor(0);
        return;
      }
    }
    if (busy) return;
    if (creating) {
      if (key.escape) {
        if (newName.length > 0) setNewName("");
        else setCreating(false);
      } else if (key.return) void createTeammate();
      else if (key.backspace || key.delete)
        setNewName((value) => value.slice(0, -1));
      else if (input && !key.ctrl && !key.meta)
        setNewName((value) => value + input);
      return;
    }
    if (confirmDelete) {
      if (input.toLowerCase() === "y") void deleteSelected();
      else if (input.toLowerCase() === "n" || key.escape)
        setConfirmDelete(false);
      return;
    }
    if (editing) {
      if (key.escape) {
        if (editValue.length > 0) setEditValue("");
        else setEditing(null);
      } else if (key.return) void saveSetting();
      else if (key.backspace || key.delete)
        setEditValue((value) => value.slice(0, -1));
      else if (input && !key.ctrl && !key.meta)
        setEditValue((value) => value + input);
      return;
    }
    if (view === "chat") {
      if (
        (key.ctrl || key.meta) &&
        input.toLowerCase() === "c" &&
        activeTaskId
      ) {
        void cancelActiveTask();
        return;
      }
      if (key.escape) {
        if (chatInput.length > 0) {
          setChatInput("");
          setChatCursor(0);
          return;
        }
        setView("list");
        return;
      }
      if (key.pageUp) {
        setChatOffset((offset) =>
          Math.min(
            Math.max(0, chatLines.length - chatWindowSize),
            offset + chatWindowSize,
          ),
        );
        return;
      }
      if (key.pageDown) {
        setChatOffset((offset) => Math.max(0, offset - chatWindowSize));
        return;
      }
      if (key.end) {
        if (chatInput.length > 0) setChatCursor(chatInput.length);
        else setChatOffset(0);
        return;
      }
      if (key.home) {
        if (chatInput.length > 0) setChatCursor(0);
        else setChatOffset(Math.max(0, chatLines.length - chatWindowSize));
        return;
      }
      if (key.return) {
        if (key.shift) {
          setChatInput(
            (value) =>
              value.slice(0, chatCursor) + "\n" + value.slice(chatCursor),
          );
          setChatCursor(chatCursor + 1);
        } else void sendChat();
        return;
      }
      if (key.backspace || key.delete) {
        if (chatCursor > 0) {
          setChatInput(
            (value) => value.slice(0, chatCursor - 1) + value.slice(chatCursor),
          );
          setChatCursor(chatCursor - 1);
        }
      } else if (key.leftArrow)
        setChatCursor((cursor) => Math.max(0, cursor - 1));
      else if (key.rightArrow)
        setChatCursor((cursor) => Math.min(chatInput.length, cursor + 1));
      else if (input && !key.ctrl && !key.meta) {
        setChatInput(
          (value) =>
            value.slice(0, chatCursor) + input + value.slice(chatCursor),
        );
        setChatCursor(chatCursor + input.length);
      }
      return;
    }
    if (view === "settings") {
      if (key.escape || input.toLowerCase() === "q") {
        setView("list");
        return;
      }
      if (!selectedAgent) return;
      const fields: Record<string, SettingField> = {
        "1": "personality",
        "2": "workspace",
        "3": "skills",
        "4": "mascot",
      };
      const field = fields[input];
      if (field) {
        setEditing(field);
        setEditValue(
          field === "personality"
            ? selectedAgent.configuration.system_prompt
            : field === "workspace"
              ? (selectedAgent.configuration.workspace ?? "")
              : field === "skills"
                ? selectedAgent.configuration.skills.join(", ")
                : selectedAgent.configuration.mascot,
        );
      } else if (input.toLowerCase() === "g") void toggleGlobalContext();
      else if (input === "5") void toggleNetworkAccess();
      return;
    }
    if (input === "q" || key.escape) {
      leave();
      return;
    }
    if (key.upArrow) setSelected((index) => Math.max(0, index - 1));
    else if (key.downArrow)
      setSelected((index) => Math.min(agents.length - 1, index + 1));
    else if (input.toLowerCase() === "n") {
      setCreating(true);
      setNewName("");
    } else if (input.toLowerCase() === "p" && selectedAgent)
      void toggleSelectedStatus();
    else if (
      input.toLowerCase() === "d" &&
      selectedAgent &&
      selectedAgent.id !== "agent_global"
    )
      setConfirmDelete(true);
    else if (input.toLowerCase() === "r")
      void refresh().catch((reason) => setError(userError(reason)));
    else if (input.toLowerCase() === "e" && selectedAgent) setView("settings");
    else if (input.toLowerCase() === "c" && selectedAgent) {
      setChatLines([]);
      setView("chat");
    }
  });

  if (!connected) {
    return (
      <Box ref={rootElement} flexDirection="column" paddingX={2} paddingY={1}>
        {!embedded ? (
          <Box flexDirection="row" columnGap={1}>
            <Text color={theme.text} bold>
              LUMA
            </Text>
            <Text color={theme.chrome}>/</Text>
            <Text color={theme.secondary}>Teammates</Text>
          </Box>
        ) : null}
        {error ? (
          <>
            <Text color={theme.error}>Couldn't connect to Luma Core</Text>
            <Text color={theme.muted}>{error}</Text>
            <Text color={theme.chrome}>
              Check the core installation and launch Teammates again.
            </Text>
          </>
        ) : (
          <Text color={theme.muted}>Connecting...</Text>
        )}
        {confirmExit && !embedded ? (
          <Box marginTop={1} flexDirection="row" gap={2}>
            <Text color={theme.warning}>Exit Teammates?</Text>
            <Box ref={exitConfirmAction}><Text color={theme.success}>[ Yes ]</Text></Box>
            <Box ref={exitCancelAction}><Text color={theme.muted}>[ Cancel ]</Text></Box>
          </Box>
        ) : null}
      </Box>
    );
  }

  return (
    <Box
      ref={rootElement}
      flexDirection="column"
      width="100%"
      paddingX={fullScreen ? 2 : 1}
      height={
        fullScreen && stdout.isTTY ? Math.max(1, stdout.rows - 1) : undefined
      }
    >
      {!embedded ? (
        <Box marginBottom={1} flexDirection="row" flexWrap="wrap" columnGap={1}>
          <Text bold color={theme.brand}>
            Luma
          </Text>
          <Text color={theme.chrome}>·</Text>
          <Text color={theme.text}>Teammates</Text>
          {view !== "list" ? (
            <>
              <Text color={theme.chrome}>·</Text>
              <Box ref={backAction}><Text color={theme.muted}>[ ← {view} ]</Text></Box>
            </>
          ) : null}
          <Text color={theme.chrome}>·</Text>
          <Text color={connected ? theme.muted : theme.warning}>
            {connected ? "connected" : "connecting"}
          </Text>
          {fullScreen ? <Text color={theme.brand}>· fullscreen</Text> : null}
        </Box>
      ) : null}

      {view === "list" ? (
        <Box
          marginTop={1}
          flexDirection={wideLayout ? "row" : "column"}
          flexGrow={fullScreen ? 1 : 0}
          minHeight={0}
        >
          <Box
            width={wideLayout ? "34%" : "100%"}
            paddingRight={wideLayout ? 2 : 0}
            flexDirection="column"
          >
            <Box flexDirection="row" gap={2}>
              <Text color={theme.chrome}>{agents.length} teammates</Text>
              <Box ref={createAction}><Text color={theme.brand}>[ + New teammate ]</Text></Box>
            </Box>
            {agents.length === 0 ? (
              <Text color={theme.muted}>
                No teammates yet. Create one with `luma teammates create
                &lt;name&gt;`.
              </Text>
            ) : (
              agents.map((item, index) => (
                <Box
                  key={item.id}
                  ref={(element) => {
                    agentRowElements.current[index] = element;
                  }}
                  flexDirection="column"
                  marginTop={1}
                >
                  <Text color={index === selected ? theme.text : theme.muted}>
                    <Text
                      color={index === selected ? theme.brand : theme.chrome}
                    >
                      {index === selected ? "› " : "  "}
                    </Text>
                    {item.name}
                    <Text color={theme.chrome}>
                      {" "}
                      {item.status === "idle" ? "" : `· ${item.status}`}
                    </Text>
                  </Text>
                </Box>
              ))
            )}
          </Box>
          {selectedAgent ? (
            <Box
              flexGrow={1}
              flexDirection="column"
              borderLeft={wideLayout}
              borderColor={theme.border}
              paddingLeft={wideLayout ? 2 : 0}
              marginTop={wideLayout ? 0 : 2}
            >
              <Text bold color={theme.text}>
                {selectedAgent.name}
              </Text>
              <Text color={theme.muted}>
                {selectedAgent.kind} · {selectedAgent.status}
              </Text>
              <Text color={theme.secondary}>
                {selectedAgent.description || "No description"}
              </Text>
              <Box
                marginTop={1}
                flexDirection="row"
                flexWrap="wrap"
                columnGap={1}
              >
                <Text color={theme.chrome}>Skills</Text>
                <Text color={theme.secondary}>
                  {selectedAgent.configuration.skills.length
                    ? selectedAgent.configuration.skills.join(", ")
                    : "none"}
                </Text>
              </Box>
              <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
                <Text color={theme.chrome}>Workspace</Text>
                <Text color={theme.secondary}>
                  {selectedAgent.configuration.workspace || "default"}
                </Text>
              </Box>
              <Box flexDirection="row" gap={2} marginTop={1}>
                <Box ref={chatAction}>
                  <Text color={theme.brand}>C chat</Text>
                </Box>
                <Box ref={settingsAction}>
                  <Text color={theme.brand}>E settings</Text>
                </Box>
                <Box ref={pauseAction}>
                <Text color={theme.brand}>
                  P {selectedAgent.status === "paused" ? "resume" : "pause"}
                </Text>
                </Box>
                {selectedAgent.id !== "agent_global" ? <Box ref={deleteAction}><Text color={theme.warning}>× delete</Text></Box> : null}
              </Box>
            </Box>
          ) : null}
          {confirmDelete && selectedAgent ? (
            <Box marginTop={1}>
              <Text color={theme.warning}>
                Delete {selectedAgent.name} and its dependent data? (y/N)
              </Text>
              <Box flexDirection="row" gap={2}>
                <Box ref={deleteConfirmAction}><Text color={theme.error}>[ Delete ]</Text></Box>
                <Box ref={deleteCancelAction}><Text color={theme.muted}>[ Cancel ]</Text></Box>
              </Box>
            </Box>
          ) : null}
        </Box>
      ) : null}
      {creating ? (
        <Box
          marginTop={1}
          borderStyle="single"
          borderColor={theme.brand}
          paddingX={1}
        >
          <Text color={theme.brand}>
            New teammate name · Enter create · Esc cancel
          </Text>
          <Text>{newName}▏</Text>
          <Box flexDirection="row" gap={2}>
            <Box ref={createSubmitAction}><Text color={theme.success}>[ Create ]</Text></Box>
            <Box ref={createCancelAction}><Text color={theme.muted}>[ Cancel ]</Text></Box>
          </Box>
        </Box>
      ) : null}
      {!fullScreen && view === "list" ? (
        <Box marginTop={1}>
          <Text color={theme.chrome}>
            ↑/↓ select · N new · C chat · E settings · P pause/resume · D delete
            · Q back · Ctrl+T theme ({themeLabel(selectedTheme)})
          </Text>
        </Box>
      ) : null}

      {view === "settings" && selectedAgent ? (
        <Box
          marginTop={1}
          flexDirection="column"
          gap={1}
          flexGrow={fullScreen ? 1 : 0}
          minHeight={0}
        >
          <Text bold color={theme.text}>
            {selectedAgent.name} settings
          </Text>
          <Box ref={(element) => { settingActions.current[0] = { field: "personality", element }; }}><Text color={theme.muted}>1 · Personality</Text></Box>
          <Text color={theme.chrome}>
            {selectedAgent.configuration.system_prompt || "Not configured"}
          </Text>
          <Box ref={(element) => { settingActions.current[1] = { field: "workspace", element }; }}><Text color={theme.muted}>2 · Workspace</Text></Box>
          <Text color={theme.chrome}>
            {selectedAgent.configuration.workspace || "Default workspace"}
          </Text>
          <Box ref={(element) => { settingActions.current[2] = { field: "skills", element }; }}><Text color={theme.muted}>3 · Skills</Text></Box>
          <Text color={theme.chrome}>
            {selectedAgent.configuration.skills.join(", ") || "None"}
          </Text>
          <Box ref={(element) => { settingActions.current[3] = { field: "mascot", element }; }}><Text color={theme.muted}>4 · Mascot</Text></Box>
          <Text color={theme.chrome}>
            {selectedAgent.configuration.mascot || "Auto"}
          </Text>
          <Box ref={globalContextAction}><Text color={theme.muted}>
            G Use global skills, memory, connectors, etc.{" "}
            <Text
              color={
                selectedAgent.configuration.use_global_context
                  ? theme.success
                  : theme.warning
              }
            >
              {selectedAgent.configuration.use_global_context ? "ON" : "OFF"}
            </Text>
          </Text></Box>
          <Box ref={networkAction}><Text color={theme.muted}>
            5 Internet access / web search{" "}
            <Text
              color={
                (selectedAgent.configuration.network_access ?? true)
                  ? theme.success
                  : theme.warning
              }
            >
              {(selectedAgent.configuration.network_access ?? true)
                ? "ON"
                : "OFF"}
            </Text>
          </Text></Box>
          {editing ? (
            <Box marginTop={1} flexDirection="column">
              <Text color={theme.brand}>
                Editing {editing} · Enter saves · Esc cancels
              </Text>
              <Text color={theme.text}>{editValue}▌</Text>
              <Box flexDirection="row" gap={2}>
                <Box ref={editSaveAction}><Text color={theme.success}>[ Save ]</Text></Box>
                <Box ref={editCancelAction}><Text color={theme.muted}>[ Cancel ]</Text></Box>
              </Box>
            </Box>
          ) : null}
          {!fullScreen ? (
            <Text color={theme.chrome}>
              1–4 edit · G global context · 5 internet · Ctrl+T theme (
              {themeLabel(selectedTheme)}) · Esc back
            </Text>
          ) : null}
        </Box>
      ) : null}

      {view === "chat" && selectedAgent ? (
        <Box
          marginTop={1}
          flexDirection="column"
          flexGrow={fullScreen ? 1 : 0}
          minHeight={0}
        >
          <Box flexDirection="row" alignItems="center" gap={1}>
            <Text bold>{selectedAgent.name}</Text>
            <Text color={theme.muted}>· {selectedAgent.status}</Text>
          </Box>
          <Box
            marginTop={1}
            flexDirection="column"
            gap={1}
            flexGrow={fullScreen ? 1 : 0}
            minHeight={0}
            overflow={fullScreen ? "hidden" : "visible"}
          >
            {chatOffset > 0 ? (
              <Text color={theme.chrome}>
                ↑ Older messages · scroll down or press End for latest
              </Text>
            ) : null}
            {historyLoading ? (
              <Text color={theme.muted}>Loading this teammate's history…</Text>
            ) : chatLines.length === 0 ? (
              <Text color={theme.muted}>
                Send a message to start a task with this teammate.
              </Text>
            ) : (
              visibleChatLines.map((line) =>
                line.role === "user" ? (
                  <Box key={line.id} flexDirection="row" marginTop={1}>
                    <Text color={theme.brand}>› </Text>
                    <Markdown content={line.content} />
                  </Box>
                ) : (
                  <Box key={line.id} flexDirection="column" marginTop={1}>
                    {line.role === "status" ? (
                      <Text color={theme.warning}>{line.content}</Text>
                    ) : line.role === "tool" ? (
                      <Text color={theme.tool}>↳ {line.content}</Text>
                    ) : (
                      <>
                        <Text color={theme.brand} bold>
                          {selectedAgent.name}
                        </Text>
                        <Markdown content={line.content} />
                      </>
                    )}
                  </Box>
                ),
              )
            )}
          </Box>
          {activeTaskId ? <TaskActivity taskId={activeTaskId} /> : null}
          {pendingQuestion ? (
            <Box
              borderStyle="single"
              borderColor={theme.warning}
              paddingX={1}
              marginTop={1}
              flexDirection="column"
            >
              <Text color={theme.warning} bold>
                Teammate needs your input
              </Text>
              <Text>{pendingQuestion.prompt}</Text>
              {pendingQuestion.choices.length ? (
                <Text color={theme.muted}>
                  Options: {pendingQuestion.choices.join("  ·  ")}
                </Text>
              ) : null}
            </Box>
          ) : null}
          <Box ref={chatInputAction} marginTop={1} flexDirection="row" width="100%">
            <Text color={theme.brand}>› </Text>
            <Text color={theme.text}>
              {chatInput.slice(0, chatCursor)}
              <Text color={theme.brand}>▏</Text>
              {chatInput.slice(chatCursor)}
            </Text>
          </Box>
          <Box ref={chatSendAction} flexDirection="row" alignSelf="flex-end">
            <Text color={theme.brand}>[ Send ↵ ]</Text>
          </Box>
          {!pendingQuestion &&
          /(?:\*|_|~|`|^#{1,6}(?:\s|$)|^\s*[-*+]\s|^\s*\d+\.\s|^>\s|^\s*```|\[[^\]]+\]\()/m.test(
            chatInput,
          ) ? (
            <Box
              marginLeft={2}
              marginTop={1}
              paddingLeft={1}
              borderLeft
              borderColor={theme.border}
              flexDirection="column"
            >
              <Text color={theme.chrome}>Markdown preview</Text>
              <Markdown content={chatInput} />
            </Box>
          ) : null}
          {!fullScreen ? (
            <Text color={theme.chrome}>
              {pendingQuestion
                ? "Enter answer · Esc back"
                : "Enter send · Shift+Enter newline · Esc back"}
              {activeTaskId ? " · Ctrl+C cancel task" : ""} · Shift+drag select
              · Cmd+C / Ctrl+Shift+C copy · Ctrl+T theme (
              {themeLabel(selectedTheme)})
            </Text>
          ) : null}
        </Box>
      ) : null}

      {error ? (
        <Box marginTop={1}>
          <Text color={theme.error}>{error}</Text>
        </Box>
      ) : null}
      {confirmExit && !embedded ? (
        <Box marginTop={1} borderStyle="round" borderColor={theme.warning} paddingX={1} flexDirection="row" flexWrap="wrap" gap={2}>
          <Text color={theme.warning}>Exit Teammates?</Text>
          <Box ref={exitConfirmAction}><Text color={theme.success}>[ Yes, exit ]</Text></Box>
          <Box ref={exitCancelAction}><Text color={theme.muted}>[ Keep working ]</Text></Box>
          <Text color={theme.chrome}>Y/Enter confirm · Esc/N cancel</Text>
        </Box>
      ) : null}
      {fullScreen ? (
        <>
          <Text color={theme.chrome}>
            {view === "list"
              ? "↑/↓ select · C chat · E settings · D delete · Q quit"
              : view === "settings"
                ? "1–4 edit · G global context · 5 internet · Esc back"
                : "Enter send · scroll history · Esc back"}{" "}
            · Ctrl+T theme ({themeLabel(selectedTheme)}) · Ctrl+F exit
            fullscreen
          </Text>
        </>
      ) : null}
    </Box>
  );
}
