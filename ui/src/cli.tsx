import React from 'react';
import { render } from 'ink';
import { Command } from 'commander';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';

import { App } from './App';
import { TeammatesManager } from './TeammatesManager';
import { LumaClient } from './client';
import { userError } from './errors';
import { startDesktopServer, stopDesktopServer } from './server';
import type { ClientMessage, ServerEvent } from './protocol';
import type { AgentConfiguration, AgentKind, MemoryScope } from './protocol';

type RequestEvent = Extract<ServerEvent, { data: { request_id: string } }>;

async function launchInteractive(initialSetup = false) {
  const instance = render(
    <React.StrictMode>
      <App initialSetup={initialSetup} />
    </React.StrictMode>,
    { exitOnCtrlC: false, maxFps: 30 },
  );
  try {
    await instance.waitUntilExit();
  } finally {
    instance.clear();
    if (process.stdout.isTTY)
      process.stdout.write("\u001B[2J\u001B[H\u001B[?25h");
  }
}

async function launchTeammates() {
  const instance = render(
    <React.StrictMode>
      <TeammatesManager />
    </React.StrictMode>,
    {
      exitOnCtrlC: false,
      maxFps: 60,
      incrementalRendering: true,
    },
  );
  try {
    await instance.waitUntilExit();
  } finally {
    instance.clear();
    if (process.stdout.isTTY)
      process.stdout.write("\u001B[2J\u001B[H\u001B[?25h");
  }
}

async function withClient<T>(
  run: (client: LumaClient) => Promise<T>,
): Promise<T> {
  const client = new LumaClient();
  try {
    startDesktopServer();
    await client.connect();
    return await run(client);
  } finally {
    client.disconnect();
    stopDesktopServer();
  }
}

function request<T extends RequestEvent['type']>(
  client: LumaClient,
  message: ClientMessage,
  expectedType: T,
  requestId: string,
): Promise<Extract<RequestEvent, { type: T }>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(
        new Error(`Timed out waiting for core response: ${expectedType}.`),
      );
    }, 30_000);
    const unsubscribe = client.subscribe((event) => {
      if (
<<<<<<< HEAD
        event.type === 'error' &&
=======
        event.type === "error" &&
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
        (event.data.request_id === requestId || event.data.request_id === null)
      ) {
        clearTimeout(timer);
        unsubscribe();
        reject(new Error(event.data.message));
        return;
      }
      if (
        event.type === expectedType &&
<<<<<<< HEAD
        'request_id' in event.data &&
=======
        "request_id" in event.data &&
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
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

async function historyList() {
  await withClient(async (client) => {
    const requestId = crypto.randomUUID();
    const event = await request(
      client,
<<<<<<< HEAD
      { type: 'history_list', data: { request_id: requestId } },
      'history_list',
=======
      { type: "history_list", data: { request_id: requestId } },
      "history_list",
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
      requestId,
    );
    if (event.data.chats.length === 0) {
      process.stdout.write('No saved chats yet.\n');
      return;
    }
    for (const chat of event.data.chats) {
      process.stdout.write(
        `${chat.id}  ${chat.title}  (${chat.messages} messages)\n`,
      );
      if (chat.summary) process.stdout.write(`  Summary: ${chat.summary}\n`);
    }
  });
}

async function historyShow(id: string) {
  await withClient(async (client) => {
    const requestId = crypto.randomUUID();
    const event = await request(
      client,
<<<<<<< HEAD
      { type: 'history_show', data: { request_id: requestId, id } },
      'history_chat',
=======
      { type: "history_show", data: { request_id: requestId, id } },
      "history_chat",
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
      requestId,
    );
    const chat = event.data.chat;
    process.stdout.write(
      `Chat ${chat.id} · ${chat.info.model} · ${chat.info.workspace}\n`,
    );
    if (chat.summary) process.stdout.write(`\nSummary\n${chat.summary}\n`);
    for (const message of chat.messages) {
      process.stdout.write(`\n[${message.role}]\n${message.content}\n`);
    }
  });
}

async function historyDelete(id: string, options: { yes?: boolean }) {
  if (!options.yes) {
    if (!process.stdin.isTTY)
      throw new Error(
<<<<<<< HEAD
        'Pass --yes to delete a chat in a non-interactive terminal.',
=======
        "Pass --yes to delete a chat in a non-interactive terminal.",
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
      );
    const readline = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      const answer = await readline.question(
        `Permanently delete chat ${id}? [y/N] `,
      );
      if (!/^y(es)?$/i.test(answer.trim())) {
        process.stdout.write('Cancelled.\n');
        return;
      }
    } finally {
      readline.close();
    }
  }

  await withClient(async (client) => {
    const requestId = crypto.randomUUID();
    const event = await request(
      client,
      {
<<<<<<< HEAD
        type: 'history_delete',
        data: { request_id: requestId, id },
      },
      'history_deleted',
=======
        type: "history_delete",
        data: { request_id: requestId, id },
      },
      "history_deleted",
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
      requestId,
    );
    if (!event.data.deleted) throw new Error(`Saved chat not found: ${id}`);
    process.stdout.write(`Deleted chat ${id}.\n`);
  });
}

async function historyPrune(options: { yes?: boolean }) {
  if (!options.yes) {
    if (!process.stdin.isTTY)
      throw new Error(
<<<<<<< HEAD
        'Pass --yes to prune saved chats in a non-interactive terminal.',
=======
        "Pass --yes to prune saved chats in a non-interactive terminal.",
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
      );
    const readline = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      const answer = await readline.question(
<<<<<<< HEAD
        'Permanently delete EVERY saved Luma chat? This cannot be undone. [y/N] ',
=======
        "Permanently delete EVERY saved Luma chat? This cannot be undone. [y/N] ",
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
      );
      if (!/^y(es)?$/i.test(answer.trim())) {
        process.stdout.write('Cancelled.\n');
        return;
      }
    } finally {
      readline.close();
    }
  }

  await withClient(async (client) => {
    const requestId = crypto.randomUUID();
    const event = await request(
      client,
      {
<<<<<<< HEAD
        type: 'history_prune',
        data: { request_id: requestId },
      },
      'history_pruned',
      requestId,
    );
    process.stdout.write(
      `Pruned ${event.data.removed} saved chat${event.data.removed === 1 ? '' : 's'}.\n`,
=======
        type: "history_prune",
        data: { request_id: requestId },
      },
      "history_pruned",
      requestId,
    );
    process.stdout.write(
      `Pruned ${event.data.removed} saved chat${event.data.removed === 1 ? "" : "s"}.\n`,
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
    );
  });
}

