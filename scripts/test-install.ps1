# Installs, breaks, repairs and uninstalls Luma on a real Windows system.
#
# Only the Luma release is replaced by local fixtures: Core is real, and the
# installer downloads the real Node.js, Bun, Playwright, Chromium and ripgrep.
# It changes the user's PATH, registry and Start menu, so it runs only on CI
# unless LUMA_TEST_ALLOW_SYSTEM_CHANGES=1.
param(
    [Parameter(Mandatory = $true)][string]$Core
)

$ErrorActionPreference = "Stop"
if ($env:CI -ne "true" -and $env:LUMA_TEST_ALLOW_SYSTEM_CHANGES -ne "1") {
    throw "This test changes the current user's system. Set LUMA_TEST_ALLOW_SYSTEM_CHANGES=1 to run it anyway."
}

$Root = Split-Path -Parent $PSScriptRoot
$Installer = Join-Path $PSScriptRoot "install.ps1"
$Core = (Resolve-Path $Core).Path
$Work = Join-Path ([IO.Path]::GetTempPath()) "luma installer test"
$LumaHome = Join-Path $env:LOCALAPPDATA "Luma"
$ConfigDir = Join-Path $env:APPDATA "luma"
$Shortcut = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Luma.lnk"
$Key = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Luma"
if (Test-Path $LumaHome) { throw "$LumaHome already exists; refusing to test over it." }

function Assert([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "Test failed: $Message" }
}

# --- Fixtures ---
Remove-Item -Recurse -Force $Work -ErrorAction SilentlyContinue
$Desktop = Join-Path $Work "desktop"
$Good = Join-Path $Work "good"
$Broken = Join-Path $Work "broken"
New-Item -ItemType Directory -Force -Path $Desktop, $Good, $Broken | Out-Null
Copy-Item "$env:SystemRoot\System32\where.exe" (Join-Path $Desktop "Luma.exe")
$Cli = Join-Path $Work "luma-cli.js"
'process.stdout.write("fixture\n");' | Set-Content -Encoding ASCII $Cli
$Asset = "luma-x86_64-pc-windows-msvc.tar.gz"

