param(
    [string]$Version = "",
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
$Repository = "TheLumaTeam/luma"
$NodeVersion = "22.23.5"
$BunVersion = "1.4.4"
$PlaywrightVersion = "1.65.0"
$RipgrepVersion = "1.18.0"
$LumaHome = Join-Path $env:LOCALAPPDATA "Luma"
$BinDir = Join-Path $LumaHome "bin"
$Runtime = Join-Path $LumaHome "runtime"
$Api = "https://api.github.com/repos/$Repository"
$AppId = "com.thelumateam.luma"
if (-not $Version) { $Version = $env:LUMA_VERSION }

function Write-Step([string]$Message) { Write-Host "`n==> $Message" -ForegroundColor Cyan }
function Get-Download([string]$Url, [string]$Path) {
    for ($Attempt = 1; $Attempt -le 4; $Attempt++) {
        try {
            Invoke-WebRequest -Uri $Url -OutFile $Path -Headers @{ "User-Agent" = "Luma-Installer" }
            return
        } catch {
            if ($Attempt -eq 4) { throw }
            Write-Host "Download failed; retrying ($Attempt of 3)..."
            Start-Sleep -Seconds 2
        }
    }
}
function Assert-Sha256([string]$Path, [string]$Expected) {
    $Actual = (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($Actual -ne $Expected.ToLowerInvariant()) { throw "SHA-256 verification failed for $Path" }
}

# One definition serves -Uninstall and the copy saved for "Installed apps".
$UninstallScript = {
    param([switch]$Uninstall)
    $ErrorActionPreference = "Stop"
    $LumaHome = Join-Path $env:LOCALAPPDATA "Luma"
    $BinDir = Join-Path $LumaHome "bin"
    $DesktopExecutable = Join-Path $LumaHome "desktop\Luma.exe"
    if (Get-Process -Name "Luma" -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $DesktopExecutable }) {
        throw "Luma Desktop is running. Quit it, then uninstall again."
    }
    Write-Host "`n==> Removing Luma program files" -ForegroundColor Cyan
    $Core = Join-Path $BinDir "luma-core.exe"
    if (Test-Path $Core) {
        try { & $Core gateway stop | Out-Null } catch { }
    }
    Remove-Item -Force (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Luma.lnk") -ErrorAction SilentlyContinue
    Remove-Item -Force (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Luma.lnk.luma-previous") -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Luma" -ErrorAction SilentlyContinue
    Remove-Item -Force (Join-Path $env:APPDATA "luma\install.json") -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force $LumaHome -ErrorAction SilentlyContinue
    [Environment]::SetEnvironmentVariable("LUMA_HOME", $null, "User")
    $UserPath = [Environment]::GetEnvironmentVariable("Path", "User") -split ';' | Where-Object { $_ -and $_ -ne $BinDir }
    [Environment]::SetEnvironmentVariable("Path", ($UserPath -join ';'), "User")
    Write-Host "Removed Luma. User configuration and skills in %APPDATA%\luma were preserved."
}

if ($Uninstall) {
    & $UninstallScript
    return
}

# The shortcut's application ID must match the one the app sets, or Windows
# drops its notifications. WScript.Shell cannot set it.
function Set-ShortcutAppId([string]$ShortcutPath, [string]$ApplicationId) {
    if (-not ("Luma.Shortcut" -as [type])) {
        Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;

namespace Luma {
    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    public struct PropertyKey { public Guid Format; public uint Id; }

    [StructLayout(LayoutKind.Sequential)]
    public struct PropVariant { public ushort Type, R1, R2, R3; public IntPtr Value, Reserved; }

    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IPropertyStore {
        void GetCount(out uint count);
        void GetAt(uint index, out PropertyKey key);
        void GetValue(ref PropertyKey key, out PropVariant value);
        void SetValue(ref PropertyKey key, ref PropVariant value);
        void Commit();
    }

    public static class Shortcut {
        public static void SetAppId(string path, string appId) {
            var link = Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("00021401-0000-0000-C000-000000000046")));
            var file = (IPersistFile)link;
            file.Load(path, 2); // read and write
            var key = new PropertyKey { Format = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), Id = 5 };
            var value = new PropVariant { Type = 31, Value = Marshal.StringToCoTaskMemUni(appId) };
            try {
                var store = (IPropertyStore)link;
                store.SetValue(ref key, ref value);
                store.Commit();
                file.Save(path, true);
            } finally {
                Marshal.FreeCoTaskMem(value.Value);
                Marshal.FinalReleaseComObject(link);
            }
        }
    }
}
"@
    }
    [Luma.Shortcut]::SetAppId($ShortcutPath, $ApplicationId)
}