async function historyExport(id: string, file?: string) {
  await withClient(async (client) => {
    const requestId = crypto.randomUUID();
    const event = await request(
      client,
<<<<<<< HEAD
      { type: 'history_show', data: { request_id: requestId, id } },
      'history_chat',
=======
      { type: "history_show", data: { request_id: requestId, id } },
      "history_chat",
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
      requestId,
    );
    const output = `${JSON.stringify(event.data.chat, null, 2)}\n`;
    if (!file || file === '-') {
      process.stdout.write(output);
      return;
    }
    const target = resolve(file);
    await writeFile(target, output, { flag: 'wx' });
    process.stdout.write(`Exported chat ${id} to ${target}.\n`);
  });
}

async function providersList() {
  await withClient(async (client) => {
    const requestId = crypto.randomUUID();
    const event = await request(
      client,
<<<<<<< HEAD
      { type: 'get_providers', data: { request_id: requestId } },
      'providers',
=======
      { type: "get_providers", data: { request_id: requestId } },
      "providers",
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
      requestId,
    );
    for (const provider of event.data.providers) {
      process.stdout.write(
<<<<<<< HEAD
        `${provider.id}  ${provider.name}${provider.requires_api_key ? '  (API key required)' : ''}\n  ${provider.endpoint}\n`,
      );
    }
    if (event.data.providers.length === 0)
      process.stdout.write('No providers are available.\n');
=======
        `${provider.id}  ${provider.name}${provider.requires_api_key ? "  (API key required)" : ""}\n  ${provider.endpoint}\n`,
      );
    }
    if (event.data.providers.length === 0)
      process.stdout.write("No providers are available.\n");
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
  });
}

async function pluginsList() {
  runCoreCommand(['plugins', 'list']);
}

async function pluginInstall(path: string) {
  runCoreCommand(['plugins', 'install', resolve(path)]);
}

async function pluginToggle(id: string, enabled: boolean) {
  runCoreCommand(['plugins', enabled ? 'enable' : 'disable', id]);
}

async function pluginRemove(id: string) {
  runCoreCommand(['plugins', 'uninstall', id]);
}

async function mcpList() {
  runCoreCommand(['mcp', 'list']);
}

async function mcpAdd(
  id: string,
  command: string,
  args: string[],
  options: { env?: string[] },
) {
<<<<<<< HEAD
  const forwarded = ['mcp', 'add', id, command, ...args];
  for (const item of options.env ?? []) forwarded.push('--env', item);
=======
  const forwarded = ["mcp", "add", id, command, ...args];
  for (const item of options.env ?? []) forwarded.push("--env", item);
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
  runCoreCommand(forwarded);
}

async function mcpAddHttp(
  id: string,
  url: string,
  options: { header?: string[] },
) {
<<<<<<< HEAD
  const forwarded = ['mcp', 'add-http', id, url];
  for (const item of options.header ?? []) forwarded.push('--header', item);
=======
  const forwarded = ["mcp", "add-http", id, url];
  for (const item of options.header ?? []) forwarded.push("--header", item);
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
  runCoreCommand(forwarded);
}

async function mcpToggle(id: string, enabled: boolean) {
  runCoreCommand(['mcp', enabled ? 'enable' : 'disable', id]);
}

async function mcpRemove(id: string) {
  runCoreCommand(['mcp', 'remove', id]);
}

async function mcpTools(id: string) {
  runCoreCommand(['mcp', 'tools', id]);
}

