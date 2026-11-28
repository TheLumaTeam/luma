#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT

FIXTURES="$TEST_ROOT/fixtures"
FAKE_BIN="$TEST_ROOT/fake-bin"
# The space checks that wrappers and launchers quote their paths.
TEST_HOME="$TEST_ROOT/home dir"
LUMA_HOME="$TEST_HOME/.local/share/luma"
BIN_DIR="$TEST_HOME/.local/bin"
CONFIG_DIR="$TEST_HOME/Library/Application Support/luma"
mkdir -p "$FIXTURES" "$FAKE_BIN" "$TEST_HOME"

CALLS="$TEST_ROOT/calls"
APP="$TEST_HOME/Applications/Luma.app"

cat > "$FIXTURES/luma-core" <<'CORE'
#!/bin/sh
printf '%s\n' "$*" >> "$LUMA_TEST_CALLS"
if [ "${1:-}" = setup ]; then exit "${LUMA_TEST_SETUP_STATUS:-0}"; fi
if [ "$*" = "gateway status" ]; then printf '%s\n' "${LUMA_TEST_GATEWAY:-stopped}"; fi
CORE
cat > "$FIXTURES/luma-cli.js" <<'CLI'
process.stdout.write("Luma installer fixture\n");
CLI
chmod +x "$FIXTURES/luma-core"

package() { # target desktop-directory output
  python3 scripts/package-bundle.py \
    --target "$1" \
    --core "$FIXTURES/luma-core" \
    --cli "$FIXTURES/luma-cli.js" \
    --desktop "$2" \
    --version 1.0.0-beta.2 \
    --output "$3"
  sha256sum "$3" > "$3.sha256"
}

# macOS fixture
mkdir -p "$FIXTURES/mac/Luma.app/Contents/MacOS" "$FIXTURES/mac/Luma.app/Contents/Resources"
printf '#!/bin/sh\nexit 0\n' > "$FIXTURES/mac/Luma.app/Contents/MacOS/Luma"
chmod +x "$FIXTURES/mac/Luma.app/Contents/MacOS/Luma"
printf '<string>com.thelumateam.luma</string>\n' > "$FIXTURES/mac/Luma.app/Contents/Info.plist"
printf 'core\n' > "$FIXTURES/mac/Luma.app/Contents/Resources/luma-core"
# Frameworks inside a macOS app are held together by links.
mkdir -p "$FIXTURES/mac/Luma.app/Contents/Frameworks/Example.framework/Versions/A"
ln -s A "$FIXTURES/mac/Luma.app/Contents/Frameworks/Example.framework/Versions/Current"
package aarch64-apple-darwin "$FIXTURES/mac" "$FIXTURES/luma-aarch64-apple-darwin.tar.gz"

# Linux fixture
mkdir -p "$FIXTURES/linux"
printf '#!/bin/sh\nexit 0\n' > "$FIXTURES/linux/Luma"
chmod +x "$FIXTURES/linux/Luma"
package x86_64-unknown-linux-gnu "$FIXTURES/linux" "$FIXTURES/luma-x86_64-unknown-linux-gnu.tar.gz"

# A release published before the installer setup existed.
mkdir -p "$FIXTURES/old" "$TEST_ROOT/old-extract"
tar -xzf "$FIXTURES/luma-aarch64-apple-darwin.tar.gz" -C "$TEST_ROOT/old-extract"
python3 - "$TEST_ROOT/old-extract/luma/bundle.json" <<'PY'
import json, sys
path = sys.argv[1]
bundle = json.load(open(path))
assert "installer-setup" in bundle["components"], "bundle lacks the installer-setup marker"
bundle["components"].remove("installer-setup")
json.dump(bundle, open(path, "w"), indent=2)
PY
tar -czf "$FIXTURES/old/luma-aarch64-apple-darwin.tar.gz" -C "$TEST_ROOT/old-extract" luma
sha256sum "$FIXTURES/old/luma-aarch64-apple-darwin.tar.gz" > "$FIXTURES/old/luma-aarch64-apple-darwin.tar.gz.sha256"

