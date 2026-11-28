#!/usr/bin/env bash
set -Eeuo pipefail

readonly REPOSITORY="TheLumaTeam/luma"
readonly NODE_VERSION="22.23.5"
readonly BUN_VERSION="1.4.4"
readonly PLAYWRIGHT_VERSION="1.65.0"
readonly RIPGREP_VERSION="1.18.0"
readonly API="https://api.github.com/repos/${REPOSITORY}"

LUMA_HOME="${LUMA_HOME:-${HOME}/.local/share/luma}"
BIN_DIR="${LUMA_BIN_DIR:-${HOME}/.local/bin}"
VERSION="${LUMA_VERSION:-}"
MAC_APP="${HOME:-}/Applications/Luma.app"
DATA_HOME="${XDG_DATA_HOME:-${HOME:-}/.local/share}"
LAUNCHER_ENTRY="${DATA_HOME}/applications/luma.desktop"
LAUNCHER_ICON="${DATA_HOME}/icons/hicolor/512x512/apps/luma.png"
# Setup reads its answers here: with `curl ... | bash`, stdin is this script.
TTY="${LUMA_INSTALLER_TTY:-/dev/tty}"
PENDING="${LUMA_HOME}/.install-pending"
readonly BACKUP_SUFFIX=".luma-previous"
replacing=false
gateway_was_running=false
TMP_DIR=""

fail() { printf 'Luma installer: %s\n' "$*" >&2; exit 1; }
log() { printf '\n==> %s\n' "$*"; }
download() { curl --fail --location --silent --show-error --proto '=https' --tlsv1.2 --retry 3 --retry-delay 2 "$1" --output "$2"; }

verify_sha256() {
  local file="$1" expected="$2" actual
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$file" | awk '{print $1}')"
  else
    actual="$(shasum -a 256 "$file" | awk '{print $1}')"
  fi
  [[ "$actual" == "$expected" ]] || fail "SHA-256 verification failed for $(basename "$file")."
}

resolve_target() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"
  case "${os}/${arch}" in
    Darwin/arm64|Darwin/aarch64) TARGET="aarch64-apple-darwin" ;;
    Darwin/x86_64) TARGET="x86_64-apple-darwin" ;;
    Linux/x86_64|Linux/amd64) TARGET="x86_64-unknown-linux-gnu" ;;
    Linux/aarch64|Linux/arm64) TARGET="aarch64-unknown-linux-gnu" ;;
    *) fail "unsupported platform: ${os}/${arch}. Supported: macOS and glibc Linux on x64/ARM64." ;;
  esac
}

install_node() {
  local runtime="$1" archive checksums expected extract_dir
  archive="node-v${NODE_VERSION}-${NODE_PLATFORM}.tar.xz"
  checksums="${TMP_DIR}/SHASUMS256.txt"
  log "Installing Node.js ${NODE_VERSION} (required by browser automation)"
  download "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" "$checksums"
  expected="$(awk -v name="$archive" '$2 == name || $2 == "*" name { print $1; exit }' "$checksums")"
  [[ -n "$expected" ]] || fail "Node.js checksum not found for ${archive}."
  download "https://nodejs.org/dist/v${NODE_VERSION}/${archive}" "${TMP_DIR}/${archive}"
  verify_sha256 "${TMP_DIR}/${archive}" "$expected"
  extract_dir="${TMP_DIR}/node-extract"
  mkdir -p "$extract_dir"
  tar -xJf "${TMP_DIR}/${archive}" -C "$extract_dir"
  rm -rf "$runtime/node"
  mv "$extract_dir/node-v${NODE_VERSION}-${NODE_PLATFORM}" "$runtime/node"
}

