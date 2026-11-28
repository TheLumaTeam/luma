# Install Luma Desktop as an application

## Intent

After running the installer, Luma Desktop is a normal application on macOS,
Linux, and Windows. It opens ready to use: the installer asks for everything
Luma needs, and the app uses the installed Luma Core and its tools.

The reason for the change was not stated; none is assumed here.

## Goals

- Luma appears in Spotlight and Launchpad (macOS), the application launcher
  (Linux), and the Start menu and Installed apps (Windows).
- The installer collects the settings needed to start working.
- Desktop, the `luma` command, and the gateway use one installed Core and one
  set of tools, however they are started.
- Uninstall removes everything the installer registered.

## Non-goals

- Native installers (`.dmg`, `Setup.exe`, `.deb`, `.rpm`), code signing,
  notarization, and auto-update.
- Windows ARM64.
- Removing the Desktop setup wizard. It stays as the fallback.

## Anti-goals

- The app appears in the launcher but fails to open.
- An install fails, or hangs, because a setup question could not be answered.
- Re-running the installer overwrites existing settings without asking.

## Approaches

| Decision | Options | Choice |
|---|---|---|
| Registration | A1: extend the install scripts. A2: native installers, which still need a runtime setup step, add release work, and may be blocked while unsigned. | A1 |
| Configuration | B1: Core configures itself. B2: Desktop sets the tool paths, duplicating both terminal launchers. | B1 |

## Setup questions

| Question | Default | Saved in |
|---|---|---|
| Your name | system user name | `install.json` |
| Provider | none | `config.toml` |
| Endpoint | the provider's default | `config.toml` |
| API key (if needed) | offer a matching environment variable | `config.toml` |
| Model | chosen from the discovered list or typed | `config.toml` |
| Default workspace folder | home directory | `install.json` |

The list is what the Desktop wizard and the Core setup ask today, plus the
workspace folder. The install location is not asked; `LUMA_HOME` and
`LUMA_BIN_DIR` keep working as overrides.

- Add `luma-core setup`. It reuses `config::setup::run()` and adds the name and
  workspace questions. The existing connection test and "save anyway" prompt
  stay.
- The installer runs it right after the bundle is verified and extracted,
  before the slow runtime downloads, so the questions come early.
- With `curl ... | bash`, standard input is the script, so the installer runs
  setup with input from `/dev/tty`.
- With no terminal, or with `LUMA_SKIP_SETUP=1`, setup is skipped and the
  installer says how to run it later.
- If `config.toml` exists, setup offers to keep it (default yes) and still asks
  for any missing `install.json` value.
- If setup is cancelled or fails, installation continues. Desktop then shows
  its wizard.

## Which release is installed

- Wherever the script came from (a branch, a checkout, or a release asset), it
  installs the latest release unless a version is specified.
- "Latest" is the most recently published release that is not a draft,
  pre-releases included. GitHub's `/releases/latest` is not used because it
  skips pre-releases. The installer compares publication times instead of
  trusting the order of the list.
- A version is specified with `LUMA_VERSION` on both scripts, or `-Version` on
  `install.ps1`, which takes precedence.
- A script can be newer than the release it installs. A release that supports
  the new setup lists `installer-setup` in the `components` of `bundle.json`.
  Without it, the installer still installs and registers the app, skips setup
  and the install record, and says so. A missing Linux icon is not an error.

## Core configures itself

`install.json` lives in the Luma config directory and holds `luma_home`,
`browsers_path`, `user_name`, and `default_workspace`. It is a separate file so
that the wire protocol and `Config` do not change.

Only Core writes this file, so the two install scripts need no JSON code. The
installer always calls a non-interactive Core command to record `luma_home` and
`browsers_path`, even when setup is skipped; setup adds the other two values.
Each write keeps the values it does not set. Core reads `browsers_path` from
this file, so a custom browser location also applies to GUI launches.

At startup, before any threads exist (`set_var` is unsafe in edition 2024, so
this runs before the Tokio runtime is built), Core checks whether its own
executable is in `<home>/bin` beside `<home>/bundle.json` and
`<home>/runtime`. If so, it sets `LUMA_HOME`, `LUMA_NODE_BIN`,
`LUMA_PLAYWRIGHT_MODULE`, `PLAYWRIGHT_BROWSERS_PATH`, and `LUMA_VERSION`, and
adds the bundled Node, ripgrep, and (on Windows) Git folders to `PATH`.
Variables that are already set win, except that `PATH` is extended. Outside an
installation nothing changes.

## Desktop

- Core is chosen in this order: `LUMA_BINARY`; the user's `custom` or `path`
  setting; for a packaged app, the installed Core named by `install.json`, then
  `<default LUMA_HOME>/bin`; otherwise the current bundled or local build.
- The default setting is shown as the installed Core when one is in use.
- Without a saved workspace or `LUMA_WORKSPACE`, a packaged app uses
  `default_workspace`, then the home directory. It never defaults to the
  launch directory.
- Without a saved profile name, the app uses `user_name`.

## Registration

| | macOS | Linux | Windows |
|---|---|---|---|
| App files | `~/Applications/Luma.app` | `$LUMA_HOME/desktop` | `%LOCALAPPDATA%\Luma\desktop` |
| Registered by | the bundle's location | `~/.local/share/applications/luma.desktop` and a hicolor icon | Start menu shortcut and a per-user `Uninstall` registry key |
| `luma-desktop` | opens the app | kept | kept |
| Uninstall | removes the app | removes the entry and icon | removes the shortcut and key; also runnable from Installed apps |

- Linux paths honor `XDG_DATA_HOME`.
- The release bundle gains the Linux icon.
- Windows keeps a local copy of the uninstall script, and sets the same
  application ID on the shortcut and in the app so notifications work.
- The installer only replaces or removes a `Luma.app` that has Luma's bundle
  identifier. If it finds a different app at that path, it stops. It sets that
  identifier in the Forge config, because the packaged app currently reports
  `com.github.Electron`.
- Upgrading from an older install removes the old `$LUMA_HOME/desktop/Luma.app`.
- Installing while Luma Desktop is running asks the user to quit it first.
- Before replacing or removing files, the installer stops a running gateway so
  the old Core does not keep serving the new clients.

## Risks to settle during the build

- **macOS signature.** A locally packaged app fails `codesign --verify`. A
  `curl` download carries no quarantine flag, but launch from Finder must be
  tested. An ad-hoc re-sign during packaging is the expected fix.
- **Linux sandbox.** Some distributions, including recent Ubuntu, restrict the
  sandbox an unpacked Electron app relies on, so a launcher click could do
  nothing. Test on Ubuntu 24.04. Do not fix it with `--no-sandbox`; if it needs
  root (an AppArmor profile), come back for a decision.
- **API key storage.** Keys stay in plain text in `config.toml`, as today. On
  macOS and Linux, setup should make the file readable only by its owner.

## Testing

- Rust tests for installation detection and variable precedence.
- Extend `scripts/test-install.sh` to cover registration, skipped setup,
  re-install over existing settings, and uninstall, in a temporary `HOME`.
- A syntax check for `install.ps1`, as today.
- Manual: launch from the system launcher on each platform. Only macOS can be
  tested locally; Windows and Linux need real machines or VMs.

## Docs

Update `docs/installation.md` and `README.md`, and add a changelog entry.

## Left to the builder

Internal function layout, prompt wording, and the exact registry values.