# Out of order, with a newer draft: only publication time may decide.
cat > "$FIXTURES/releases.json" <<'RELEASES'
[
  {
    "tag_name": "v0.1.0",
    "draft": false,
    "prerelease": false,
    "published_at": "2026-08-30T13:23:19Z",
    "body": "Not a release: \"tag_name\": \"v9.9.9\""
  },
  {
    "tag_name": "v3.0.0",
    "draft": true,
    "prerelease": false,
    "published_at": "2026-12-30T00:00:00Z"
  },
  {
    "tag_name": "v2.0.0-beta.1",
    "draft": false,
    "prerelease": true,
    "published_at": "2026-11-28T08:20:44Z"
  }
]
RELEASES

make_node() { # node-platform ripgrep-platform
  local directory="$FIXTURES/node-v22.23.5-$1"
  mkdir -p "$directory/bin"
  cat > "$directory/bin/node" <<'NODE'
#!/bin/sh
case "${1:-}" in
  --version) printf 'v22.23.5\n' ;;
  -e) printf '1.65.0' ;;
  *) exit 0 ;;
esac
NODE
  cat > "$directory/bin/npm" <<NPM
#!/bin/sh
set -eu
ripgrep=$2
NPM
  cat >> "$directory/bin/npm" <<'NPM'
prefix=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--prefix" ]; then prefix="$2"; shift 2; else shift; fi
done
[ -n "$prefix" ]
mkdir -p "$prefix/node_modules/.bin" \
  "$prefix/node_modules/playwright" \
  "$prefix/node_modules/@vscode/ripgrep-$ripgrep/bin"
cat > "$prefix/node_modules/.bin/bun" <<'BUN'
#!/bin/sh
if [ "${1:-}" = "--version" ]; then printf '1.4.4\n'; else printf '%s\n' "$LUMA_VERSION"; fi
BUN
printf '{"name":"playwright","version":"1.65.0"}\n' > "$prefix/node_modules/playwright/package.json"
printf '#!/bin/sh\nprintf "ripgrep 1.18.0\\n"\n' > "$prefix/node_modules/@vscode/ripgrep-$ripgrep/bin/rg"
chmod +x "$prefix/node_modules/.bin/bun" "$prefix/node_modules/@vscode/ripgrep-$ripgrep/bin/rg"
NPM
  chmod +x "$directory/bin/node" "$directory/bin/npm"
  tar -cJf "$directory.tar.xz" -C "$FIXTURES" "node-v22.23.5-$1"
  printf '%s  node-v22.23.5-%s.tar.xz\n' "$(sha256sum "$directory.tar.xz" | awk '{print $1}')" "$1" >> "$FIXTURES/SHASUMS256.txt"
}
make_node darwin-arm64 darwin-arm64
make_node linux-x64 linux-x64

cat > "$FAKE_BIN/curl" <<'CURL'
#!/usr/bin/env bash
set -euo pipefail
url=""
output=""
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --output) output="$2"; shift 2 ;;
    https://*) url="$1"; shift ;;
    *) shift ;;
  esac
done
printf 'curl %s\n' "$url" >> "$LUMA_TEST_CALLS"
fixtures="$LUMA_TEST_FIXTURES"
case "$url" in
  */releases\?per_page=*) cat "$fixtures/releases.json"; exit 0 ;;
  */luma-*) source="${LUMA_TEST_BUNDLES:-$fixtures}/${url##*/}" ;;
  */SHASUMS256.txt|*/node-v22.23.5-*) source="$fixtures/${url##*/}" ;;
  *) printf 'unexpected installer URL: %s\n' "$url" >&2; exit 1 ;;
esac
cp "$source" "$output"
CURL
cat > "$FAKE_BIN/uname" <<'UNAME'
#!/bin/sh
case "${1:-}" in
  -m) if [ "${LUMA_TEST_OS:-Darwin}" = Linux ]; then printf 'x86_64\n'; else printf 'arm64\n'; fi ;;
  *) printf '%s\n' "${LUMA_TEST_OS:-Darwin}" ;;