install_path_hint() {
  local profile marker shell_name
  shell_name="$(basename "${SHELL:-}")"
  case "$shell_name/$(uname -s)" in
    zsh/*) profile="${HOME}/.zprofile" ;;
    bash/Darwin) profile="${HOME}/.bash_profile" ;;
    *) profile="${HOME}/.profile" ;;
  esac
  marker="# >>> Luma PATH >>>"
  if [[ ! -f "$profile" ]] || ! awk -v marker="$marker" 'index($0, marker) { found=1 } END { exit !found }' "$profile"; then
    {
      printf '\n%s\n' "$marker"
      printf 'export LUMA_HOME=%q\n' "$LUMA_HOME"
      # shellcheck disable=SC2016
      printf 'case ":$PATH:" in *":%s:"*) ;; *) export PATH="%s:$PATH" ;; esac\n' "$BIN_DIR" "$BIN_DIR"
      printf '%s\n' '# <<< Luma PATH <<<'
    } >> "$profile"
  fi
}

[[ -n "${HOME:-}" ]] || fail 'HOME is not set.'
[[ "$LUMA_HOME" != "$HOME" && "$LUMA_HOME" != "/" ]] || fail 'LUMA_HOME must be a dedicated directory, not HOME or the filesystem root.'
case "$LUMA_HOME" in */luma|*/Luma) ;; *) fail 'LUMA_HOME must be a dedicated directory ending in luma.' ;; esac

config_directory() {
  if [[ "$(uname -s)" == "Darwin" ]]; then
    printf '%s\n' "${HOME}/Library/Application Support/luma"
  else
    printf '%s\n' "${XDG_CONFIG_HOME:-${HOME}/.config}/luma"
  fi
}

# Whether the application at the macOS path is ours to replace or remove.
# Releases up to 1.0.0-beta.2 kept Electron's identifier but bundle Core.
is_luma_app() {
  grep -aqF '<string>com.thelumateam.luma</string>' "$1/Contents/Info.plist" 2>/dev/null \
    || [[ -f "$1/Contents/Resources/luma-core" ]]
}

require_desktop_closed() {
  local executable
  if [[ "$(uname -s)" == "Darwin" ]]; then
    executable="$MAC_APP/Contents/MacOS/Luma"
  else
    executable="$LUMA_HOME/desktop/Luma"
  fi
  if ps -A -o args= | executable="$executable" awk 'index($0, ENVIRON["executable"]) == 1 { found=1 } END { exit !found }'; then
    fail 'Luma Desktop is running. Quit it, then run this installer again.'
  fi
}

# An old gateway would keep running the old Core.
stop_gateway() {
  if [[ -x "$LUMA_HOME/bin/luma-core" ]]; then
    "$LUMA_HOME/bin/luma-core" gateway stop >/dev/null 2>&1 || true
  fi
}

# The most recently published release, pre-releases included. GitHub's
# /releases/latest skips pre-releases, and the list is not in publication order.
latest_release() {
  curl --fail --location --silent --show-error --proto '=https' --tlsv1.2 --retry 3 --retry-delay 2 \
    -H 'Accept: application/vnd.github+json' "$API/releases?per_page=30" \
    | { grep -oE '"(tag_name|draft|published_at)": *("[^"]*"|true|false|null)' || true; } \
    | awk -F'"' '
      $2 == "tag_name" { tag = $4; draft = 0 }
      $2 == "draft" { draft = ($0 ~ /true$/) }
      $2 == "published_at" && !draft && $4 > newest { newest = $4; latest = tag }
      END { print latest }
    '
}

# --- Failure recovery ---
# Installed items are renamed aside, not deleted, until the new installation is
# complete. The pending file lists them, so even a later run can restore them.

# Every file or directory that installing replaces.
managed_paths() {
  local name
  for name in bin lib runtime desktop share bundle.json LICENSE; do
    printf '%s\n' "$LUMA_HOME/$name"
  done
  for name in luma luma-core luma-desktop; do
    printf '%s\n' "$BIN_DIR/$name"
  done
  if [[ "$(uname -s)" == "Darwin" ]]; then
    printf '%s\n' "$MAC_APP"
  else
    printf '%s\n' "$LAUNCHER_ENTRY" "$LAUNCHER_ICON"
  fi
}

path_exists() { [[ -e "$1" || -L "$1" ]]; }

discard_backups() {
  local path
  while IFS= read -r path; do
    rm -rf "${path:?}$BACKUP_SUFFIX"
  done < <(managed_paths)
}

begin_replacement() {
  local path
  mkdir -p "$LUMA_HOME" "$BIN_DIR"
  discard_backups
  while IFS= read -r path; do
    if path_exists "$path"; then printf 'kept\t%s\n' "$path"; else printf 'new\t%s\n' "$path"; fi
  done < <(managed_paths) > "$PENDING.tmp"
  # The list is complete before anything moves.
  mv "$PENDING.tmp" "$PENDING"
  while IFS= read -r path; do
    if path_exists "$path"; then mv "$path" "$path$BACKUP_SUFFIX"; fi
  done < <(managed_paths)
}