function runCoreCommand(args: string[]) {
  const localBuilds = [
    resolve(import.meta.dir, '../../target/debug/luma-core'),
    resolve(import.meta.dir, '../../target/release/luma-core'),
  ];
  const executable =
    process.env.LUMA_BINARY ??
    process.env.LUMA_CORE_BIN ??
    localBuilds.find(existsSync) ??
<<<<<<< HEAD
    'luma-core';
  const result = spawnSync(executable, args, {
    encoding: 'utf8',
=======
    "luma-core";
  const result = spawnSync(executable, args, {
    encoding: "utf8",
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
    windowsHide: true,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.status !== 0) {
    const message =
      result.stderr?.trim() ||
      (result.error
        ? userError(result.error)
<<<<<<< HEAD
        : `luma-core ${args.join(' ')} exited with code ${result.status ?? 'unknown'}.`);
=======
        : `luma-core ${args.join(" ")} exited with code ${result.status ?? "unknown"}.`);
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
    throw new Error(userError(message));
  }
}

function lumaConfigDirectory() {
<<<<<<< HEAD
  return process.platform === 'darwin'
    ? resolve(homedir(), 'Library', 'Application Support', 'luma')
    : process.platform === 'win32'
      ? resolve(
          process.env.APPDATA ?? resolve(homedir(), 'AppData', 'Roaming'),
          'luma',
        )
      : resolve(
          process.env.XDG_CONFIG_HOME ?? resolve(homedir(), '.config'),
          'luma',
=======
  return process.platform === "darwin"
    ? resolve(homedir(), "Library", "Application Support", "luma")
    : process.platform === "win32"
      ? resolve(
          process.env.APPDATA ?? resolve(homedir(), "AppData", "Roaming"),
          "luma",
        )
      : resolve(
          process.env.XDG_CONFIG_HOME ?? resolve(homedir(), ".config"),
          "luma",
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
        );
}

function gatewayStatus() {
  runCoreCommand(['gateway', 'status']);
}

function gatewayStart() {
  runCoreCommand(['gateway', 'start']);
}

function gatewayStop() {
  runCoreCommand(['gateway', 'stop']);
}

function gatewayRestart() {
  runCoreCommand(['gateway', 'restart']);
}

async function gatewayLogs(options: { lines?: string }) {
  const path = resolve(lumaConfigDirectory(), 'luma.log');
  const lines = Number(options.lines ?? 50);
  if (!Number.isInteger(lines) || lines < 1 || lines > 10_000)
<<<<<<< HEAD
    throw new Error('--lines must be an integer from 1 to 10000.');
=======
    throw new Error("--lines must be an integer from 1 to 10000.");
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
  if (!existsSync(path)) {
    process.stdout.write('No Luma log file exists yet.\n');
    return;
  }
  const content = readFileSync(path, 'utf8');
  process.stdout.write(content.split(/\r?\n/).slice(-lines).join('\n'));
}

function gatewayConfig() {
  const directory = lumaConfigDirectory();
  const endpoint =
<<<<<<< HEAD
    process.platform === 'win32'
      ? '127.0.0.1:39271'
      : resolve(directory, 'gateway.sock');
  process.stdout.write(
    `Config directory: ${directory}\nConfig: ${resolve(directory, 'config.toml')}\nRuntime database: ${resolve(directory, 'runtime.sqlite3')}\nGateway endpoint: ${endpoint}\nLog: ${resolve(directory, 'luma.log')}\n`,
=======
    process.platform === "win32"
      ? "127.0.0.1:39271"
      : resolve(directory, "gateway.sock");
  process.stdout.write(
    `Config directory: ${directory}\nConfig: ${resolve(directory, "config.toml")}\nRuntime database: ${resolve(directory, "runtime.sqlite3")}\nGateway endpoint: ${endpoint}\nLog: ${resolve(directory, "luma.log")}\n`,
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
  );
}

function configPath() {
  const base =
<<<<<<< HEAD
    process.platform === 'darwin'
      ? resolve(homedir(), 'Library', 'Application Support', 'luma')
      : process.platform === 'win32'
        ? resolve(
            process.env.APPDATA ?? resolve(homedir(), 'AppData', 'Roaming'),
            'luma',
          )
        : resolve(
            process.env.XDG_CONFIG_HOME ?? resolve(homedir(), '.config'),
            'luma',
          );
  process.stdout.write(`${resolve(base, 'config.toml')}\n`);
=======
    process.platform === "darwin"
      ? resolve(homedir(), "Library", "Application Support", "luma")
      : process.platform === "win32"
        ? resolve(
            process.env.APPDATA ?? resolve(homedir(), "AppData", "Roaming"),
            "luma",
          )
        : resolve(
            process.env.XDG_CONFIG_HOME ?? resolve(homedir(), ".config"),
            "luma",
          );
  process.stdout.write(`${resolve(base, "config.toml")}\n`);
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
}

async function summaryAdd(id: string, summary: string[]) {
  await withClient(async (client) => {
    const requestId = crypto.randomUUID();
    await request(
      client,
      {
<<<<<<< HEAD
        type: 'summary_add',
        data: { request_id: requestId, id, summary: summary.join(' ') },
      },
      'summary_saved',
=======
        type: "summary_add",
        data: { request_id: requestId, id, summary: summary.join(" ") },
      },
      "summary_saved",
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
      requestId,
    );
    process.stdout.write(`Summary saved for chat ${id}.\n`);
  });
}

const defaultAgentConfiguration = (): AgentConfiguration => ({
  system_prompt: '',
  specialization: null,
  mascot: 'auto',
  use_global_context: true,
  skills: [],
  provider: null,
  model: null,
  endpoint: null,
  workspace: process.cwd(),
  allowed_workspaces: [process.cwd()],
  enabled_tools: [],
  network_access: true,
  permissions: {
    allowed_tools: [
<<<<<<< HEAD
      'read_file',
      'list_directory',
      'search_files',
      'git_status',
      'git_diff',
      'find_symbols',
      'find_references',
      'git_log',
      'git_show',
      'git_blame',
      'git_branches',
      'file_metadata',
      'find_todos',
      'count_lines',
      'inspect_project',
      'list_skills',
      'load_skill',
      'web_search',
      'fetch_url',
=======
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
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
    ],
    denied_tools: [],
    auto_approve_read_only: true,
    require_approval_for_mutations: true,
    allow_network: true,
  },
  max_concurrent_tasks: 1,
  recover_interrupted_tasks: false,
});

async function teammatesList() {
  await withClient(async (client) => {
    const requestId = crypto.randomUUID();
    const event = await request(
      client,
<<<<<<< HEAD
      { type: 'agents_list', data: { request_id: requestId } },
      'agents',
=======
      { type: "agents_list", data: { request_id: requestId } },
      "agents",
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
      requestId,
    );
    if (event.data.agents.length === 0)
      process.stdout.write(
<<<<<<< HEAD
        'No teammates yet. Create one with: luma teammates create <name>\n',
=======
        "No teammates yet. Create one with: luma teammates create <name>\n",
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
      );
    for (const agent of event.data.agents) {
      process.stdout.write(
        `${agent.id}  ${agent.name}  [${agent.status}]  ${agent.kind}\n`,
      );
    }
  });
}

async function teammatesCreate(
  name: string,
  kind: AgentKind,
  options: {
    workspace?: string;
    personality?: string;
    skill?: string[];
    memory?: string;
  },
) {
  await withClient(async (client) => {
    const configuration = defaultAgentConfiguration();
    configuration.system_prompt = options.personality ?? '';
    configuration.skills = options.skill ?? [];
    if (options.workspace) {
      configuration.workspace = resolve(options.workspace);
      configuration.allowed_workspaces = [configuration.workspace];
    }
    const requestId = crypto.randomUUID();
    const event = await request(
      client,
      {
<<<<<<< HEAD
        type: 'agent_create',
=======
        type: "agent_create",
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
        data: {
          request_id: requestId,
          name,
          description: null,
          kind,
          configuration,
        },
      },
<<<<<<< HEAD
      'agent_saved',
=======
      "agent_saved",
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
      requestId,
    );
    if (options.memory?.trim()) {
      const memoryRequestId = crypto.randomUUID();
      await request(
        client,
        {
<<<<<<< HEAD
          type: 'memory_add',
          data: {
            request_id: memoryRequestId,
            scope: 'agent',
            scope_id: event.data.agent.id,
            content: options.memory.trim(),
            source: 'cli:create-teammate',
          },
        },
        'memory_saved',
=======
          type: "memory_add",
          data: {
            request_id: memoryRequestId,
            scope: "agent",
            scope_id: event.data.agent.id,
            content: options.memory.trim(),
            source: "cli:create-teammate",
          },
        },
        "memory_saved",
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
        memoryRequestId,
      );
    }
    process.stdout.write(
      `Created ${kind} agent ${event.data.agent.name} (${event.data.agent.id}).\n`,
    );
  });
}

async function teammatesDelete(id: string) {
  await withClient(async (client) => {
    const requestId = crypto.randomUUID();
    const event = await request(
      client,
<<<<<<< HEAD
      { type: 'agent_delete', data: { request_id: requestId, id } },
      'agent_deleted',
=======
      { type: "agent_delete", data: { request_id: requestId, id } },
      "agent_deleted",
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
      requestId,
    );
    if (!event.data.deleted) throw new Error(`Teammate not found: ${id}`);
    process.stdout.write(`Deleted teammate ${id}.\n`);
  });
}

async function tasksList(agentId?: string) {
  await withClient(async (client) => {
    const requestId = crypto.randomUUID();
    const event = await request(
      client,
      {
<<<<<<< HEAD
        type: 'tasks_list',
        data: { request_id: requestId, agent_id: agentId ?? null, limit: 200 },
      },
      'tasks',
      requestId,
    );
    if (event.data.tasks.length === 0) process.stdout.write('No tasks.\n');
=======
        type: "tasks_list",
        data: { request_id: requestId, agent_id: agentId ?? null, limit: 200 },
      },
      "tasks",
      requestId,
    );
    if (event.data.tasks.length === 0) process.stdout.write("No tasks.\n");
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
    for (const task of event.data.tasks)
      process.stdout.write(
        `${task.id}  [${task.status}]  ${task.title}\n  agent: ${task.agent_id}\n`,
      );
  });
}

