# Changelog

All notable changes to Luma are documented here.

## [Unreleased]

### Added

- The installers add Luma Desktop as an application: in `~/Applications` on
  macOS, in the application launcher on Linux, and in the Start menu and
  Installed apps on Windows.
- The installers ask for your name, model settings, and default workspace.
- `luma update` and `luma doctor`, including `luma doctor --repair`.
- The installers check free disk space first, warn about problems that would
  stop the Linux app from opening, and check build provenance when the GitHub
  CLI is signed in.
- Release files are attested.
- On macOS, the installer signs the installed app and Core ad hoc.
- A failed or interrupted install restores the previous installation, and
  downloads are retried.

### Changed

- Luma Core finds its installed tools itself, so Desktop and the gateway work
  when started outside a terminal. An installed Desktop app uses the installed
  Core by default, and no longer uses its launch directory as a workspace.
- The installers pick the latest release by publication time, and the Windows
  installer honors `LUMA_VERSION`.
- The installers and documentation use the `TheLumaTeam/luma` repository.

### Fixed

- The packaged macOS app now has a valid ad-hoc signature.
- Release bundles keep the links inside the macOS app. Copying their targets
  made the app more than twice as large and broke its signature.

### Security

- On macOS and Linux, `config.toml` is readable only by its owner.

## [1.0.0-beta.2] - 2026-11-28

This beta adds the packaged Desktop application and makes Teammates
conversational: each one keeps an ongoing chat, can message you and each
other, and can work in groups. It also adds auto mode and an MCP Store.

### Added

#### Desktop

- Electron Desktop is included in macOS, Linux, and Windows release bundles and
  installed with the `luma-desktop` launcher.
- A Providers settings page shows each provider's key status, saves or removes
  API keys, tests connections, and manages custom endpoints.

#### Teammates

- Each Teammate has one ongoing main conversation. Long conversations are
  summarized, and core memory is loaded into every task.
- You can send a message to steer a Teammate while it works.
- Teammates can message you, with desktop notifications, per-Teammate mute, and
  quiet hours. Teammates show live presence and unread replies.
- Teammates can message each other, and groups of two to six can share one
  conversation with @mentions and visible handoffs.
- Teammates can schedule work from chat, including recurring calendar
  schedules. Routine results arrive in the main conversation.
- One lead Teammate can check in on weekdays. This is off by default.
- Each Teammate has a browser that keeps its sign-ins in its own runs, and that
  you can take over.
- New Teammates start with a name and a face, then ask about their job in
  conversation.
- Interactive Rich Responses support action buttons, choice panels, and forms
  that continue a Teammate conversation with the submitted input.
- Teammates can discover and load workspace or user routines, and learn
  workflows into reviewable Markdown drafts with a redacted task-action
  reference. Drafts require review before installation or reuse.

#### Agent and extensions

- Auto mode (`/auto`) lets a session run shell commands judged safe without
  asking. Destructive commands still need approval. Auto mode is a convenience
  filter, not a sandbox.
- Questions from the agent can offer choices or accept a typed answer, in both
  the Desktop app and the terminal client.
- The MCP Store lets you browse, search, install, and remove MCP servers from
  the Desktop app or with `luma mcp catalog|search|info|install`. Installing a
  server does not enable it. OAuth-only servers are listed but cannot be
  installed yet.

### Improved

- The terminal client's interface, including the Teammates manager, has been
  reworked.
- The Desktop app has a more polished interface, clearer error handling and
  tool activity, and a simpler Teammates view. Pending approvals appear in the
  Teammate chat.
- Teammate mascots are redesigned, with animations that show current activity.
- Teammates that share a folder can chat and read in parallel. A workspace is
  leased only when a Teammate may change files.
- The Desktop app receives runtime updates as they happen, with slower polling
  kept as a fallback.
- You can save provider keys and endpoints without changing the default model,
  and model errors can offer another model.
- Installers verify and install the Desktop application, expose the
  `luma-desktop` command, and remove its launcher during uninstall.
- Release packaging verifies the Electron renderer, native `node-pty` module,
  and bundled Luma Core before producing platform archives.
- Installation and Teammates documentation cover the expanded runtime.

### Fixed

- `/plan` requests can no longer edit files or run tools that are not
  read-only.
- The MCP and plugin requests sent by clients now receive a response.
- A stopped dashboard can be started again.
- The Teammate browser no longer crashes when a connection is reset.

### Security

- Dashboard workspace paths reject symlinks that escape the workspace.
- Likely credentials are redacted from tool output and errors before they are
  saved.
- Text written by Teammates does not gain your authority, and permission-capped
  runs cannot create monitors that run with full permissions.

### Release status

- This remains a beta prerelease. Platform packaging and installation should
  be exercised on each supported operating system before stable 1.0.
- No exactly-once guarantee is made for actions against external services.

## [1.0.0-beta.1] - 2026-11-18

First 1.0 beta release for hands-on evaluation of the unified Code and
Teammates experience.

### Added

- Rust Core shared by the Ink terminal client, local dashboard, and Electron
  desktop workspace.
- Persistent Teammates with memory, schedules, task delegation, specialist
  roles, and cross-agent Inbox.
- Durable SQLite task/action journals, restart recovery, explicit uncertain
  action reconciliation, and approval-aware execution plans.
- GitHub issue, pull request, review, and Actions integrations.
- Approval-gated Playwright browser automation with bounded network access.
- Agent Skills, native plugins, MCP integrations, and operational scorecards.
- Workspace inspection/editing, command execution, and review/approval gates.

### Release status

- This is a beta prerelease, not a stable 1.0 promise. Expect rough edges and
  breaking changes while installation, packaging, and cross-platform behavior
  are exercised.
- The GitHub release workflow currently publishes the Rust Core artifacts.
  Build the Ink client and desktop app from source using the README instructions;
  packaged desktop installers are not part of this release yet.
- No exactly-once guarantee is made for actions against external services.