# Safe to repeat: a kept item without a backup was never moved or is restored.
roll_back() {
  [[ -f "$PENDING" ]] || return 0
  local state path failed=false
  while IFS=$'\t' read -r state path; do
    if [[ "$state" == new ]]; then
      rm -rf "${path:?}" || failed=true
    elif path_exists "$path$BACKUP_SUFFIX"; then
      { rm -rf "${path:?}" && mv "$path$BACKUP_SUFFIX" "$path"; } || failed=true
    fi
  done < "$PENDING"
  if [[ "$failed" == true ]]; then return 1; fi
  rm -f "$PENDING"
  # Remove the directory a failed first install created.
  rmdir "$LUMA_HOME" 2>/dev/null || true
}

commit_replacement() {
  # Removing the list is the point of no return.
  rm -f "$PENDING"
  replacing=false
  discard_backups
}

recover_interrupted_install() {
  [[ -f "$PENDING" ]] || return 0
  log "An earlier install was interrupted; restoring the previous installation"
  roll_back || fail "could not restore it. Fix the errors above, then run this installer again."
}

on_exit() {
  local status=$?
  # A second interrupt must not stop the restore.
  trap '' INT TERM HUP
  set +e
  if [[ "$replacing" == true ]]; then
    printf '\nLuma installer: installation failed; restoring the previous installation.\n' >&2
    if roll_back; then
      printf 'Restored. Fix the problem above, then run this installer again.\n' >&2
      if [[ "$gateway_was_running" == true ]]; then
        "$LUMA_HOME/bin/luma-core" gateway start >/dev/null 2>&1 \
          || printf 'Start the gateway again with: luma gateway start\n' >&2
      fi
    else
      printf 'Restoring did not finish. Run this installer again to retry.\n' >&2
    fi
  fi
  if [[ -n "$TMP_DIR" ]]; then rm -rf "$TMP_DIR"; fi
  exit "$status"
}

# --- Checks ---

# Download, unpacked bundle, runtimes and Chromium, with some headroom.
readonly REQUIRED_FREE_MB=2500

check_disk_space() { # directory, which may not exist yet
  local directory="$1" free_kb
  while [[ ! -d "$directory" ]]; do directory="$(dirname "$directory")"; done
  free_kb="$(df -Pk "$directory" | awk 'NR == 2 { print $4 }')"
  [[ "$free_kb" =~ ^[0-9]+$ ]] || return 0
  if (( free_kb < REQUIRED_FREE_MB * 1024 )); then
    fail "not enough free space for ${directory}: $(( free_kb / 1024 )) MB available, ${REQUIRED_FREE_MB} MB needed. Free some space, or set LUMA_SKIP_PREFLIGHT=1."
  fi
}

# Warns about problems that would stop the desktop app from opening.
check_linux_desktop() { # app-directory
  local missing userns="${LUMA_APPARMOR_USERNS_FILE:-/proc/sys/kernel/apparmor_restrict_unprivileged_userns}"
  if command -v ldd >/dev/null 2>&1; then
    missing="$({ ldd "$1/Luma" 2>/dev/null || true; } | awk '/not found/ { print $1 }' | tr '\n' ' ')"
    if [[ -n "$missing" ]]; then
      printf 'Warning: Luma Desktop is missing system libraries: %s\nInstall them with your package manager.\n' "$missing" >&2
    fi
  fi
  if [[ -r "$userns" && "$(cat "$userns")" == 1 ]]; then
    printf '%s\n' 'Warning: this system uses AppArmor to restrict the sandbox that Luma Desktop needs.' \
      'If Luma does not open from the launcher, run luma-desktop in a terminal to see why.' >&2
  fi
}

