# Desktop Application Install Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Install Luma Desktop as a normal application, configured by the installed Core, from the latest release unless a version is specified.

**Architecture:** Core owns installation detection and `install.json`. The install scripts call Core for setup, then register the app with the OS. Desktop reads `install.json` to find Core and its first-run defaults.

**Tech Stack:** Rust 2024, Electron (TypeScript), bash, PowerShell, Python.

**Spec:** `docs/superpowers/specs/2026-11-28-desktop-app-install-design.md`

## Global Constraints

- No commits unless the user asks.
- No change to `Config` or the wire protocol.
- Set variables win over detected ones; `PATH` is extended.
- `set_var` runs before the Tokio runtime is built.
- Never `--no-sandbox`. Anything needing root goes back to the user.
- Bundle component marker: `installer-setup`. macOS bundle id: `com.thelumateam.luma`. Windows AppUserModelID: the same string.

## Review Focus

- `curl | bash` with no usable `/dev/tty` (CI): install completes, setup skipped.
- A release without `installer-setup`: app installs, setup and record skipped.
- A foreign `~/Applications/Luma.app`: installer stops without touching it.
- Corrupt `install.json`: Core and Desktop ignore it and still start.
- Paths with spaces in `HOME` or `LUMA_HOME`: wrappers, shortcut, and `.desktop` entry still work.

## Tasks

### Task 1: Core installation detection and record

**Files:** create `src/install.rs`; modify `src/lib.rs`, `src/main.rs`, `src/config/mod.rs`, `src/config/setup.rs`.

**Produces:**
- `InstallRecord { luma_home, browsers_path, user_name, default_workspace: Option<String> }`
- `read_record(path) -> InstallRecord` (default on missing or corrupt)
- `update_record(path, changes: InstallRecord) -> Result<()>` (keeps unset values)
- `detect_home(exe: &Path) -> Option<PathBuf>`
- `environment(home, record, lookup: impl Fn(&str) -> Option<OsString>) -> Vec<(&str, OsString)>`
- CLI: `luma-core setup`, `luma-core install-record <luma_home> <browsers_path>`
- `config::save` writes mode 0600 on Unix.

- [ ] Failing tests in `src/install.rs`: detection needs `bin/`, `bundle.json`, `runtime/`; set variables win; `PATH` keeps old entries; corrupt record reads as default; update keeps unset values.
- [ ] Run `cargo test --locked --all-features install`, see failures.
- [ ] Implement; `main` becomes synchronous, applies the environment, then builds the runtime.
- [ ] `setup`: asks name and workspace; offers to keep an existing config (default yes).
- [ ] Tests pass.

### Task 2: Bundle contents

**Files:** modify `scripts/package-bundle.py`, `desktop/forge.config.ts`.

**Produces:** `bundle.json` components include `installer-setup`; Linux bundles carry `share/luma.png`; `packagerConfig.appBundleId`.

- [ ] Implement, then package locally and check `CFBundleIdentifier` and `codesign --verify --deep`. Re-sign ad hoc in `postPackage` on macOS if it fails.

### Task 3: `install.sh`

**Files:** modify `scripts/install.sh`, `scripts/test-install.sh`.

**Consumes:** Task 1 CLI, Task 2 marker and icon.

- [ ] Failing tests in `test-install.sh`: latest release chosen by `published_at`, drafts skipped; `LUMA_VERSION` wins without an API call; app lands in `~/Applications`; old `$LUMA_HOME/desktop/Luma.app` removed; foreign app stops the install; no marker skips setup; `LUMA_SKIP_SETUP=1`; record called; uninstall removes app and `install.json`; Linux run writes `.desktop` entry and icon, and uninstall removes them.
- [ ] Implement: release selection with `awk` over the API JSON; setup from the extracted bundle with `</dev/tty`; refuse if Desktop is running; `gateway stop` before replacing; registration; uninstall.
- [ ] `bash -n`, `shellcheck`, test passes.

### Task 4: `install.ps1`

**Files:** modify `scripts/install.ps1`.

- [ ] `-Version`, then `LUMA_VERSION`, then latest by `published_at`; setup and record behind the marker; running-app check; `gateway stop`; Start menu shortcut with AppUserModelID; `HKCU` Uninstall key running a saved `uninstall.ps1`; uninstall removes all of it.
- [ ] Syntax check if PowerShell is available; otherwise report it as unverified.

### Task 5: Desktop

**Files:** create `desktop/src/installRecord.ts`; modify `desktop/src/main.ts`, `preload.ts`, `renderer.d.ts`, `renderer.tsx`, `stores/profileStore.ts`.

**Consumes:** `install.json` keys from Task 1.

- [ ] Core order: `LUMA_BINARY`, `custom`/`path`, installed Core (packaged only), bundled. Default workspace for a packaged app: saved, `default_workspace`, home. Profile name falls back to `user_name`. `setAppUserModelId` on Windows.
- [ ] `npm run typecheck && npm run lint`; package; run the packaged app against a temporary install.

### Task 6: Docs

- [ ] Update `README.md`, `docs/installation.md`, and add a changelog entry under `## [Unreleased]`.
- [ ] Run all CI commands.