esac
UNAME
cat > "$FAKE_BIN/ps" <<'PS'
#!/bin/sh
printf '%s\n' "${LUMA_TEST_PROCESS:-/sbin/init}"
PS
cat > "$FAKE_BIN/df" <<'DF'
#!/bin/sh
printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\n'
printf 'disk 99999999 1 %s 1%% /\n' "${LUMA_TEST_FREE_KB:-50000000}"
DF
cat > "$FAKE_BIN/ldd" <<'LDD'
#!/bin/sh
printf '\tlibc.so.6 => /lib/libc.so.6 (0x1)\n'
if [ -n "${LUMA_TEST_MISSING_LIB:-}" ]; then printf '\t%s => not found\n' "$LUMA_TEST_MISSING_LIB"; fi
LDD
# GitHub CLI: unauthenticated unless a test says otherwise.
cat > "$FAKE_BIN/gh" <<'GH'
#!/bin/sh
printf 'gh %s\n' "$*" >> "$LUMA_TEST_CALLS"
case "$1 $2" in
  "auth status") [ "${LUMA_TEST_GH:-unauthenticated}" != unauthenticated ] ;;
  "attestation verify") [ "${LUMA_TEST_GH:-}" = verified ] ;;
  *) exit 1 ;;
esac
GH
# The Linux path must not touch the real system.
# shellcheck disable=SC2016
printf '#!/bin/sh\n[ "$1" = -E ] && shift\nexec "$@"\n' > "$FAKE_BIN/sudo"
printf '#!/bin/sh\nexit 0\n' > "$FAKE_BIN/apt-get"
cat > "$FAKE_BIN/codesign" <<'CODESIGN'
#!/bin/sh
printf 'codesign %s\n' "$*" >> "$LUMA_TEST_CALLS"
if [ "${LUMA_TEST_FAULT%%:*}" = codesign ]; then
  case "$*" in
    *"${LUMA_TEST_FAULT#*:}"*) printf 'fault injected: codesign %s\n' "$*" >> "$LUMA_TEST_CALLS"; exit 1 ;;
  esac
fi
CODESIGN
# Breaks one step: LUMA_TEST_FAULT is "<command>:<text in its arguments>".
# LUMA_TEST_FAULT_SIGNAL signals the installer instead of only failing.
for tool in cp mv ln; do
  real="$(command -v "$tool")"
  cat > "$FAKE_BIN/$tool" <<FAULT
#!/bin/sh
if [ "\${LUMA_TEST_FAULT%%:*}" = "$tool" ]; then
  case "\$*" in
    *"\${LUMA_TEST_FAULT#*:}"*)
      printf 'fault injected: $tool %s\n' "\$*" >> "\$LUMA_TEST_CALLS"
      if [ -n "\${LUMA_TEST_FAULT_SIGNAL:-}" ]; then kill -"\$LUMA_TEST_FAULT_SIGNAL" "\$PPID"; fi
      exit 1 ;;
  esac
