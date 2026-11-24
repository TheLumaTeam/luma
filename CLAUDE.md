# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Luma is a coding agent plus a persistent "Teammates" runtime. One Rust binary, the **core** (`luma-core`, crate `luma-core`), does all the agent work. Every UI is a separate client that drives the core over a newline-delimited JSON protocol on stdio. Note that the `luma` command users type is the Ink client in `ui/`, not the Rust binary.

| Directory | What it is | Toolchain |
|---|---|---|
| `src/` | Core: agent loop, tools, sessions, runtime/gateway, protocol server | Cargo |
| `ui/` | `luma` terminal client (Ink/React) | **Bun** |
| `desktop/` | Electron app (Electron Forge + Vite + React 19) | **npm** |
| `dashboard/` | Browser UI (Vite + React), embedded into the core binary | **npm** |
| `shared/` | `protocol.ts`, `attachments.ts`, `mascot.ts`, imported directly by `ui/` and `desktop/` | n/a |
| `scripts/`, `wix/` | Installers and release bundling | bash/PowerShell/Python |

`GALAXY.md` is Luma's own generated workspace memory, not hand-written docs. `docs/` holds user-facing docs; `docs/architecture.md` and `docs/teammates.md` are the useful ones for design background.

## Commands

CI (`.github/workflows/validation.yml`) runs exactly these; run the relevant ones before finishing a change.

```sh
# Core (repo root)
cargo fmt --all -- --check
cargo test --locked --all-features
cargo clippy --locked --all-targets --all-features -- -D warnings
cargo test <name>                      # single test by name filter
cargo test --lib tests::agent_loop     # tests live in src/tests/ plus inline #[cfg(test)] modules

# Ink client
cd ui && bun install && bun run typecheck && bun run build

# Dashboard
cd dashboard && npm ci && npm run typecheck && npm run build

# Desktop
cd desktop && npm ci && npm run typecheck && npm run lint
cd desktop && npm start                # electron-forge dev (Vite on 5173); no test suite exists

# Installer scripts
bash scripts/test-install.sh           # after shellcheck + bash -n on scripts/install.sh
```

Gotchas:
- **`cargo build` runs `npm`.** `build.rs` builds `dashboard/` (installing deps if `node_modules` is missing) and `src/dashboard.rs` embeds `dashboard/dist` with `include_bytes!`. Node must be available, and dashboard edits trigger a rebuild.
- **`tui` is an optional feature** (legacy Ratatui front end: `src/tui/`, `src/bridge.rs`, `src/theme.rs`) and is *off* by default. Use `--all-features` so its code is compiled and tested. It is being replaced by the Ink client, and nothing in the core may depend on it. Release packaging uses `--no-default-features`.
- `ui/` follows Bun conventions (see `ui/CLAUDE.md`: `bun`, not node/npm/vite), but `desktop/` and `dashboard/` use npm. Don't mix them.
- Rust edition 2024.

## Architecture

### Core process modes (`src/main.rs`)
`luma-core` dispatches on its first argument:
- `desktop-server`: the stdio JSONL server every client uses (`src/desktop.rs`). Despite the name it serves the Ink client, desktop app and dashboard. It ensures the gateway is running, then loops over client messages.
- `gateway [status|start|stop|restart]`: the durable supervisor (`src/gateway.rs`) that runs queued and scheduled Teammate tasks independently of any UI. Local IPC only (Unix socket, or `127.0.0.1:39271` on Windows).
- `task-worker <task-id>`: one worker process per Teammate task (`src/worker.rs`).
- `plugins ...` / `mcp ...`: management subcommands (`src/integration_cli.rs`).
- No args: legacy Ratatui TUI (requires the `tui` feature).

State lives under `dirs::config_dir()/luma` (`config.toml`, `runtime.sqlite3`, `gateway.sock`, `luma.log`, `chats/`, `skills/`). The desktop app uses the same path via `app.getPath("appData")/luma`, since Electron's `userData` casing differs.

### Layers in the core
- **Agent loop** (`agent.rs`, `react.rs`): ReAct, with one configured model that picks an action, observes the tool result, and repeats until a final answer. Plans are structured, persisted with the task, and gated by approval. Tools live in `src/tools/` behind a registry. `context.rs` holds history and workspace observations.
- **Session** (`session.rs`): owns conversation state. Local slash commands (`/restore`, `/clear`, `/history ...`) are resolved here and never reach the agent. A session refuses `/restore` while busy, so clients must cancel and wait for idle first. Commands are registered in `commands.rs`.
- **Models** (`model/`, `provider.rs`): OpenAI-compatible, Anthropic and Gemini behind one `DynamicModel`. Providers are discovered at runtime, and clients must not hardcode a registry.
- **Runtime** (`runtime.rs`, ~200KB, SQLite via `rusqlite`): the persistent store for agents (Teammates), tasks, approvals, memory, schedules, event triggers and the append-only `events` table. Teammate tool actions are journaled before and after execution so a crash leaves them "uncertain" until the user reconciles. Concurrency is capped by per-Teammate limits and exclusive workspace leases.
- **Extensibility**: `mcp/` (MCP client/manager), `plugins/` (native plugins from `plugin.toml`), `tools/skills.rs` plus top-level `skills/` (Agent Skills).

### The protocol is the contract
`src/protocol.rs` (Rust) and `shared/protocol.ts` (TypeScript) are two hand-maintained copies of the same wire format: `ClientMessage`/`ServerEvent` as `{type, data}`, with `request_id` on every request/response pair. **Change both together**, and bump `PROTOCOL_VERSION` (currently 4, in both files) for breaking changes. Clients refuse a mismatched core. Additive features are discovered via `runtime_capabilities` instead. A request that carries a `request_id` is answered with a matching event or an `error` carrying the same ID. A failing request should produce that error event and must not take the `desktop-server` process down.

### Desktop app (`desktop/src`)
Three Electron layers, which must be edited together when adding a capability:
1. `main.ts`: spawns `luma-core desktop-server` (dev builds resolve `../target/{debug,release}/luma-core`, or `LUMA_BINARY`; user setting in `core-binary.json`), correlates requests by `request_id` (`requestLuma`), and exposes IPC through `handleIpc`, which only trusts the app's own frame. It also owns the PTY terminals, workspace file access (path-escape and symlink guarded), the menu and the titlebar.
2. `preload.ts`: the `window.luma` bridge, using `contextIsolation` and `sandbox`. It re-parses events with `parseServerEvent`.
3. `renderer.d.ts` types `window.luma`. The renderer is mostly one large `App.tsx` (Code view, IDE view, Teammates panel, settings) plus `components/`, `stores/` (zustand) and `renderer/hooks/useLuma.ts`.

Styling is layered plain CSS (`index.css`, `design.css`, `visual-polish.css`, `settings-ide-polish.css`, `teammates-polish.css`, loaded in that order, later wins) on `--luma-*` tokens, with Tailwind utility classes in TSX. Accent colors are set per workspace (`data-workspace` / `data-workspace-mode`) and only for the Luma theme family.

The Ink client (`ui/src/client.ts`, `server.ts`) and the dashboard use the same protocol; the dashboard goes through the core's axum/WebSocket server in `src/dashboard.rs`.