async function taskCreate(agentId: string, prompt: string[]) {
  await withClient(async (client) => {
    const requestId = crypto.randomUUID();
    const event = await request(
      client,
      {
<<<<<<< HEAD
        type: 'task_create',
        data: {
          request_id: requestId,
          agent_id: agentId,
          request: prompt.join(' '),
=======
        type: "task_create",
        data: {
          request_id: requestId,
          agent_id: agentId,
          request: prompt.join(" "),
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
          title: null,
          workspace: process.cwd(),
          recover_on_restart: false,
        },
      },
<<<<<<< HEAD
      'task_saved',
=======
      "task_saved",
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
      requestId,
    );
    process.stdout.write(`Queued task ${event.data.task.id}.\n`);
  });
}

async function taskAction(id: string, action: 'task_cancel' | 'task_retry') {
  await withClient(async (client) => {
    const requestId = crypto.randomUUID();
    const event = await request(
      client,
      { type: action, data: { request_id: requestId, id } },
<<<<<<< HEAD
      'task_saved',
=======
      "task_saved",
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
      requestId,
    );
    process.stdout.write(
      `Task ${event.data.task.id}: ${event.data.task.status}.\n`,
    );
  });
}

async function approvalsList() {
  await withClient(async (client) => {
    const requestId = crypto.randomUUID();
    const event = await request(
      client,
<<<<<<< HEAD
      { type: 'approvals_list', data: { request_id: requestId } },
      'approvals',
      requestId,
    );
    if (event.data.approvals.length === 0)
      process.stdout.write('No pending approvals.\n');
=======
      { type: "approvals_list", data: { request_id: requestId } },
      "approvals",
      requestId,
    );
    if (event.data.approvals.length === 0)
      process.stdout.write("No pending approvals.\n");
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
    for (const approval of event.data.approvals)
      process.stdout.write(
        `${approval.id}  ${approval.tool}\n  task: ${approval.task_id}\n  ${approval.arguments}\n`,
      );
  });
}