# Checks that the release workflow built the file. Checksums come from the same
# release as the bundle, so they cannot show this. Releases built before
# attestations existed fail the check, so only LUMA_REQUIRE_ATTESTATION=1
# makes a failure fatal.
verify_provenance() { # file
  local problem
  if ! command -v gh >/dev/null 2>&1 || ! gh auth status >/dev/null 2>&1; then
    problem='the GitHub CLI (gh) is not installed and signed in'
  elif gh attestation verify "$1" --repo "$REPOSITORY" \
    --signer-workflow "$REPOSITORY/.github/workflows/release.yml" >/dev/null 2>&1; then
    log "Verified build provenance"
    return
  else
    problem='its build provenance could not be verified'
    if [[ "${LUMA_REQUIRE_ATTESTATION:-}" != 1 ]]; then
      printf 'Warning: the download matches its checksum, but %s.\n' "$problem" >&2
    fi
  fi
  if [[ "${LUMA_REQUIRE_ATTESTATION:-}" == 1 ]]; then
    fail "LUMA_REQUIRE_ATTESTATION=1, but $problem."
  fi
}

# Luma has no Apple Developer ID, so its executables are signed ad hoc on the
# machine that runs them. Node.js, Bun and ripgrep keep their publishers'
# signatures. Core is signed first: signing the app seals what is inside it.
sign_macos_executables() { # whether the release kept the app's links
  local bundled="$MAC_APP/Contents/Resources/luma-core"
  codesign --force --sign - "$LUMA_HOME/bin/luma-core"
  codesign --verify --strict "$LUMA_HOME/bin/luma-core"
  # Releases up to 1.0.0-beta.2 copied what the links inside the app pointed
  # to, and codesign rejects the result as an ambiguous bundle.
  if [[ "$1" != true ]]; then
    printf 'The app in this older release cannot be re-signed; it is installed as published.\n'
    return 0
  fi
  codesign --force --sign - "$bundled"
  codesign --force --deep --sign - "$MAC_APP"
  codesign --verify --deep --strict "$MAC_APP"
}

run_setup() {
  local core="$1"
  if [[ "${LUMA_SKIP_SETUP:-}" != 1 ]] && { : < "$TTY"; } 2>/dev/null; then
    log "Setting up Luma"
    if "$core" setup < "$TTY"; then return; fi
    printf 'Setup did not finish; installation continues.\n'
  else
    log "Skipping setup"
  fi
  printf 'Set up later in Luma Desktop, or run: "%s/bin/luma-core" setup\n' "$LUMA_HOME"
}

# Quotes a path for the Exec key of a desktop entry.
desktop_exec_quote() {
  printf '%s' "$1" | sed -e 's/[\\"`$]/\\\\&/g' -e 's/%/%%/g' -e 's/^/"/' -e 's/$/"/'
}

register_linux_app() {
  mkdir -p "$(dirname "$LAUNCHER_ENTRY")"
  if [[ -f "$LUMA_HOME/share/luma.png" ]]; then
    mkdir -p "$(dirname "$LAUNCHER_ICON")"
    cp "$LUMA_HOME/share/luma.png" "$LAUNCHER_ICON"
  fi
  cat > "$LAUNCHER_ENTRY" <<ENTRY
[Desktop Entry]
Type=Application
Name=Luma
Comment=Luma coding agent and Teammates
Exec=$(desktop_exec_quote "$LUMA_HOME/desktop/Luma") %U
Icon=luma
Terminal=false
Categories=Development;
StartupWMClass=Luma
ENTRY
  if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$(dirname "$LAUNCHER_ENTRY")" >/dev/null 2>&1 || true
  fi
}

uninstall() {
  require_desktop_closed
  log "Removing Luma program files"
  recover_interrupted_install
  stop_gateway
  discard_backups
  if [[ "$(uname -s)" == "Darwin" ]]; then
    if is_luma_app "$MAC_APP"; then rm -rf "$MAC_APP"; fi
  else
    rm -f "$LAUNCHER_ENTRY" "$LAUNCHER_ICON"
  fi
  rm -f "$(config_directory)/install.json"
  rm -rf "$LUMA_HOME"
  rm -f "$BIN_DIR/luma" "$BIN_DIR/luma-core" "$BIN_DIR/luma-desktop"
  for profile in "${HOME}/.zprofile" "${HOME}/.profile" "${HOME}/.bash_profile"; do
    if [[ -f "$profile" ]]; then
      temporary="$(mktemp)"
      awk '
        /^# >>> Luma PATH >>>$/ { skip=1; next }
        /^# <<< Luma PATH <<<$/{ skip=0; next }
        !skip { print }
      ' "$profile" > "$temporary"
      mv "$temporary" "$profile"
    fi
  done
  printf 'Removed Luma binaries and runtimes. User configuration, installed skills, and browser caches were preserved.\n'
  exit 0
}

