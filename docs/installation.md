# Installation

Luma's installer creates a self-contained user installation for the Rust Core,
Ink terminal client, embedded dashboard, Electron Desktop app, and browser
automation runtime. It does not require Rust, Bun, Node.js, or a project
checkout to be present first.

## macOS and Linux

```sh
curl -fsSL https://raw.githubusercontent.com/TheLumaTeam/luma/main/scripts/install.sh | bash
```

The installer detects the current architecture, downloads the matching Luma
bundle, verifies its SHA-256 checksum, and installs under
`~/.local/share/luma`. The `luma` and `luma-core` commands are placed in
`~/.local/bin`; the installer adds that directory to `~/.zprofile` for zsh,
`~/.bash_profile` for macOS Bash, or `~/.profile` otherwise. Open a new terminal
after installation.

Luma Desktop is installed as an application. On macOS it is
`~/Applications/Luma.app`, available from Spotlight and Launchpad. On Linux the
installer adds a launcher entry and icon under `~/.local/share` (or
`XDG_DATA_HOME`). The `luma-desktop` command still works.

It also installs pinned Node.js, Bun, Playwright, Chromium, and a platform
build of ripgrep. On Debian/Ubuntu, it installs Chromium's system libraries
and Git when missing. On macOS, Git must be available through the Xcode
Command Line Tools. Other Linux distributions need Git and Chromium's shared
libraries installed by their system package manager before browser automation
can run.

Supported shell targets:

- `aarch64-apple-darwin`
- `x86_64-apple-darwin`
- `aarch64-unknown-linux-gnu`
- `x86_64-unknown-linux-gnu`

## Windows

Run in PowerShell:

```powershell
irm https://raw.githubusercontent.com/TheLumaTeam/luma/main/scripts/install.ps1 | iex
```

Windows x64 is supported. Luma Desktop is added to the Start menu and to
**Installed apps**; `luma-desktop` also works. The installer uses `winget` to
install Git for Windows if it is not already available. Open a new terminal
afterwards so the user PATH update takes effect.

## Setup during installation

Before the large downloads, the installer asks for:

- your name;
- the model provider, endpoint, API key if needed, and model, then tests the
  connection;
- the default workspace folder for Luma Desktop (your home folder by default).

If model settings already exist, it offers to keep them. Setup is skipped when
there is no terminal or when `LUMA_SKIP_SETUP=1` is set. If it is skipped,
cancelled, or fails, installation continues and Luma Desktop shows its setup
wizard when no model settings exist. To run it later, use
`~/.local/share/luma/bin/luma-core setup`, or
`%LOCALAPPDATA%\Luma\bin\luma-core.exe setup` on Windows.

API keys are stored as plain text in `config.toml`. On macOS and Linux only your
user account can read the file.

## How Luma Desktop finds Core

Core writes `install.json` in the Luma configuration directory. An installed
Desktop app uses it to find the installed Core, and Core then finds its own
Node.js, Playwright, and ripgrep, however it was started. `LUMA_BINARY` and a
custom core chosen in Settings take priority.

## Installed layout

```text
~/.local/share/luma/
├── bin/luma-core
├── lib/luma-cli.js
├── desktop/                # Linux and Windows; on macOS the app is in ~/Applications
├── runtime/
│   ├── node/
│   └── node_modules/       # Bun, Playwright, and platform ripgrep
├── bundle.json
└── LICENSE
```

The dashboard's production assets are embedded in `luma-core`. Playwright's
Chromium download is stored in `~/.cache/ms-playwright` on macOS/Linux and in
`%LOCALAPPDATA%\ms-playwright` on Windows. The installer copies the bundled
`ask-question` skill into the user's Luma skills directory without replacing
an existing copy.

## If an install fails

Downloads are retried. Nothing in an existing installation changes until the
new release and its tools have downloaded. While replacing files, the installer
sets the old ones aside. If a step fails or you interrupt it, it restores the
previous installation and restarts the gateway if it was running. If the
installer is force-killed or the computer shuts down, run it again: it restores
the previous installation before doing anything else.

Answers given during setup are kept even if the installation then fails.

## Code signing

On macOS, the installer signs the installed app and Core ad hoc, and restores
the previous installation if signing fails. Releases up to 1.0.0-beta.2
packaged the app in a form that cannot be re-signed, so only their Core is
signed. Luma is not notarized. Windows and
Linux files are not signed.

## Checks before installing

- **Disk space.** The installer stops, before downloading, if the temporary or
  installation drive has less than 2,500 MB free. `LUMA_SKIP_PREFLIGHT=1`
  skips this check.
- **Linux.** It warns when Luma Desktop is missing system libraries, or when
  AppArmor restricts the sandbox that the app needs. It changes neither.
- **Build provenance.** With the GitHub CLI (`gh`) installed and signed in, it
  checks that Luma's release workflow built the download, and warns if that
  cannot be verified. Set `LUMA_REQUIRE_ATTESTATION=1` to stop unless it is
  verified. Releases published before attestations existed cannot pass.

## Updating and repairing

```sh
luma update --check             # is there a newer release?
luma update                     # install the latest release
luma update --release 1.2.3     # install a particular release
luma doctor                     # check the installation
luma doctor --repair            # reinstall this release if a check fails
```

These run the current installer from the `main` branch, keeping your install
location and settings. Quit Luma Desktop first. On Windows, the installer
continues in a new PowerShell window. Installing a release that predates these
commands removes them; run the installer again to get them back.

## Updating and uninstalling

Quit Luma Desktop, then run the installer again to update. Wherever the script
comes from, it installs the most recently published release, including
prereleases. Set `LUMA_VERSION=vX.Y.Z` to pin a release (`install.ps1` also
accepts `-Version`). Releases published before installer setup existed are
installed without it. Existing user configuration and installed skills are
preserved.

```sh
curl -fsSL https://raw.githubusercontent.com/TheLumaTeam/luma/main/scripts/install.sh | bash -s -- --uninstall
```

On Windows, uninstall from **Installed apps**, or save `install.ps1` and run it
with `-Uninstall`. Uninstall removes the program, its application entries, and
its private runtimes but deliberately preserves user data.

The platform bundle includes the complete Electron application and its native
dependencies. Linux desktop environments must provide the system libraries
required by Electron (commonly GTK, NSS, and audio libraries); the installer
does not attempt to modify a non-Debian system package manager.