async function approvalResolve(id: string, allowed: boolean) {
  await withClient(async (client) => {
    const requestId = crypto.randomUUID();
    const event = await request(
      client,
      {
<<<<<<< HEAD
        type: 'approval_resolve',
        data: { request_id: requestId, id, allowed },
      },
      'approval_resolved',
=======
        type: "approval_resolve",
        data: { request_id: requestId, id, allowed },
      },
      "approval_resolved",
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
      requestId,
    );
    process.stdout.write(
      `${event.data.approval.status}: ${event.data.approval.tool}\n`,
    );
  });
}

async function memoryAdd(
  scope: MemoryScope,
  scopeId: string,
  content: string[],
) {
  await withClient(async (client) => {
    const requestId = crypto.randomUUID();
    const event = await request(
      client,
      {
<<<<<<< HEAD
        type: 'memory_add',
=======
        type: "memory_add",
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
        data: {
          request_id: requestId,
          scope,
          scope_id: scopeId,
<<<<<<< HEAD
          content: content.join(' '),
          source: 'cli',
        },
      },
      'memory_saved',
=======
          content: content.join(" "),
          source: "cli",
        },
      },
      "memory_saved",
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
      requestId,
    );
    process.stdout.write(
      `Saved memory ${event.data.entry.id} in ${scope}:${scopeId}.\n`,
    );
  });
}

async function memoryList(scope: MemoryScope, scopeId: string) {
  await withClient(async (client) => {
    const requestId = crypto.randomUUID();
    const event = await request(
      client,
      {
<<<<<<< HEAD
        type: 'memory_list',
=======
        type: "memory_list",
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
        data: {
          request_id: requestId,
          scope,
          scope_id: scopeId,
          query: null,
          limit: 200,
        },
      },
<<<<<<< HEAD
      'memory',
=======
      "memory",
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
      requestId,
    );
    for (const entry of event.data.entries)
      process.stdout.write(`${entry.id}  ${entry.content}\n`);
    if (event.data.entries.length === 0)
<<<<<<< HEAD
      process.stdout.write('No memory entries.\n');
=======
      process.stdout.write("No memory entries.\n");
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
  });
}

async function schedulesList() {
  await withClient(async (client) => {
    const requestId = crypto.randomUUID();
    const event = await request(
      client,
      {
<<<<<<< HEAD
        type: 'schedules_list',
        data: { request_id: requestId, agent_id: null },
      },
      'schedules',
=======
        type: "schedules_list",
        data: { request_id: requestId, agent_id: null },
      },
      "schedules",
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
      requestId,
    );
    for (const schedule of event.data.schedules)
      process.stdout.write(
<<<<<<< HEAD
        `${schedule.id}  ${schedule.title}  ${schedule.enabled ? 'enabled' : 'disabled'}  next ${new Date(schedule.next_run_at * 1000).toLocaleString()}\n`,
      );
    if (event.data.schedules.length === 0)
      process.stdout.write('No schedules.\n');
=======
        `${schedule.id}  ${schedule.title}  ${schedule.enabled ? "enabled" : "disabled"}  next ${new Date(schedule.next_run_at * 1000).toLocaleString()}\n`,
      );
    if (event.data.schedules.length === 0)
      process.stdout.write("No schedules.\n");
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
  });
}

async function scheduleCreate(
  agentId: string,
  interval: string,
  prompt: string[],
) {
  const everySeconds = Number(interval);
  if (
    !Number.isInteger(everySeconds) ||
    everySeconds < 60 ||
    everySeconds > 31_536_000
  )
    throw new Error(
<<<<<<< HEAD
      'Schedule interval must be between 60 seconds and one year.',
=======
      "Schedule interval must be between 60 seconds and one year.",
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
    );
  await withClient(async (client) => {
    const requestId = crypto.randomUUID();
    const event = await request(
      client,
      {
<<<<<<< HEAD
        type: 'schedule_create',
        data: {
          request_id: requestId,
          agent_id: agentId,
          title: 'Recurring task',
          prompt: prompt.join(' '),
=======
        type: "schedule_create",
        data: {
          request_id: requestId,
          agent_id: agentId,
          title: "Recurring task",
          prompt: prompt.join(" "),
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
          run_at: null,
          every_seconds: everySeconds,
        },
      },
<<<<<<< HEAD
      'schedule_saved',
=======
      "schedule_saved",
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
      requestId,
    );
    process.stdout.write(`Created schedule ${event.data.schedule.id}.\n`);
  });
}

async function startDashboardEnvironment(host: string, port: number) {
  const client = new LumaClient();
  let shutdown: (() => void) | null = null;

  const waitForShutdown = new Promise<void>((resolveShutdown) => {
    shutdown = resolveShutdown;
    process.once('SIGINT', resolveShutdown);
    process.once('SIGTERM', resolveShutdown);
  });

  try {
    const core = startDesktopServer();
    await client.connect();

    const requestId = crypto.randomUUID();
    const event = await request(
      client,
      {
<<<<<<< HEAD
        type: 'start_dashboard',
        data: { request_id: requestId, host, port },
      },
      'dashboard_started',
=======
        type: "start_dashboard",
        data: { request_id: requestId, host, port },
      },
      "dashboard_started",
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
      requestId,
    );

    process.stdout.write(
      `Luma dashboard\nURL: http://${event.data.address}\nPress Ctrl+C to stop the server.\n`,
    );

    await Promise.race([
      waitForShutdown,
      core.exited.then((code) => {
        throw new Error(
<<<<<<< HEAD
          `Luma core exited${code === 0 ? '' : ` with code ${code}`}.`,
=======
          `Luma core exited${code === 0 ? "" : ` with code ${code}`}.`,
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
        );
      }),
    ]);
  } finally {
    if (shutdown) {
      process.removeListener('SIGINT', shutdown);
      process.removeListener('SIGTERM', shutdown);
    }
    client.disconnect();
    stopDesktopServer();
  }
}