if [[ "${1:-}" == "--uninstall" ]]; then uninstall; fi

command -v curl >/dev/null 2>&1 || fail 'curl is required.'
command -v tar >/dev/null 2>&1 || fail 'tar is required.'
command -v awk >/dev/null 2>&1 || fail 'awk is required.'
resolve_target
require_desktop_closed
recover_interrupted_install
if [[ "$(uname -s)" == "Darwin" && -e "$MAC_APP" ]] && ! is_luma_app "$MAC_APP"; then
  fail "$MAC_APP is a different application. Move or rename it, then run this installer again."
fi
case "$(uname -s)" in
  Darwin) NODE_PLATFORM="darwin-${TARGET%%-*}" ;;
  Linux) NODE_PLATFORM="linux-${TARGET%%-*}" ;;
esac
# Rust target architecture names already match Node's archive names.
NODE_PLATFORM="${NODE_PLATFORM/arm64/arm64}"
NODE_PLATFORM="${NODE_PLATFORM/aarch64/arm64}"
NODE_PLATFORM="${NODE_PLATFORM/x86_64/x64}"

TMP_DIR="$(mktemp -d)"
trap on_exit EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
if [[ "${LUMA_SKIP_PREFLIGHT:-}" != 1 ]]; then
  check_disk_space "$TMP_DIR"
  check_disk_space "$LUMA_HOME"
fi

if [[ -z "$VERSION" ]]; then
  log "Finding the latest Luma release"
  VERSION="$(latest_release)"
fi
[[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([.-][A-Za-z0-9.-]+)?$ ]] || fail "could not resolve a valid release tag (got '${VERSION:-empty}'). Set LUMA_VERSION explicitly."

asset="luma-${TARGET}.tar.gz"
log "Downloading Luma ${VERSION} for ${TARGET}"
download "https://github.com/${REPOSITORY}/releases/download/${VERSION}/${asset}" "${TMP_DIR}/${asset}"
download "https://github.com/${REPOSITORY}/releases/download/${VERSION}/${asset}.sha256" "${TMP_DIR}/${asset}.sha256"
expected="$(awk '{print $1; exit}' "${TMP_DIR}/${asset}.sha256")"
[[ "$expected" =~ ^[a-fA-F0-9]{64}$ ]] || fail 'release checksum file is invalid.'
verify_sha256 "${TMP_DIR}/${asset}" "$expected"

verify_provenance "${TMP_DIR}/${asset}"

log "Preparing the verified Luma bundle"
tar -xzf "${TMP_DIR}/${asset}" -C "$TMP_DIR"
[[ -x "${TMP_DIR}/luma/bin/luma-core" ]] || fail 'release bundle does not contain an executable luma-core.'
[[ -s "${TMP_DIR}/luma/lib/luma-cli.js" ]] || fail 'release bundle does not contain the Ink client.'
if [[ "$(uname -s)" == Darwin ]]; then
  [[ -x "${TMP_DIR}/luma/desktop/Luma.app/Contents/MacOS/Luma" ]] || fail 'release bundle does not contain the macOS Luma Desktop app.'
else
  [[ -x "${TMP_DIR}/luma/desktop/Luma" ]] || fail 'release bundle does not contain the Linux Luma Desktop executable.'
fi

# Releases published before the installer setup existed lack these commands.
supports_setup=false
if grep -qF '"installer-setup"' "${TMP_DIR}/luma/bundle.json"; then
  supports_setup=true
  # Ask before the long downloads. The settings do not depend on them.
  run_setup "${TMP_DIR}/luma/bin/luma-core"
else
  log "Release ${VERSION} predates installer setup; set up Luma after installing."
fi

if [[ "$(uname -s)" == "Linux" ]]; then
  check_linux_desktop "${TMP_DIR}/luma/desktop"
fi

runtime="$TMP_DIR/runtime"
mkdir -p "$runtime"
install_node "$runtime"

log "Installing pinned Bun and Playwright runtimes"
"$runtime/node/bin/npm" install --prefix "$runtime" --no-save --no-audit --no-fund \
  "bun@${BUN_VERSION}" "playwright@${PLAYWRIGHT_VERSION}" "@vscode/ripgrep@${RIPGREP_VERSION}"