function Register-LumaApp([string]$ReleaseVersion) {
    $DesktopDirectory = Join-Path $LumaHome "desktop"
    $Executable = Join-Path $DesktopDirectory "Luma.exe"
    $StartMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
    New-Item -ItemType Directory -Force -Path $StartMenu | Out-Null
    $ShortcutPath = Join-Path $StartMenu "Luma.lnk"
    $Shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($ShortcutPath)
    $Shortcut.TargetPath = $Executable
    $Shortcut.WorkingDirectory = $env:USERPROFILE
    $Shortcut.IconLocation = "$Executable,0"
    $Shortcut.Description = "Luma coding agent and Teammates"
    $Shortcut.Save()
    try { Set-ShortcutAppId $ShortcutPath $AppId }
    catch { Write-Warning "Luma is in the Start menu, but its notifications may not appear: $_" }

    $UninstallFile = Join-Path $LumaHome "uninstall.ps1"
    $UninstallBody = $UninstallScript.ToString() + "`r`n"
    # Run from "Installed apps", the window closes at once; keep errors readable.
    "try {`r`n& {$UninstallBody}`r`n} catch { Write-Host `$_ -ForegroundColor Red; Read-Host 'Press Enter to close'; exit 1 }" |
        Set-Content -Encoding UTF8 $UninstallFile

    $Key = $UninstallKey
    New-Item -Path $Key -Force | Out-Null
    $Values = @{
        DisplayName = "Luma"
        DisplayVersion = $ReleaseVersion
        Publisher = "TheLumaTeam"
        DisplayIcon = "$Executable,0"
        InstallLocation = $LumaHome
        UninstallString = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$UninstallFile`""
    }
    foreach ($Name in $Values.Keys) {
        New-ItemProperty -Path $Key -Name $Name -Value $Values[$Name] -PropertyType String -Force | Out-Null
    }
    foreach ($Name in "NoModify", "NoRepair") {
        New-ItemProperty -Path $Key -Name $Name -Value 1 -PropertyType DWord -Force | Out-Null
    }
}

# The most recently published release, pre-releases included. GitHub's
# /releases/latest skips pre-releases, and the list is not in publication order.
function Get-LatestRelease {
    # Assigning first makes Windows PowerShell 5.1 enumerate the array.
    $Releases = Invoke-RestMethod -Uri "$Api/releases?per_page=30" -Headers @{ "User-Agent" = "Luma-Installer" }
    $Releases | Where-Object { -not $_.draft } | Sort-Object { [DateTime]$_.published_at } -Descending |
        Select-Object -First 1 -ExpandProperty tag_name
}

# --- Failure recovery ---
# Installed items are renamed aside, not deleted, until the new installation is
# complete. The pending file lists them, so even a later run can restore them.
$Pending = Join-Path $LumaHome ".install-pending"
$BackupSuffix = ".luma-previous"
$UninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Luma"

# Every file or directory that installing replaces.
function Get-ManagedPaths {
    foreach ($Name in "bin", "lib", "desktop", "runtime", "bundle.json", "LICENSE", "uninstall.ps1") {
        Join-Path $LumaHome $Name
    }
    Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Luma.lnk"
}

function Remove-Backups {
    foreach ($Path in Get-ManagedPaths) {
        if (Test-Path -LiteralPath "$Path$BackupSuffix") { Remove-Item -LiteralPath "$Path$BackupSuffix" -Recurse -Force }
    }
}

function Start-Replacement {
    New-Item -ItemType Directory -Force -Path $LumaHome | Out-Null
    Remove-Backups
    $Lines = foreach ($Path in Get-ManagedPaths) {
        $State = if (Test-Path -LiteralPath $Path) { "kept" } else { "new" }
        "$State|$Path"
    }
    # The list is complete before anything moves.
    $Lines | Set-Content -Encoding UTF8 -LiteralPath "$Pending.tmp"
    Move-Item -LiteralPath "$Pending.tmp" -Destination $Pending -Force
    foreach ($Path in Get-ManagedPaths) {
        if (Test-Path -LiteralPath $Path) { Move-Item -LiteralPath $Path -Destination "$Path$BackupSuffix" }
    }
}

# Safe to repeat: a kept item without a backup was never moved or is restored.
function Undo-Replacement {
    if (-not (Test-Path -LiteralPath $Pending)) { return }
    foreach ($Line in Get-Content -Encoding UTF8 -LiteralPath $Pending) {
        $State, $Path = $Line -split '\|', 2
        $HasBackup = Test-Path -LiteralPath "$Path$BackupSuffix"
        if (($State -eq "new" -or $HasBackup) -and (Test-Path -LiteralPath $Path)) {
            Remove-Item -LiteralPath $Path -Recurse -Force
        }
        if ($State -eq "kept" -and $HasBackup) { Move-Item -LiteralPath "$Path$BackupSuffix" -Destination $Path }
    }
    Remove-Item -LiteralPath $Pending -Force
}

function Complete-Replacement {
    # Removing the list is the point of no return.
    Remove-Item -LiteralPath $Pending -Force
    try { Remove-Backups } catch { Write-Warning "Could not remove the previous version's backup: $_" }
}

# --- Checks ---
# Download, unpacked bundle, runtimes and Chromium, with some headroom.
$RequiredFreeMB = 2500

function Assert-DiskSpace([string]$Path) {
    $Root = [IO.Path]::GetPathRoot($Path)
    try { $FreeMB = [math]::Floor(([IO.DriveInfo]::new($Root)).AvailableFreeSpace / 1MB) }
    catch { return }
    if ($FreeMB -lt $RequiredFreeMB) {
        throw "Not enough free space on ${Root}: $FreeMB MB available, $RequiredFreeMB MB needed. Free some space, or set LUMA_SKIP_PREFLIGHT=1."
    }
}

# Checks that the release workflow built the file. Checksums come from the same
# release as the bundle, so they cannot show this. Releases built before
# attestations existed fail the check, so only LUMA_REQUIRE_ATTESTATION=1
# makes a failure fatal.
function Test-Provenance([string]$Path) {
    $Required = $env:LUMA_REQUIRE_ATTESTATION -eq "1"
    $SignedIn = $false
    if (Get-Command gh -ErrorAction SilentlyContinue) {
        # Windows PowerShell turns redirected native errors into exceptions.
        try { gh auth status *> $null; $SignedIn = $LASTEXITCODE -eq 0 } catch { }
    }
    if (-not $SignedIn) {
        $Problem = "the GitHub CLI (gh) is not installed and signed in"
    } else {
        $Verified = $false
        try {
            gh attestation verify $Path --repo $Repository --signer-workflow "$Repository/.github/workflows/release.yml" *> $null
            $Verified = $LASTEXITCODE -eq 0
        } catch { }
        if ($Verified) { Write-Step "Verified build provenance"; return }
        $Problem = "its build provenance could not be verified"
        if (-not $Required) { Write-Warning "The download matches its checksum, but $Problem." }
    }
    if ($Required) { throw "LUMA_REQUIRE_ATTESTATION=1, but $Problem." }
}

function Assert-DesktopClosed {
    $Executable = Join-Path $LumaHome "desktop\Luma.exe"
    if (Get-Process -Name "Luma" -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $Executable }) {
        throw "Luma Desktop is running. Quit it, then run this installer again."
    }
}

if (-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -notin @("AMD64", "ARM64")) {
    throw "This installer currently supports 64-bit Windows x64."
}
if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { throw "Windows ARM64 bundles are not published yet; use the x64 emulation bundle only after it is available." }

Assert-DesktopClosed
if (Test-Path -LiteralPath $Pending) {
    Write-Step "An earlier install was interrupted; restoring the previous installation"
    Undo-Replacement
}

$Temp = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $Temp | Out-Null
try {
    if ($env:LUMA_SKIP_PREFLIGHT -ne "1") {
        Assert-DiskSpace $Temp
        Assert-DiskSpace $LumaHome
    }
    if (-not $Version) {
        Write-Step "Finding the latest Luma release"
        $Version = Get-LatestRelease
    }
    if ($Version -notmatch '^v\d+\.\d+\.\d+([.-][A-Za-z0-9.-]+)?$') { throw "Invalid release tag: $Version" }

    $Asset = "luma-x86_64-pc-windows-msvc.tar.gz"
    $BaseUrl = "https://github.com/$Repository/releases/download/$Version"
    Write-Step "Downloading Luma $Version"
    Get-Download "$BaseUrl/$Asset" (Join-Path $Temp $Asset)
    Get-Download "$BaseUrl/$Asset.sha256" (Join-Path $Temp "$Asset.sha256")
    $Expected = (Get-Content (Join-Path $Temp "$Asset.sha256") -Raw).Trim().Split(' ')[0]
    Assert-Sha256 (Join-Path $Temp $Asset) $Expected
    Test-Provenance (Join-Path $Temp $Asset)
    & tar.exe -xzf (Join-Path $Temp $Asset) -C $Temp
    if ($LASTEXITCODE -ne 0) { throw "Could not extract the Luma bundle." }
    $DesktopExecutable = Join-Path $Temp "luma\desktop\Luma.exe"
    if (-not (Test-Path $DesktopExecutable -PathType Leaf)) { throw "Release bundle does not contain the Windows Luma Desktop app." }

    # Releases published before the installer setup existed lack these commands.
    $Bundle = Get-Content (Join-Path $Temp "luma\bundle.json") -Raw | ConvertFrom-Json
    $SupportsSetup = $Bundle.components -contains "installer-setup"
    if ($SupportsSetup) {
        # Ask before the long downloads. The settings do not depend on them.
        $SetupDone = $false
        if ($env:LUMA_SKIP_SETUP -ne "1" -and [Environment]::UserInteractive -and -not [Console]::IsInputRedirected) {
            Write-Step "Setting up Luma"
            & (Join-Path $Temp "luma\bin\luma-core.exe") setup
            $SetupDone = $LASTEXITCODE -eq 0
            if (-not $SetupDone) { Write-Host "Setup did not finish; installation continues." }
        } else {
            Write-Step "Skipping setup"
        }
        if (-not $SetupDone) { Write-Host "Set up later in Luma Desktop, or run: `"$BinDir\luma-core.exe`" setup" }
    } else {
        Write-Step "Release $Version predates installer setup; set up Luma after installing."
    }

    $NodePlatform = "win-x64"
    $NodeArchive = "node-v$NodeVersion-$NodePlatform.zip"
    Write-Step "Installing Node.js $NodeVersion"
    Get-Download "https://nodejs.org/dist/v$NodeVersion/SHASUMS256.txt" (Join-Path $Temp "SHASUMS256.txt")
    $ChecksumLine = Get-Content (Join-Path $Temp "SHASUMS256.txt") | Where-Object { $_ -match "\s+\*?$([regex]::Escape($NodeArchive))$" } | Select-Object -First 1
    if (-not $ChecksumLine) { throw "Node.js checksum not found for $NodeArchive" }
    $NodeExpected = ($ChecksumLine -split '\s+')[0]
    Get-Download "https://nodejs.org/dist/v$NodeVersion/$NodeArchive" (Join-Path $Temp $NodeArchive)
    Assert-Sha256 (Join-Path $Temp $NodeArchive) $NodeExpected
    $NodeExtract = Join-Path $Temp "node-extract"
    Expand-Archive -Path (Join-Path $Temp $NodeArchive) -DestinationPath $NodeExtract
    $RuntimeStage = Join-Path $Temp "runtime"
    New-Item -ItemType Directory -Force -Path $RuntimeStage | Out-Null
    Move-Item (Join-Path $NodeExtract "node-v$NodeVersion-$NodePlatform") (Join-Path $RuntimeStage "node")

    $Npm = Join-Path $RuntimeStage "node\npm.cmd"
    Write-Step "Installing pinned Bun and Playwright runtimes"
    & $Npm install --prefix $RuntimeStage --no-save --no-audit --no-fund "bun@$BunVersion" "playwright@$PlaywrightVersion" "@vscode/ripgrep@$RipgrepVersion"
    if ($LASTEXITCODE -ne 0) { throw "Could not install Bun and Playwright." }
    $Node = Join-Path $RuntimeStage "node\node.exe"
    $Bun = Join-Path $RuntimeStage "node_modules\bun\bin\bun.exe"
    if ((& $Node --version) -ne "v$NodeVersion") { throw "Node.js version verification failed." }
    if ((& $Bun --version) -ne $BunVersion) { throw "Bun version verification failed." }
    $PlaywrightPackage = Join-Path $RuntimeStage "node_modules\playwright\package.json"
    if ((Get-Content $PlaywrightPackage -Raw | ConvertFrom-Json).version -ne $PlaywrightVersion) { throw "Playwright version verification failed." }

    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { throw "Git is required. Install Git for Windows, then re-run this installer." }
        winget install --id Git.Git --exact --silent --accept-package-agreements --accept-source-agreements
        if ($LASTEXITCODE -ne 0) { throw "Could not install Git for Windows." }
        $env:PATH = "$env:ProgramFiles\Git\cmd;$env:ProgramFiles\Git\bin;$env:ProgramFiles\Git\usr\bin;$env:PATH"
    }
    $Ripgrep = Join-Path $RuntimeStage "node_modules\@vscode\ripgrep-win32-x64\bin\rg.exe"
    if (-not (Test-Path $Ripgrep)) { throw "The platform-specific ripgrep binary was not installed." }
    & $Ripgrep --version | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "ripgrep verification failed." }
    git --version | Out-Null
    $PlaywrightCli = Join-Path $RuntimeStage "node_modules\playwright\cli.js"
    if (-not $env:PLAYWRIGHT_BROWSERS_PATH) { $env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $env:LOCALAPPDATA "ms-playwright" }
    $BrowsersPath = $env:PLAYWRIGHT_BROWSERS_PATH
    & $Node $PlaywrightCli install chromium
    if ($LASTEXITCODE -ne 0) { throw "Could not install Playwright Chromium." }

    Write-Step "Installing Luma Core, Ink client, embedded dashboard, and Desktop app"
    Assert-DesktopClosed
    # An old gateway would keep running the old Core, and holds its files open.
    $OldCore = Join-Path $BinDir "luma-core.exe"
    $GatewayWasRunning = $false
    if (Test-Path $OldCore) {
        try { $GatewayWasRunning = (& $OldCore gateway status) -eq "running" } catch { }
    }
    $PreviousVersion = (Get-ItemProperty -Path $UninstallKey -ErrorAction SilentlyContinue).DisplayVersion
    $Committed = $false
    try {
        if (Test-Path $OldCore) {
            try { & $OldCore gateway stop | Out-Null } catch { }
        }
        Start-Replacement
        New-Item -ItemType Directory -Force -Path $BinDir, (Join-Path $LumaHome "lib"), (Join-Path $LumaHome "desktop") | Out-Null
        Copy-Item (Join-Path $Temp "luma\bin\*") $BinDir -Recurse -Force
        Copy-Item (Join-Path $Temp "luma\lib\*") (Join-Path $LumaHome "lib") -Recurse -Force
        Copy-Item (Join-Path $Temp "luma\desktop\*") (Join-Path $LumaHome "desktop") -Recurse -Force
        Move-Item $RuntimeStage $Runtime
        Copy-Item (Join-Path $Temp "luma\bundle.json") (Join-Path $LumaHome "bundle.json") -Force
        Copy-Item (Join-Path $Temp "luma\LICENSE") (Join-Path $LumaHome "LICENSE") -Force
        $BundleVersion = (Get-Content (Join-Path $LumaHome "bundle.json") -Raw | ConvertFrom-Json).version
        @"
@echo off
set "LUMA_HOME=%LOCALAPPDATA%\Luma"
set "LUMA_INSTALLED_BIN_DIR=%LOCALAPPDATA%\Luma\bin"
set "LUMA_BINARY=%LUMA_HOME%\bin\luma-core.exe"
set "LUMA_NODE_BIN=%LUMA_HOME%\runtime\node\node.exe"
set "LUMA_PLAYWRIGHT_MODULE=%LUMA_HOME%\runtime\node_modules\playwright"
if not defined PLAYWRIGHT_BROWSERS_PATH set "PLAYWRIGHT_BROWSERS_PATH=%LOCALAPPDATA%\ms-playwright"
set "DEV=false"
set "PATH=%LUMA_HOME%\runtime\node;%LUMA_HOME%\runtime\node_modules\.bin;%LUMA_HOME%\runtime\node_modules\@vscode\ripgrep-win32-x64\bin;%ProgramFiles%\Git\cmd;%ProgramFiles%\Git\bin;%ProgramFiles%\Git\usr\bin;%PATH%"
set "LUMA_VERSION=$BundleVersion"
"%LUMA_HOME%\runtime\node_modules\bun\bin\bun.exe" "%LUMA_HOME%\lib\luma-cli.js" %*
"@ | Set-Content -Encoding ASCII (Join-Path $BinDir "luma.cmd")

        @"
@echo off
"%LOCALAPPDATA%\Luma\desktop\Luma.exe" %*
"@ | Set-Content -Encoding ASCII (Join-Path $BinDir "luma-desktop.cmd")

        Register-LumaApp $BundleVersion
        Complete-Replacement
        $Committed = $true
    }
    finally {
        # Also runs on Ctrl+C.
        if (-not $Committed) {
            Write-Host "Installation failed; restoring the previous installation." -ForegroundColor Yellow
            try {
                Undo-Replacement
                # The registry entry is not a file, so restore it separately.
                if ($PreviousVersion) {
                    Set-ItemProperty -Path $UninstallKey -Name DisplayVersion -Value $PreviousVersion
                } else {
                    Remove-Item -Path $UninstallKey -Recurse -Force -ErrorAction SilentlyContinue
                }
                if ($GatewayWasRunning) { & $OldCore gateway start | Out-Null }
                Write-Host "Restored. Fix the problem, then run this installer again."
            } catch {
                Write-Warning "Restoring did not finish. Run this installer again to retry. $_"
            }
        }
    }

    $ConfigDir = Join-Path $env:APPDATA "luma"
    $SkillsDir = Join-Path $ConfigDir "skills"
    New-Item -ItemType Directory -Force -Path $SkillsDir | Out-Null
    $DefaultSkill = Join-Path $SkillsDir "ask-question"
    if (-not (Test-Path $DefaultSkill)) {
        Copy-Item (Join-Path $Temp "luma\skills\ask-question") $DefaultSkill -Recurse
    }

    [Environment]::SetEnvironmentVariable("LUMA_HOME", $LumaHome, "User")
    $UserPath = [Environment]::GetEnvironmentVariable("Path", "User") -split ';' | Where-Object { $_ }
    if ($UserPath -notcontains $BinDir) { $UserPath += $BinDir }
    [Environment]::SetEnvironmentVariable("Path", ($UserPath -join ';'), "User")

    if ($SupportsSetup) {
        & (Join-Path $BinDir "luma-core.exe") install-record $LumaHome $BrowsersPath
        if ($LASTEXITCODE -ne 0) { Write-Host "Could not record the installation; Luma Desktop will use the default location." }
    }

    Write-Step "Luma $Version installed"
    Write-Host "Commands: luma, luma teammates, luma dashboard, luma-desktop"
    Write-Host "Runtime: Bun $BunVersion, Node.js $NodeVersion, Playwright $PlaywrightVersion + Chromium, ripgrep $RipgrepVersion, Git"
    Write-Host "Luma is installed as an application. Open it from the Start menu."
    Write-Host "For the terminal client, open a new terminal and run: luma"
}
finally {
    Remove-Item -Recurse -Force $Temp -ErrorAction SilentlyContinue
}
