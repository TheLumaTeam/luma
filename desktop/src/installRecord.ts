/**
 * What the installer recorded about this computer's Luma installation.
 * Core writes `install.json` (see `src/install.rs`); Desktop only reads it.
 */
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

export type InstallRecord = { lumaHome?: string; userName?: string; defaultWorkspace?: string };

/** A record that is missing or unreadable must never stop the app. */
export function readInstallRecord(configDirectory: string): InstallRecord {
  let saved: Record<string, unknown>;
  try {
    saved = JSON.parse(readFileSync(path.join(configDirectory, "install.json"), "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
  const record: InstallRecord = {};
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : undefined);
  const lumaHome = text(saved?.luma_home);
  const userName = text(saved?.user_name);
  const workspace = text(saved?.default_workspace);
  if (lumaHome) record.lumaHome = lumaHome;
  if (userName) record.userName = userName;
  if (workspace) record.defaultWorkspace = workspace;
  return record;
}

/** The installed Core: where the installer put it, else the default location. */
export function findInstalledCore(
  record: InstallRecord,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  userHome: string,
): string | null {
  const binaryName = platform === "win32" ? "luma-core.exe" : "luma-core";
  const defaultHome = platform === "win32"
    ? env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Luma")
    : path.join(userHome, ".local", "share", "luma");
  for (const home of [record.lumaHome, defaultHome]) {
    if (!home) continue;
    const candidate = path.join(home, "bin", binaryName);
    if (isKind(candidate, "file")) return candidate;
  }
  return null;
}

export function defaultWorkspace(record: InstallRecord, userHome: string): string {
  const recorded = record.defaultWorkspace;
  return recorded && isKind(recorded, "directory") ? recorded : userHome;
}

function isKind(target: string, kind: "file" | "directory"): boolean {
  try {
    const stat = statSync(target);
    return kind === "file" ? stat.isFile() : stat.isDirectory();
  } catch {
    return false;
  }
}
