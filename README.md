# Luma

**A lightweight AI coding agent and persistent teammate runtime, built in Rust.**

Luma helps developers explore codebases, make reviewed changes, run commands,
and delegate ongoing work to persistent Teammates. It supports OpenAI-compatible
model endpoints, local model servers, a terminal interface, and a desktop
workspace.

## Quick start

The installer provisions Luma Core, the Ink client, embedded browser
dashboard, Electron Desktop app, pinned Bun and Node.js runtimes, Playwright
with Chromium, ripgrep, and the built-in Agent Skills. It installs Luma Desktop
as an application and asks for your name, model provider, and default workspace.
Open Luma from Spotlight or Launchpad, your Linux application launcher, or the
Windows Start menu.

```sh
curl -fsSL https://raw.githubusercontent.com/TheLumaTeam/luma/main/scripts/install.sh | bash
luma
```

On Windows, run this from PowerShell:

```powershell
irm https://raw.githubusercontent.com/TheLumaTeam/luma/main/scripts/install.ps1 | iex
```

The installer supports macOS and glibc Linux on x64/ARM64, plus Windows x64.
Debian/Ubuntu browser system libraries are installed automatically and may
prompt for `sudo`; other Linux distributions need their Chromium shared
libraries installed with their package manager. Git is installed when missing
on Debian or Ubuntu; macOS requires the Xcode Command Line Tools, and Windows
uses `winget` to install Git for Windows when needed.

Afterwards, `luma update` installs newer releases and `luma doctor` checks the
installation (`luma doctor --repair` reinstalls it if something is broken).

Wherever you run the script from, it installs the most recently published
release, including prereleases. To install a specific release:

```sh
curl -fsSL https://raw.githubusercontent.com/TheLumaTeam/luma/main/scripts/install.sh | LUMA_VERSION=v1.0.0-beta.3 bash
```

To remove the program and its bundled runtimes without deleting user
configuration, memories, tasks, skills, or browser caches, run:

```sh
curl -fsSL https://raw.githubusercontent.com/TheLumaTeam/luma/main/scripts/install.sh | bash -s -- --uninstall
```

On Windows, set `$env:LUMA_VERSION` before running the command above to choose a
release. To uninstall, use **Installed apps**, or run the saved PowerShell
installer with `-Uninstall`.

The platform release bundle includes the complete Electron Desktop app and
its native dependencies alongside the Core, terminal, dashboard, and
browser-automation runtime.

## What Luma includes

- Rust agent runtime with iterative tool use and streaming responses.
- Workspace inspection, code search, file editing, and command execution.
- Review and approval gates for changes and external actions.
- Desktop and terminal clients, plus a local dashboard.
- Persistent Teammates with conversation history, memory, schedules, and
  delegated work.
- Durable task-action journals, crash recovery, reconciled retries, and
  persisted approval-aware plans.
- A cross-agent Inbox, specialist role presets, and operational model/reliability
  scorecards.
- Teammate-only GitHub issue, pull request, review, and Actions tools, plus
  approval-gated Playwright browser automation.
- Agent Skills, native plugins, and Model Context Protocol (MCP) integrations.

## Documentation

- [Architecture and runtime](docs/architecture.md)
- [Installation and runtime dependencies](docs/installation.md)
- [CLI and terminal interface](docs/cli.md)
- [Tools and change approval](docs/tools.md)
- [Configuration and models](docs/configuration.md)
- [Agent Skills](docs/skills.md)
- [Persistent Teammates](docs/teammates.md)
- [Native plugins](docs/plugins.md)
- [MCP integrations](docs/mcp.md)

## Development

```sh
cargo test --all-features
cargo clippy --all-targets --all-features -- -D warnings
```

The UI checks are `bun run typecheck` in `ui`, `npm run typecheck && npm run
build` in `dashboard`, and `npm run typecheck && npm run lint` in `desktop`.

Luma is licensed under MIT. Its name comes from the star-like creatures in
*Super Mario Galaxy*.