fi
exec "$real" "\$@"
FAULT
done
chmod +x "$FAKE_BIN"/*
export LUMA_TEST_FAULT=""

export HOME="$TEST_HOME"
export SHELL=/bin/zsh
export LUMA_HOME
export LUMA_BIN_DIR="$BIN_DIR"
export LUMA_TEST_FIXTURES="$FIXTURES"
export LUMA_TEST_CALLS="$CALLS"
# Stands in for the terminal that setup reads from.
export LUMA_INSTALLER_TTY=/dev/null
export LUMA_APPARMOR_USERNS_FILE="$TEST_ROOT/apparmor-userns"
export PATH="$FAKE_BIN:$PATH"
unset LUMA_VERSION XDG_CONFIG_HOME XDG_DATA_HOME PLAYWRIGHT_BROWSERS_PATH

fail() { printf 'test failed: %s\n' "$*" >&2; exit 1; }
called() { grep -qxF -- "$1" "$CALLS" || fail "expected core call: $1"; }
not_called() { if grep -qE -- "$1" "$CALLS"; then fail "unexpected call matching: $1"; fi; }
run_install() {
  : > "$CALLS"
  bash scripts/install.sh "$@" > "$TEST_ROOT/install.log" 2>&1 \
    || { cat "$TEST_ROOT/install.log" >&2; return 1; }
}

# Latest release by publication time, with setup and app registration.
run_install
grep -q '/releases/download/v2.0.0-beta.1/' "$CALLS" || fail 'did not pick the latest published release'
called setup
called "install-record $LUMA_HOME $TEST_HOME/.cache/ms-playwright"
[[ -x "$APP/Contents/MacOS/Luma" ]] || fail 'app is not in ~/Applications'
[[ ! -e "$LUMA_HOME/desktop" ]] || fail 'macOS app was also left in LUMA_HOME'
# The installed executables are signed ad hoc, innermost first, then checked.
signing="$(grep '^codesign ' "$CALLS" || true)"
expected_signing="codesign --force --sign - $LUMA_HOME/bin/luma-core
codesign --verify --strict $LUMA_HOME/bin/luma-core
codesign --force --sign - $APP/Contents/Resources/luma-core
codesign --force --deep --sign - $APP
codesign --verify --deep --strict $APP"
[[ "$signing" == "$expected_signing" ]] || fail "unexpected signing: $signing"
[[ -L "$APP/Contents/Frameworks/Example.framework/Versions/Current" ]] \
  || fail 'links inside the app were replaced by copies, which breaks its signature'
[[ -x "$LUMA_HOME/bin/luma-core" ]]
[[ -x "$BIN_DIR/luma" && -x "$BIN_DIR/luma-desktop" ]]
# shellcheck disable=SC2016
grep -qF '${HOME}/Applications/Luma.app' "$BIN_DIR/luma-desktop" || fail 'luma-desktop does not open the installed app'
[[ -s "$LUMA_HOME/lib/luma-cli.js" ]]
[[ -f "$CONFIG_DIR/skills/ask-question/SKILL.md" ]]
[[ "$(awk 'index($0, "# >>> Luma PATH >>>") { count++ } END { print count + 0 }' "$TEST_HOME/.zprofile")" == 1 ]]
version_output="$("$BIN_DIR/luma")"
[[ "$version_output" == *"1.0.0-beta.2"* ]]

# A specified version is used without asking for the release list. Re-install
# stops the old gateway and removes the app from its former location.
mkdir -p "$LUMA_HOME/desktop/Luma.app"
LUMA_VERSION=v1.0.0-beta.2 run_install
grep -q '/releases/download/v1.0.0-beta.2/' "$CALLS" || fail 'LUMA_VERSION was ignored'
not_called 'per_page'
called 'gateway stop'
[[ ! -e "$LUMA_HOME/desktop" ]] || fail 'old app copy was not removed'
[[ "$(awk 'index($0, "# >>> Luma PATH >>>") { count++ } END { print count + 0 }' "$TEST_HOME/.zprofile")" == 1 ]]

# Setup is skipped on request or without a terminal; the record is still saved.
LUMA_SKIP_SETUP=1 run_install
not_called '^setup$'
called "install-record $LUMA_HOME $TEST_HOME/.cache/ms-playwright"
LUMA_INSTALLER_TTY="$TEST_ROOT/no-terminal" run_install
not_called '^setup$'
grep -q 'luma-core" setup' "$TEST_ROOT/install.log" || fail 'did not say how to run setup later'

# A failed or cancelled setup does not fail the install.
LUMA_TEST_SETUP_STATUS=1 run_install
[[ -x "$APP/Contents/MacOS/Luma" ]]

# A release without the marker installs without setup or a record.
# Older macOS bundles lost the links inside the app, so codesign rejects it as
# "ambiguous". That must not fail the install.
LUMA_TEST_FAULT="codesign:--deep" LUMA_TEST_BUNDLES="$FIXTURES/old" run_install
not_called '^codesign .*Luma\.app'
grep -qxF "codesign --force --sign - $LUMA_HOME/bin/luma-core" "$CALLS" || fail 'did not sign Core of an older release'
grep -qF 'cannot be re-signed' "$TEST_ROOT/install.log" || fail 'did not say the app was left unsigned'
not_called '^setup$'
not_called '^install-record'
[[ -x "$APP/Contents/MacOS/Luma" ]]

# A running app stops the install before anything changes.
if LUMA_TEST_PROCESS="$APP/Contents/MacOS/Luma" run_install 2>/dev/null; then
  fail 'installed over a running app'
fi
not_called 'gateway stop'

# An app from an earlier release has Electron's identifier but bundles Core.
printf '<string>com.github.Electron</string>\n' > "$APP/Contents/Info.plist"
run_install

printf 'config\n' > "$CONFIG_DIR/config.toml"
printf '{}\n' > "$CONFIG_DIR/install.json"
run_install --uninstall
[[ ! -e "$BIN_DIR/luma" && ! -e "$BIN_DIR/luma-core" && ! -e "$BIN_DIR/luma-desktop" ]]
[[ ! -e "$LUMA_HOME" ]]
[[ ! -e "$APP" ]] || fail 'uninstall left the app'
[[ ! -e "$CONFIG_DIR/install.json" ]] || fail 'uninstall left the install record'
[[ -f "$CONFIG_DIR/config.toml" && -d "$CONFIG_DIR/skills/ask-question" ]]
[[ "$(awk 'index($0, "# >>> Luma PATH >>>") { count++ } END { print count + 0 }' "$TEST_HOME/.zprofile")" == 0 ]]

# Somebody else's Luma.app is never replaced or removed.
mkdir -p "$APP/Contents"
printf '<string>com.example.other</string>\n' > "$APP/Contents/Info.plist"
if run_install 2>/dev/null; then fail 'replaced a foreign Luma.app'; fi
[[ ! -e "$LUMA_HOME" ]] || fail 'changed the system before rejecting a foreign app'
run_install --uninstall
grep -q 'com.example.other' "$APP/Contents/Info.plist" || fail 'uninstall touched a foreign app'
rm -rf "$APP"

# Every file, link and directory of the installation, with file contents.
snapshot() {
  (
    cd "$TEST_HOME"
    find . | LC_ALL=C sort
    find . -type f -exec sha256sum {} + | LC_ALL=C sort
    find . -type l -exec sh -c 'for link; do printf "%s -> %s\n" "$link" "$(readlink "$link")"; done' sh {} +
  )
}
assert_unchanged() { # description
  snapshot > "$TEST_ROOT/after"
  diff "$TEST_ROOT/before" "$TEST_ROOT/after" >&2 || fail "$1 did not restore the previous installation"
}
expect_failure() { # fault [signal]
  : > "$CALLS"
  if LUMA_TEST_FAULT="$1" LUMA_TEST_FAULT_SIGNAL="${2:-}" bash scripts/install.sh > "$TEST_ROOT/install.log" 2>&1; then
    fail "install succeeded despite $1"
  fi
  grep -q '^fault injected' "$CALLS" || { cat "$TEST_ROOT/install.log" >&2; fail "fault $1 was never reached"; }
}
# Marks the installed copy so that a replacement cannot pass for it.
mark_installation() { # app-directory
  printf 'old\n' > "$LUMA_HOME/lib/old-version"
  printf 'old\n' > "$1/old-version"
  snapshot > "$TEST_ROOT/before"
}

# A failed first install leaves nothing half-installed.
expect_failure "ln:luma-core"
[[ ! -e "$APP" && ! -e "$LUMA_HOME" ]] || fail 'failed first install left program files'
[[ ! -e "$BIN_DIR/luma" && ! -e "$BIN_DIR/luma-desktop" && ! -L "$BIN_DIR/luma-core" ]] \
  || fail 'failed first install left commands'

# A failed upgrade restores the previous installation, wherever it fails.
run_install
mark_installation "$APP/Contents"
for fault in "cp:/luma/lib" "cp:Luma.app" "mv:/runtime $LUMA_HOME/runtime" "cp:/luma/LICENSE" "ln:luma-core" \
  "codesign:--deep --sign" "codesign:--verify --deep"; do
  expect_failure "$fault"
  assert_unchanged "a failure at $fault"
  not_called '^gateway start'
done

# A gateway that was running is running again afterwards.
LUMA_TEST_GATEWAY=running expect_failure "ln:luma-core"
called 'gateway start'

# So is the previous installation after an interrupted install.
for signal in INT TERM HUP; do
  expect_failure "mv:/runtime $LUMA_HOME/runtime" "$signal"
  assert_unchanged "SIG$signal"
done

# A killed installer cannot clean up. The next run restores before anything
# else, even if that run then fails to download.
expect_failure "cp:Luma.app" KILL
if LUMA_TEST_BUNDLES="$TEST_ROOT/no-bundles" run_install 2>/dev/null; then fail 'expected a failed download'; fi
assert_unchanged 'the run after a killed install'

# A successful install keeps no backups, and downloads are retried.
run_install
[[ ! -e "$APP/Contents/old-version" && ! -e "$LUMA_HOME/lib/old-version" ]] || fail 'old files survived an upgrade'
leftovers="$(find "$TEST_HOME" -name '*.luma-previous' -o -name '.install-pending*')"
[[ -z "$leftovers" ]] || fail "backups were left behind: $leftovers"
grep -qE -- '--retry 3' scripts/install.sh || fail 'downloads are not retried'
run_install --uninstall

# Too little disk space stops the install before anything is downloaded.
logged() { grep -qF -- "$1" "$TEST_ROOT/install.log" || fail "installer did not say: $1"; }
if LUMA_TEST_FREE_KB=1000 run_install 2>/dev/null; then fail 'installed without enough disk space'; fi
logged 'free space'
not_called '/releases/download/'
[[ ! -e "$LUMA_HOME" && ! -e "$APP" ]]
LUMA_TEST_FREE_KB=1000 LUMA_SKIP_PREFLIGHT=1 run_install

# The update command needs to know where the commands were installed.
grep -qF "LUMA_INSTALLED_BIN_DIR" "$BIN_DIR/luma" || fail 'wrapper does not record the command directory'
[[ "$("$BIN_DIR/luma")" == *"1.0.0-beta.2"* ]] || fail 'wrapper broke'

# Build provenance is checked when an authenticated GitHub CLI is available.
LUMA_TEST_GH=verified run_install
logged 'Verified build provenance'
grep -qE '^gh attestation verify .*/luma-aarch64-apple-darwin.tar.gz --repo TheLumaTeam/luma --signer-workflow TheLumaTeam/luma/.github/workflows/release.yml$' "$CALLS" \
  || fail 'provenance was not verified against the release workflow'