[[ "$("$runtime/node/bin/node" --version)" == "v${NODE_VERSION}" ]] || fail 'Node.js installation did not match the pinned version.'
[[ "$("$runtime/node_modules/.bin/bun" --version)" == "$BUN_VERSION" ]] || fail 'Bun installation did not match the pinned version.'
playwright_version="$("$runtime/node/bin/node" -e 'process.stdout.write(require(process.argv[1]).version)' "$runtime/node_modules/playwright/package.json")"
[[ "$playwright_version" == "$PLAYWRIGHT_VERSION" ]] || fail 'Playwright installation did not match the pinned version.'

if ! command -v git >/dev/null 2>&1; then
  if [[ "$(uname -s)" == "Linux" ]] && command -v apt-get >/dev/null 2>&1; then
    if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
      apt-get update
      apt-get install -y git
    elif command -v sudo >/dev/null 2>&1; then
      sudo apt-get update
      sudo apt-get install -y git
    else
      fail 'Git is required. Install Git or re-run with sudo available.'
    fi
  elif [[ "$(uname -s)" == "Darwin" ]]; then
    fail 'Git is required. Install the Xcode Command Line Tools with: xcode-select --install'
  else
    fail 'Git is required. Install Git with your Linux distribution package manager, then re-run this installer.'
  fi
fi
case "$TARGET" in
  aarch64-apple-darwin) RIPGREP_PLATFORM="darwin-arm64" ;;
  x86_64-apple-darwin) RIPGREP_PLATFORM="darwin-x64" ;;
  aarch64-unknown-linux-gnu) RIPGREP_PLATFORM="linux-arm64" ;;
  x86_64-unknown-linux-gnu) RIPGREP_PLATFORM="linux-x64" ;;
esac
rg_binary="$runtime/node_modules/@vscode/ripgrep-${RIPGREP_PLATFORM}/bin/rg"
[[ -x "$rg_binary" ]] || fail 'the platform-specific ripgrep binary was not installed.'
"$rg_binary" --version >/dev/null
git --version >/dev/null

export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-${HOME}/.cache/ms-playwright}"
mkdir -p "$PLAYWRIGHT_BROWSERS_PATH"
if [[ "$(uname -s)" == "Linux" ]] && command -v apt-get >/dev/null 2>&1; then
  if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    "$runtime/node/bin/node" "$runtime/node_modules/playwright/cli.js" install-deps chromium
  elif command -v sudo >/dev/null 2>&1; then
    sudo -E "$runtime/node/bin/node" "$runtime/node_modules/playwright/cli.js" install-deps chromium
  else
    fail 'Linux browser dependencies require root or sudo. Re-run with sudo available.'
  fi
elif [[ "$(uname -s)" == "Linux" ]]; then
  log 'Skipping automatic Chromium system-library installation on this Linux distribution; install its Playwright Chromium dependencies before using browser automation.'
fi
"$runtime/node/bin/node" "$runtime/node_modules/playwright/cli.js" install chromium

log "Installing Luma Core, Ink client, embedded dashboard, and Desktop app"
require_desktop_closed
if [[ -x "$LUMA_HOME/bin/luma-core" && "$("$LUMA_HOME/bin/luma-core" gateway status 2>/dev/null)" == running ]]; then
  gateway_was_running=true
fi
replacing=true
stop_gateway
begin_replacement
cp -R "${TMP_DIR}/luma/bin" "$LUMA_HOME/bin"
cp -R "${TMP_DIR}/luma/lib" "$LUMA_HOME/lib"
if [[ "$(uname -s)" == "Darwin" ]]; then
  mkdir -p "$(dirname "$MAC_APP")"
  cp -R "${TMP_DIR}/luma/desktop/Luma.app" "$MAC_APP"
else
  cp -R "${TMP_DIR}/luma/desktop" "$LUMA_HOME/desktop"
  if [[ -d "${TMP_DIR}/luma/share" ]]; then cp -R "${TMP_DIR}/luma/share" "$LUMA_HOME/share"; fi
  register_linux_app
