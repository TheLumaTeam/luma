/** `luma update`: runs the current installer against this installation. */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPOSITORY = "TheLumaTeam/luma";
const SCRIPTS = `https://raw.githubusercontent.com/${REPOSITORY}/main/scripts`;

/**
 * The most recently published release, pre-releases included: the same rule the
 * installers apply.
 */
export function latestRelease(releases: unknown): string | null {
  if (!Array.isArray(releases)) return null;
  let newest = "";
  let latest: string | null = null;
  for (const release of releases as Array<Record<string, unknown> | null>) {
    const { tag_name: tag, draft, published_at: published } = release ?? {};
    if (draft !== true && typeof tag === "string" && typeof published === "string" && published > newest) {
      newest = published;
      latest = tag;
    }
  }
  return latest;
}

export function releaseTag(version: string): string {
  const tag = version.startsWith("v") ? version : `v${version}`;
  if (!/^v\d+\.\d+\.\d+([.-][A-Za-z0-9.-]+)?$/.test(tag)) {
    throw new Error(`"${version}" is not a release version, such as 1.2.3.`);
  }
  return tag;
}

export function installerEnvironment(env: NodeJS.ProcessEnv, version?: string): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { ...env };
  // `luma` exports the running version, which the installer would treat as a pin.
  delete result.LUMA_VERSION;
  if (version) result.LUMA_VERSION = version;
  if (!result.LUMA_BIN_DIR && result.LUMA_INSTALLED_BIN_DIR) {
    result.LUMA_BIN_DIR = result.LUMA_INSTALLED_BIN_DIR;
  }
  result.LUMA_SKIP_SETUP ??= "1";
  return result;
}

/**
 * Windows cannot replace a running program, so a new window waits for this
 * process to exit before it runs the installer.
 */
export function windowsUpdateArguments(script: string, waitFor: number): string[] {
  const quoted = `'${script.replaceAll("'", "''")}'`;
  const command = [
    `Wait-Process -Id ${waitFor} -ErrorAction SilentlyContinue`,
    `try { & ${quoted} } catch { Write-Host $_ -ForegroundColor Red }`,
    "Read-Host 'Press Enter to close'",
  ].join("; ");
  return ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command];
}

function installedVersion(env: NodeJS.ProcessEnv): string {
  const home = env.LUMA_HOME;
  if (!home || !existsSync(join(home, "bundle.json"))) {
    throw new Error("This works only for a Luma installed by the installer.");
  }
  const bundle = JSON.parse(readFileSync(join(home, "bundle.json"), "utf8")) as { version?: unknown };
  return releaseTag(String(bundle.version));
}

async function download(url: string): Promise<Response> {
  const response = await fetch(url, { headers: { "User-Agent": "Luma" } });
  if (!response.ok) throw new Error(`Could not download ${url} (HTTP ${response.status}).`);
  return response;
}

async function newestRelease(): Promise<string> {
  const response = await download(`https://api.github.com/repos/${REPOSITORY}/releases?per_page=30`);
  const latest = latestRelease(await response.json());
  if (!latest) throw new Error("Could not find a published Luma release.");
  return releaseTag(latest);
}

async function runInstaller(version: string): Promise<void> {
  const windows = process.platform === "win32";
  const name = windows ? "install.ps1" : "install.sh";
  const source = await (await download(`${SCRIPTS}/${name}`)).text();
  const directory = await mkdtemp(join(tmpdir(), "luma-update-"));
  const script = join(directory, name);
  await writeFile(script, source, { mode: 0o700 });
  const env = installerEnvironment(process.env, version);

  if (windows) {
    spawn("powershell.exe", windowsUpdateArguments(script, process.pid), {
      env,
      detached: true,
      stdio: "ignore",
    }).unref();
    console.log("The installer continues in a new window. Quit Luma Desktop if it is open.");
    return;
  }

  // Ctrl+C reaches the installer too. Stay alive while it restores.
  const ignore = () => {};
  process.on("SIGINT", ignore);
  try {
    const result = spawnSync("bash", [script], { env, stdio: "inherit" });
    if (result.status !== 0) throw new Error("The installer did not finish.");
  } finally {
    process.off("SIGINT", ignore);
    await rm(directory, { recursive: true, force: true });
  }
}

export async function update(options: { check?: boolean; version?: string }): Promise<void> {
  const current = installedVersion(process.env);
  const target = options.version ? releaseTag(options.version) : await newestRelease();
  if (options.check) {
    console.log(
      current === target
        ? `Luma ${current} is up to date.`
        : `Installed: ${current}. Latest: ${target}. Run: luma update`,
    );
    return;
  }
  if (current === target && !options.version) {
    console.log(`Luma ${current} is already the latest release.`);
    return;
  }
  console.log(`Installing Luma ${target} (currently ${current}).`);
  await runInstaller(target);
}

/** Reinstalls the installed release, which restores its tools and shortcuts. */
export async function repair(): Promise<void> {
  const current = installedVersion(process.env);
  console.log(`Reinstalling Luma ${current} to repair it.`);
  await runInstaller(current);
}