async function ask(prompt: string[]) {
  const client = new LumaClient();
  try {
    startDesktopServer();
    await client.connect();
    await new Promise<void>((resolve, reject) => {
      const unsubscribe = client.subscribe((event) => {
        if (event.type === 'error' && event.data.request_id === null) {
          process.stderr.write(`${event.data.message}\n`);
          unsubscribe();
          reject(new Error(event.data.message));
          return;
        }
<<<<<<< HEAD
        if (event.type !== 'agent') return;
        if (event.data.event.type === 'TextDelta')
          process.stdout.write(event.data.event.data);
        if (event.data.event.type === 'Finished') {
          process.stdout.write('\n');
=======
        if (event.type !== "agent") return;
        if (event.data.event.type === "TextDelta")
          process.stdout.write(event.data.event.data);
        if (event.data.event.type === "Finished") {
          process.stdout.write("\n");
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
          unsubscribe();
          resolve();
        }
        if (event.data.event.type === 'Error') {
          process.stderr.write(`${event.data.event.data}\n`);
          unsubscribe();
          reject(new Error(event.data.event.data));
        }
      });
      try {
        client.send({ type: 'prompt', data: { text: prompt.join(' ') } });
      } catch (error) {
        unsubscribe();
        reject(error);
      }
    });
  } finally {
    client.disconnect();
    stopDesktopServer();
  }
}

export async function runCli(argv: string[]) {
  const program = new Command()
    .name('luma')
    .description('Luma — an AI coding agent')
    .version(process.env.LUMA_VERSION ?? 'development')
    .action(() => launchInteractive());

  program
<<<<<<< HEAD
    .command('setup')
    .description('Configure the model provider and ReAct model')
    .action(() => launchInteractive(true));

  const history = program
    .command('history')
    .description('Browse saved conversations')
    .action(historyList);
  history.command('list').description('List saved chats').action(historyList);
  history
    .command('show <id>')
    .description('Show a saved chat')
    .action(historyShow);
  history
    .command('delete <id>')
    .description('Permanently delete a saved chat')
    .option('-y, --yes', 'Skip the confirmation prompt')
    .action(historyDelete);
  history
    .command('prune')
    .description('Permanently delete every saved chat')
    .option('-y, --yes', 'Skip the confirmation prompt')
    .action(historyPrune);
  history
    .command('export <id> [file]')
    .description('Export a saved chat as JSON (use - for stdout)')
    .action(historyExport);

  const config = program
    .command('config')
    .description('Inspect Luma configuration locations');
  config
    .command('path')
    .description('Print the active config.toml path')
    .action(configPath);

  const gateway = program
    .command('gateway')
    .description('Manage the persistent Teammates gateway');
  gateway
    .command('status')
    .description('Show whether the gateway is running')
    .action(gatewayStatus);
  gateway
    .command('start')
    .description('Start the gateway in the background')
    .action(gatewayStart);
  gateway.command('stop').description('Stop the gateway').action(gatewayStop);
  gateway
    .command('restart')
    .description('Restart the gateway')
    .action(gatewayRestart);
  gateway
    .command('logs')
    .description('Show recent gateway log output')
    .option('-n, --lines <count>', 'Number of lines to show', '50')
    .action(gatewayLogs);
  gateway
    .command('config')
    .description('Print gateway and runtime file locations')
    .action(gatewayConfig);

  program
    .command('providers')
    .description('List model providers supported by this Luma build')
    .action(providersList);

  const plugins = program
    .command('plugins')
    .description('Manage native Luma plugins')
    .action(pluginsList);
  plugins
    .command('list')
    .description('List installed Luma plugins')
    .action(pluginsList);
  plugins
    .command('install <path>')
    .description('Install a local Luma plugin package (disabled by default)')
    .action(pluginInstall);
  plugins
    .command('enable <id>')
    .description('Enable a Luma plugin')
    .action((id: string) => pluginToggle(id, true));
  plugins
    .command('disable <id>')
    .description('Disable a Luma plugin')
    .action((id: string) => pluginToggle(id, false));
  plugins
    .command('uninstall <id>')
    .description('Uninstall a Luma plugin')
    .action(pluginRemove);

  const mcp = program
    .command('mcp')
    .description('Manage Model Context Protocol servers')
    .action(mcpList);
  mcp.command('list').description('List MCP servers').action(mcpList);
  mcp
    .command('add <id> <command> [args...]')
    .description('Register a local stdio MCP server (disabled by default)')
    .allowUnknownOption(true)
    .option(
      '--env <key=value>',
      'Pass an environment variable (repeatable)',
=======
    .command("setup")
    .description("Configure the model provider and ReAct model")
    .action(() => launchInteractive(true));

  const history = program
    .command("history")
    .description("Browse saved conversations")
    .action(historyList);
  history.command("list").description("List saved chats").action(historyList);
  history
    .command("show <id>")
    .description("Show a saved chat")
    .action(historyShow);
  history
    .command("delete <id>")
    .description("Permanently delete a saved chat")
    .option("-y, --yes", "Skip the confirmation prompt")
    .action(historyDelete);
  history
    .command("prune")
    .description("Permanently delete every saved chat")
    .option("-y, --yes", "Skip the confirmation prompt")
    .action(historyPrune);
  history
    .command("export <id> [file]")
    .description("Export a saved chat as JSON (use - for stdout)")
    .action(historyExport);

  const config = program
    .command("config")
    .description("Inspect Luma configuration locations");
  config
    .command("path")
    .description("Print the active config.toml path")
    .action(configPath);

  const gateway = program
    .command("gateway")
    .description("Manage the persistent Teammates gateway");
  gateway
    .command("status")
    .description("Show whether the gateway is running")
    .action(gatewayStatus);
  gateway
    .command("start")
    .description("Start the gateway in the background")
    .action(gatewayStart);
  gateway.command("stop").description("Stop the gateway").action(gatewayStop);
  gateway
    .command("restart")
    .description("Restart the gateway")
    .action(gatewayRestart);
  gateway
    .command("logs")
    .description("Show recent gateway log output")
    .option("-n, --lines <count>", "Number of lines to show", "50")
    .action(gatewayLogs);
  gateway
    .command("config")
    .description("Print gateway and runtime file locations")
    .action(gatewayConfig);

  program
    .command("providers")
    .description("List model providers supported by this Luma build")
    .action(providersList);

  const plugins = program
    .command("plugins")
    .description("Manage native Luma plugins")
    .action(pluginsList);
  plugins
    .command("list")
    .description("List installed Luma plugins")
    .action(pluginsList);
  plugins
    .command("install <path>")
    .description("Install a local Luma plugin package (disabled by default)")
    .action(pluginInstall);
  plugins
    .command("enable <id>")
    .description("Enable a Luma plugin")
    .action((id: string) => pluginToggle(id, true));
  plugins
    .command("disable <id>")
    .description("Disable a Luma plugin")
    .action((id: string) => pluginToggle(id, false));
  plugins
    .command("uninstall <id>")
    .description("Uninstall a Luma plugin")
    .action(pluginRemove);

  const mcp = program
    .command("mcp")
    .description("Manage Model Context Protocol servers")
    .action(mcpList);
  mcp.command("list").description("List MCP servers").action(mcpList);
  mcp
    .command("add <id> <command> [args...]")
    .description("Register a local stdio MCP server (disabled by default)")
    .allowUnknownOption(true)
    .option(
      "--env <key=value>",
      "Pass an environment variable (repeatable)",
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
      (value: string, previous: string[] = []) => [...previous, value],
      [],
    )
    .action(mcpAdd);
  mcp
<<<<<<< HEAD
    .command('add-http <id> <url>')
    .description('Register a Streamable HTTP MCP server (disabled by default)')
    .option(
      '--header <key=value>',
      'HTTP request header (repeatable)',
=======
    .command("add-http <id> <url>")
    .description("Register a Streamable HTTP MCP server (disabled by default)")
    .option(
      "--header <key=value>",
      "HTTP request header (repeatable)",
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
      (value: string, previous: string[] = []) => [...previous, value],
      [],
    )
    .action(mcpAddHttp);
  mcp
<<<<<<< HEAD
    .command('enable <id>')
    .description('Enable an MCP server')
    .action((id: string) => mcpToggle(id, true));
  mcp
    .command('disable <id>')
    .description('Disable an MCP server')
    .action((id: string) => mcpToggle(id, false));
  mcp
    .command('remove <id>')
    .description('Remove an MCP server configuration')
    .action(mcpRemove);
  mcp
    .command('tools <id>')
    .description('Discover tools exposed by an MCP server')
    .action(mcpTools);

  program
    .command('summary')
    .description('Manage saved conversation summaries')
    .command('add <id> <summary...>')
    .description('Save a summary for a chat')
    .action(summaryAdd);

  const teammates = program
    .command('teammates')
    .description('Manage persistent Teammates agents')
    .action(launchTeammates);
  teammates
    .command('list')
    .description('List persistent agents')
    .action(teammatesList);
  teammates
    .command('create <name>')
    .description('Create a persistent teammate')
    .option('--workspace <path>', 'Workspace this teammate may access')
    .option(
      '--personality <instructions>',
      'Custom personality / system instructions',
    )
    .option(
      '--skill <name>',
      'Attach a skill (repeatable)',
      (value: string, previous: string[] = []) => [...previous, value],
      [],
    )
    .option('--memory <text>', 'Initial agent memory')
=======
    .command("enable <id>")
    .description("Enable an MCP server")
    .action((id: string) => mcpToggle(id, true));
  mcp
    .command("disable <id>")
    .description("Disable an MCP server")
    .action((id: string) => mcpToggle(id, false));
  mcp
    .command("remove <id>")
    .description("Remove an MCP server configuration")
    .action(mcpRemove);
  mcp
    .command("tools <id>")
    .description("Discover tools exposed by an MCP server")
    .action(mcpTools);

  program
    .command("summary")
    .description("Manage saved conversation summaries")
    .command("add <id> <summary...>")
    .description("Save a summary for a chat")
    .action(summaryAdd);

  const teammates = program
    .command("teammates")
    .description("Manage persistent Teammates agents")
    .action(launchTeammates);
  teammates
    .command("list")
    .description("List persistent agents")
    .action(teammatesList);
  teammates
    .command("create <name>")
    .description("Create a persistent teammate")
    .option("--workspace <path>", "Workspace this teammate may access")
    .option(
      "--personality <instructions>",
      "Custom personality / system instructions",
    )
    .option(
      "--skill <name>",
      "Attach a skill (repeatable)",
      (value: string, previous: string[] = []) => [...previous, value],
      [],
    )
    .option("--memory <text>", "Initial agent memory")
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
    .action(
      (
        name: string,
        options: {
          workspace?: string;
          personality?: string;
          skill: string[];
          memory?: string;
        },
<<<<<<< HEAD
      ) => teammatesCreate(name, 'teammates', options),
    );
  teammates
    .command('delete <id>')
    .description('Delete a teammate and its dependent runtime data')
    .action(teammatesDelete);
  teammates
    .command('create-code <name>')
    .description('Create a persistent Code agent')
    .option('--workspace <path>', 'Workspace this agent may access')
    .option(
      '--personality <instructions>',
      'Custom personality / system instructions',
    )
    .option(
      '--skill <name>',
      'Attach a skill (repeatable)',
      (value: string, previous: string[] = []) => [...previous, value],
      [],
    )
    .option('--memory <text>', 'Initial agent memory')
=======
      ) => teammatesCreate(name, "teammates", options),
    );
  teammates
    .command("delete <id>")
    .description("Delete a teammate and its dependent runtime data")
    .action(teammatesDelete);
  teammates
    .command("create-code <name>")
    .description("Create a persistent Code agent")
    .option("--workspace <path>", "Workspace this agent may access")
    .option(
      "--personality <instructions>",
      "Custom personality / system instructions",
    )
    .option(
      "--skill <name>",
      "Attach a skill (repeatable)",
      (value: string, previous: string[] = []) => [...previous, value],
      [],
    )
    .option("--memory <text>", "Initial agent memory")
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
    .action(
      (
        name: string,
        options: {
          workspace?: string;
          personality?: string;
          skill: string[];
          memory?: string;
        },
<<<<<<< HEAD
      ) => teammatesCreate(name, 'code', options),
    );

  const tasks = program.command('tasks').description('Manage persistent tasks');
  tasks.command('list [agent-id]').description('List tasks').action(tasksList);
  tasks
    .command('create <agent-id> <prompt...>')
    .description('Queue a task for an agent')
    .action(taskCreate);
  tasks
    .command('cancel <id>')
    .description('Cancel a queued or running task')
    .action((id: string) => taskAction(id, 'task_cancel'));
  tasks
    .command('retry <id>')
    .description('Retry a failed or interrupted task')
    .action((id: string) => taskAction(id, 'task_retry'));

  const approvals = program
    .command('approvals')
    .description('Review persistent task approvals');
  approvals
    .command('list')
    .description('List pending approvals')
    .action(approvalsList);
  approvals
    .command('approve <id>')
    .description('Approve a pending operation')
    .action((id: string) => approvalResolve(id, true));
  approvals
    .command('deny <id>')
    .description('Deny a pending operation')
    .action((id: string) => approvalResolve(id, false));

  const memory = program
    .command('memory')
    .description('Inspect and update scoped memory');
  memory
    .command('list <scope> <scope-id>')
    .description('List memory entries')
=======
      ) => teammatesCreate(name, "code", options),
    );

  const tasks = program.command("tasks").description("Manage persistent tasks");
  tasks.command("list [agent-id]").description("List tasks").action(tasksList);
  tasks
    .command("create <agent-id> <prompt...>")
    .description("Queue a task for an agent")
    .action(taskCreate);
  tasks
    .command("cancel <id>")
    .description("Cancel a queued or running task")
    .action((id: string) => taskAction(id, "task_cancel"));
  tasks
    .command("retry <id>")
    .description("Retry a failed or interrupted task")
    .action((id: string) => taskAction(id, "task_retry"));

  const approvals = program
    .command("approvals")
    .description("Review persistent task approvals");
  approvals
    .command("list")
    .description("List pending approvals")
    .action(approvalsList);
  approvals
    .command("approve <id>")
    .description("Approve a pending operation")
    .action((id: string) => approvalResolve(id, true));
  approvals
    .command("deny <id>")
    .description("Deny a pending operation")
    .action((id: string) => approvalResolve(id, false));

  const memory = program
    .command("memory")
    .description("Inspect and update scoped memory");
  memory
    .command("list <scope> <scope-id>")
    .description("List memory entries")
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
    .action((scope: MemoryScope, scopeId: string) =>
      memoryList(scope, scopeId),
    );
  memory