fi
mv "$runtime" "$LUMA_HOME/runtime"
cp "${TMP_DIR}/luma/bundle.json" "$LUMA_HOME/bundle.json"
cp "${TMP_DIR}/luma/LICENSE" "$LUMA_HOME/LICENSE"
cat > "$BIN_DIR/luma" <<'WRAPPER'
#!/bin/sh
set -eu
LUMA_HOME="${LUMA_HOME:-${HOME}/.local/share/luma}"
export LUMA_HOME
export LUMA_BINARY="${LUMA_HOME}/bin/luma-core"
export LUMA_NODE_BIN="${LUMA_HOME}/runtime/node/bin/node"
export LUMA_PLAYWRIGHT_MODULE="${LUMA_HOME}/runtime/node_modules/playwright"
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-${HOME}/.cache/ms-playwright}"
export DEV=false
case "$(uname -s)/$(uname -m)" in
  Darwin/arm64|Darwin/aarch64) RIPGREP_PLATFORM="darwin-arm64" ;;
  Darwin/x86_64) RIPGREP_PLATFORM="darwin-x64" ;;
  Linux/arm64|Linux/aarch64) RIPGREP_PLATFORM="linux-arm64" ;;
  Linux/x86_64|Linux/amd64) RIPGREP_PLATFORM="linux-x64" ;;
  *) echo "Luma: unsupported ripgrep platform" >&2; exit 1 ;;
esac
export PATH="${LUMA_HOME}/runtime/node/bin:${LUMA_HOME}/runtime/node_modules/.bin:${LUMA_HOME}/runtime/node_modules/@vscode/ripgrep-${RIPGREP_PLATFORM}/bin:${PATH}"
export LUMA_VERSION="$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' "${LUMA_HOME}/bundle.json" | head -n 1)"
exec "${LUMA_HOME}/runtime/node_modules/.bin/bun" "${LUMA_HOME}/lib/luma-cli.js" "$@"
WRAPPER
# `luma update` must reinstall the commands where they are now.
# ENVIRON keeps the escaping that `awk -v` would remove.
line="export LUMA_INSTALLED_BIN_DIR=$(printf '%q' "$BIN_DIR")" \
  awk '{ print } /^set -eu$/ { print ENVIRON["line"] }' "$BIN_DIR/luma" > "$TMP_DIR/luma-wrapper"
cat "$TMP_DIR/luma-wrapper" > "$BIN_DIR/luma"
chmod 755 "$BIN_DIR/luma" "$LUMA_HOME/bin/luma-core"
cat > "$BIN_DIR/luma-desktop" <<'DESKTOP_WRAPPER'
#!/bin/sh
set -eu
LUMA_HOME="${LUMA_HOME:-${HOME}/.local/share/luma}"
case "$(uname -s)" in
  Darwin) exec open "${HOME}/Applications/Luma.app" --args "$@" ;;
  Linux) exec "$LUMA_HOME/desktop/Luma" "$@" ;;
  *) echo "Luma Desktop: unsupported platform" >&2; exit 1 ;;
esac
DESKTOP_WRAPPER
chmod 755 "$BIN_DIR/luma-desktop"
ln -sfn "$LUMA_HOME/bin/luma-core" "$BIN_DIR/luma-core"
if [[ "$(uname -s)" == "Darwin" ]]; then
  log "Signing Luma ad hoc"
  sign_macos_executables "$supports_setup"
fi
commit_replacement

config_dir="$(config_directory)"
mkdir -p "$config_dir/skills"
if [[ -d "${TMP_DIR}/luma/skills/ask-question" && ! -e "$config_dir/skills/ask-question" ]]; then
  cp -R "${TMP_DIR}/luma/skills/ask-question" "$config_dir/skills/ask-question"
fi
install_path_hint
if [[ "$supports_setup" == true ]]; then
  "$LUMA_HOME/bin/luma-core" install-record "$LUMA_HOME" "$PLAYWRIGHT_BROWSERS_PATH" \
    || printf 'Could not record the installation; Luma Desktop will use the default location.\n'
fi

log "Luma ${VERSION} installed"
printf 'Commands: luma, luma teammates, luma dashboard, luma-desktop\n'
printf 'Runtime: Bun %s, Node.js %s, Playwright %s + Chromium, ripgrep %s, Git\n' "$BUN_VERSION" "$NODE_VERSION" "$PLAYWRIGHT_VERSION" "$RIPGREP_VERSION"
printf 'Luma is installed as an application. Open it from Spotlight, Launchpad, or your application launcher.\n'
printf 'For the terminal client, open a new terminal and run: luma\n'