function Write-Checksum([string]$Path) {
    $Hash = (Get-FileHash $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    "$Hash  $(Split-Path -Leaf $Path)" | Set-Content -Encoding ASCII "$Path.sha256"
}

Push-Location $Root
try {
    python scripts/package-bundle.py --target x86_64-pc-windows-msvc --core $Core --cli $Cli `
        --desktop $Desktop --version 1.0.0 --output (Join-Path $Good $Asset)
    Assert ($LASTEXITCODE -eq 0) "could not package the fixture"
} finally { Pop-Location }
Write-Checksum (Join-Path $Good $Asset)

# An upgrade that fails halfway: LICENSE is only needed while files are replaced.
$Extract = Join-Path $Work "extract"
New-Item -ItemType Directory -Force -Path $Extract | Out-Null
tar.exe -xzf (Join-Path $Good $Asset) -C $Extract
Remove-Item (Join-Path $Extract "luma\LICENSE")
$BundleFile = Join-Path $Extract "luma\bundle.json"
(Get-Content $BundleFile -Raw).Replace('"1.0.0"', '"2.0.0"') | Set-Content -Encoding ASCII $BundleFile
tar.exe -czf (Join-Path $Broken $Asset) -C $Extract luma
Write-Checksum (Join-Path $Broken $Asset)

# --- Release downloads come from the fixtures; everything else is real ---
$script:Bundles = $Good
function global:Invoke-WebRequest {
    param($Uri, $OutFile, $Headers)
    if ("$Uri" -like "*/releases/download/*") {
        Copy-Item -LiteralPath (Join-Path $script:Bundles ("$Uri".Split('/')[-1])) -Destination $OutFile
    } else {
        Microsoft.PowerShell.Utility\Invoke-WebRequest -Uri $Uri -OutFile $OutFile -Headers $Headers -UseBasicParsing
    }
}
function global:Invoke-RestMethod {
    param($Uri, $Headers)
    , @(
        [pscustomobject]@{ tag_name = "v0.1.0"; draft = $false; published_at = "2026-08-30T13:23:19Z" },
        [pscustomobject]@{ tag_name = "v3.0.0"; draft = $true; published_at = "2026-12-30T00:00:00Z" },
        [pscustomobject]@{ tag_name = "v1.0.0"; draft = $false; published_at = "2026-11-28T08:20:44Z" })
}

$env:LUMA_SKIP_SETUP = "1"
$env:LUMA_VERSION = $null
$env:LUMA_REQUIRE_ATTESTATION = $null

function Assert-Installed([string]$When) {
    Assert (Test-Path (Join-Path $LumaHome "desktop\Luma.exe")) "$When`: the app is missing"
    Assert (Test-Path (Join-Path $LumaHome "bin\luma-core.exe")) "$When`: Core is missing"
    Assert (Test-Path $Shortcut) "$When`: the Start menu shortcut is missing"
    Assert ((Get-ItemProperty $Key).DisplayVersion -eq "1.0.0") "$When`: the Installed apps entry is wrong"
    $Leftovers = @(Get-ChildItem $LumaHome -Filter "*.luma-previous") + @(Get-Item (Join-Path $LumaHome ".install-pending") -ErrorAction SilentlyContinue)
    Assert ($Leftovers.Count -eq 0) "$When`: recovery files were left behind"
}

function Assert-Throws([scriptblock]$Action, [string]$Message) {
    $Threw = $false
    try { & $Action } catch { $Threw = $true; Write-Host "(expected) $_" }
    Assert $Threw $Message
}

try {
    # --- Install ---
    & $Installer
    Assert-Installed "after installing"
    $Folder = (New-Object -ComObject Shell.Application).NameSpace((Split-Path -Parent $Shortcut))
    $AppId = $Folder.ParseName("Luma.lnk").ExtendedProperty("System.AppUserModel.ID")
    Assert ($AppId -eq "com.thelumateam.luma") "the shortcut's application ID is '$AppId'"
    $Record = Get-Content (Join-Path $ConfigDir "install.json") -Raw | ConvertFrom-Json
    Assert ($Record.luma_home -eq $LumaHome) "install.json does not name the installation"
    & (Join-Path $LumaHome "bin\luma-core.exe") doctor
    Assert ($LASTEXITCODE -eq 0) "doctor found problems in a fresh installation"

    # --- A failed upgrade restores the previous installation ---
    $Sentinel = Join-Path $LumaHome "lib\old-version"
    "old" | Set-Content $Sentinel
    $script:Bundles = $Broken
    Assert-Throws { & $Installer -Version v2.0.0 } "the broken upgrade succeeded"
    Assert (Test-Path $Sentinel) "the previous files were not restored"
    Assert-Installed "after a failed upgrade"

    # --- The next run repairs an interrupted install before anything else ---
    $Lib = Join-Path $LumaHome "lib"
    "kept|$Lib" | Set-Content -Encoding UTF8 (Join-Path $LumaHome ".install-pending")
    Move-Item $Lib "$Lib.luma-previous"
    New-Item -ItemType Directory -Path $Lib | Out-Null
    $script:Bundles = Join-Path $Work "no bundles"
    Assert-Throws { & $Installer } "expected the download to fail"
    Assert (Test-Path $Sentinel) "the interrupted install was not repaired"
    Assert-Installed "after repairing an interrupted install"

    # --- A successful upgrade replaces the old files ---
    $script:Bundles = $Good
    & $Installer
    Assert (-not (Test-Path $Sentinel)) "old files survived an upgrade"
    Assert-Installed "after upgrading"

    # --- Uninstall the way Installed apps does ---
    New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
    "keep" | Set-Content (Join-Path $ConfigDir "config.toml")
    $Saved = Join-Path $Work "uninstall.ps1"
    Copy-Item (Join-Path $LumaHome "uninstall.ps1") $Saved
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Saved
    Assert ($LASTEXITCODE -eq 0) "the saved uninstall script failed"
    Assert (-not (Test-Path $LumaHome)) "uninstall left the program files"
    Assert (-not (Test-Path $Shortcut)) "uninstall left the shortcut"
    Assert (-not (Test-Path $Key)) "uninstall left the Installed apps entry"
    Assert (-not (Test-Path (Join-Path $ConfigDir "install.json"))) "uninstall left the install record"
    Assert (Test-Path (Join-Path $ConfigDir "config.toml")) "uninstall removed user settings"

    Write-Host "Windows installer integration test passed" -ForegroundColor Green
}
finally {
    Remove-Item Function:\Invoke-WebRequest, Function:\Invoke-RestMethod -ErrorAction SilentlyContinue
}