<<<<<<< HEAD
    .command('add <scope> <scope-id> <content...>')
    .description('Add a memory entry')
    .action(memoryAdd);

  const schedules = program
    .command('schedules')
    .description('Manage recurring work');
  schedules.command('list').description('List schedules').action(schedulesList);
  schedules
    .command('create <agent-id> <seconds> <prompt...>')
    .description('Schedule a recurring task')
    .action(scheduleCreate);

  program
    .command('dashboard')
    .description('Start the embedded Luma browser dashboard')
    .option('--host <host>', 'Core API bind address', '127.0.0.1')
    .option('--port <port>', 'Core API port', '3000')
=======
    .command("add <scope> <scope-id> <content...>")
    .description("Add a memory entry")
    .action(memoryAdd);

  const schedules = program
    .command("schedules")
    .description("Manage recurring work");
  schedules.command("list").description("List schedules").action(schedulesList);
  schedules
    .command("create <agent-id> <seconds> <prompt...>")
    .description("Schedule a recurring task")
    .action(scheduleCreate);

  program
    .command("dashboard")
    .description("Start the embedded Luma browser dashboard")
    .option("--host <host>", "Core API bind address", "127.0.0.1")
    .option("--port <port>", "Core API port", "3000")
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
    .action((options: { host: string; port: string }) => {
      const port = Number(options.port);
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error('Port must be an integer from 0 to 65535.');
      }
      return startDashboardEnvironment(options.host, port);
    });

  program
<<<<<<< HEAD
    .command('ask <prompt...>')
    .description('Send a one-shot prompt to Luma')
=======
    .command("ask <prompt...>")
    .description("Send a one-shot prompt to Luma")
>>>>>>> 678fa539c3f84012e076f33d956b1e7fecd0ae6c
    .action(ask);

  await program.parseAsync(argv, { from: 'user' });
}