LUMA_TEST_GH=rejected run_install
logged 'could not be verified'
run_install
not_called '^gh attestation'
for state in rejected unauthenticated; do
  if LUMA_REQUIRE_ATTESTATION=1 LUMA_TEST_GH="$state" run_install 2>/dev/null; then
    fail "installed without required provenance ($state)"
  fi
  not_called 'gateway stop'
done
LUMA_REQUIRE_ATTESTATION=1 LUMA_TEST_GH=verified run_install
run_install --uninstall

# Linux registers a launcher entry and an icon.
export LUMA_TEST_OS=Linux
export XDG_DATA_HOME="$TEST_HOME/data dir"
ENTRY="$XDG_DATA_HOME/applications/luma.desktop"
ICON="$XDG_DATA_HOME/icons/hicolor/512x512/apps/luma.png"
run_install
[[ -x "$LUMA_HOME/desktop/Luma" && -x "$BIN_DIR/luma-desktop" ]]
not_called '^codesign'
grep -qxF "Exec=\"$LUMA_HOME/desktop/Luma\" %U" "$ENTRY" || fail 'launcher entry has the wrong command'
grep -qxF 'Name=Luma' "$ENTRY"
grep -qxF 'Icon=luma' "$ENTRY"
[[ -s "$ICON" ]] || fail 'icon was not installed'
if command -v desktop-file-validate >/dev/null 2>&1; then desktop-file-validate "$ENTRY"; fi
printf '# old version\n' >> "$ENTRY"
mark_installation "$LUMA_HOME/desktop"
for fault in "cp:/luma/desktop" "cp:share/luma.png" "ln:luma-core"; do
  expect_failure "$fault"
  assert_unchanged "a Linux failure at $fault"
done
# Linux warns about problems that would stop the app from opening.
run_install
if grep -qiE 'missing system libraries|AppArmor' "$TEST_ROOT/install.log"; then fail 'warned about a healthy system'; fi
printf '1\n' > "$LUMA_APPARMOR_USERNS_FILE"
LUMA_TEST_MISSING_LIB=libnss3.so run_install
logged 'missing system libraries'
logged 'libnss3.so'
logged 'AppArmor'

run_install --uninstall
[[ ! -e "$ENTRY" && ! -e "$ICON" && ! -e "$LUMA_HOME" ]] || fail 'Linux uninstall left files'

printf 'installer integration test passed\n'
