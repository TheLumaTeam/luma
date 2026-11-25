import { describeError } from "./describeError";

/** One readable piece of a tool's result. */
export type ResultSection =
  | { kind: "text"; label?: string; text: string; tone?: "error" }
  | { kind: "list"; label?: string; items: string[] }
  | { kind: "matches"; groups: Array<{ file: string; lines: Array<{ line: string; text: string }> }> }
  | { kind: "diff"; text: string }
  | { kind: "message"; text: string };

export type ToolResult = {
  /** A few words on how it went, shown on the tool's row: "12 matches in 4 files". */
  summary: string;
  tone: "ok" | "error" | "neutral";
  sections: ResultSection[];
  /** What to do next, for a failure. */
  hint?: string;
};

const NOUNS: Record<string, string> = {
  read_file: "read the file", list_directory: "list the folder", search_files: "search the files", find_files: "find files",
  write_file: "save the file", patch_file: "edit the file", run_command: "run the command", web_search: "search the web",
  fetch_url: "fetch the page", http_request: "make the request", git_status: "check git status", git_diff: "read the git diff",
};

function nounFor(name: string) {
  return NOUNS[name] ?? `run ${name.replace(/^mcp__[^_]+(?:_[^_]+)*?__/, "").replace(/[_-]+/g, " ")}`;
}

function plural(count: number, one: string, many = `${one}s`) {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

function lines(text: string) {
  return text.replace(/\s+$/, "").split("\n");
}

function looksLikeDiff(text: string) {
  return /^(diff --git|--- |\+\+\+ |@@ )/m.test(text) && /^[+-][^+-]/m.test(text);
}

/** Explains a tool failure in plain words. `message` is the tool's own error text. */
export function describeToolError(name: string, message: string): { title: string; hint: string; detail: string } {
  const text = message.trim();
  const noun = nounFor(name);
  const rule = (test: RegExp, title: string, hint: string) => (test.test(text) ? { title, hint, detail: text } : null);
  return (
    rule(/permission policy denied|not allowed by (the )?(permission|policy)/i, `Luma wasn't allowed to ${noun}`, "This teammate's permissions block it. You can change them in its settings, under Tools & access.")
    ?? rule(/workspace policy denied/i, "That's outside this project's workspace", "Luma only works inside the project folder. For a teammate, add the folder to its allowed workspaces in settings.")
    ?? rule(/timed out after \d+s|timed out/i, "The command took too long and was stopped", "Try a smaller step, or run it yourself in the terminal.")
    ?? rule(/is `rg` installed|ripgrep.*(not found|installed)/i, "Searching needs ripgrep", "Install ripgrep (rg) and try again.")
    ?? rule(/outside (of )?the workspace|path escapes|escapes the workspace|not within/i, "That path is outside the workspace", "Luma can only touch files inside the project folder.")
    ?? rule(/(could not|couldn't|cannot|can't|did not|didn't) find|old(_text)? .*not found|no (exact )?match|not found in file|search text/i, "The text to replace wasn't found in the file", "The file may have changed. Luma will re-read it and try again.")
    ?? rule(/failed to read|no such file|enoent|not a file|is a directory/i, "Couldn't open that file", "It may have been moved, renamed or deleted.")
    ?? rule(/failed to write|read-only file system|eacces|eperm|permission denied/i, "Couldn't save the change", "Check that the folder exists and isn't read-only.")
    ?? rule(/expects json|invalid (input|arguments|json)|missing field|unknown field|invalid (start|end) line|invalid type/i, "Luma sent the tool a request it couldn't read", "It usually corrects this on its own.")
    ?? (() => {
      const general = describeError(text);
      // describeError talks about the model provider; a tool's network failure is about the address it was given.
      if (general.kind === "network") return { title: "Couldn't reach that address", hint: "Check the address and your connection.", detail: text };
      return general.kind === "other"
        ? { title: `Couldn't ${noun}`, hint: "", detail: text }
        : { title: general.title, hint: general.hint, detail: text };
    })()
  );
}

function describeCommand(output: string): ToolResult {
  const code = output.match(/^exit code: (-?\d+|unknown)/m)?.[1];
  const section = (marker: string, next: string[]) => {
    const start = output.indexOf(`\n${marker}:\n`);
    if (start < 0) return "";
    const from = start + marker.length + 3;
    const ends = next.map((item) => output.indexOf(`\n${item}:`, from)).filter((index) => index >= 0);
    return output.slice(from, ends.length ? Math.min(...ends) : undefined).trim();
  };
  if (/^ERROR: command timed out/m.test(output)) {
    return { summary: "Timed out after 2 minutes", tone: "error", sections: [{ kind: "message", text: "The command ran too long and was stopped." }], hint: "Try a smaller step, or run it yourself in the terminal." };
  }
  if (/^ERROR: failed to spawn/m.test(output)) {
    return { summary: "Couldn't start", tone: "error", sections: [{ kind: "text", text: output.replace(/^ERROR: /, ""), tone: "error" }] };
  }
  const stdout = section("stdout", ["stderr", "command"]);
  const stderr = section("stderr", ["command"]);
  const sections: ResultSection[] = [];
  if (stdout) sections.push({ kind: "text", label: "Output", text: stdout });
  if (stderr) sections.push({ kind: "text", label: code === "0" ? "Messages" : "Errors", text: stderr, tone: code === "0" ? undefined : "error" });
  const failed = code !== undefined && code !== "0";
  const total = lines([stdout, stderr].filter(Boolean).join("\n")).filter(Boolean).length;
  const hint = code === "127" ? "That command isn't installed or isn't on the path." : code === "126" ? "That file can't be run. Check its permissions." : undefined;
  return {
    summary: failed ? `Exited with code ${code}` : total > 0 ? `Succeeded · ${plural(total, "line")} of output` : "Succeeded, no output",
    tone: failed ? "error" : "ok",
    sections,
    hint,
  };
}

function describeMatches(output: string): ToolResult {
  if (/^No matches found\.?$/i.test(output.trim())) return { summary: "No matches", tone: "neutral", sections: [] };
  const groups = new Map<string, Array<{ line: string; text: string }>>();
  let parsed = 0;
  let current = "";
  for (const raw of lines(output)) {
    const match = raw.match(/^(.+?):(\d+):(.*)$/);
    if (match) {
      parsed += 1;
      const list = groups.get(match[1]) ?? [];
      list.push({ line: match[2], text: match[3].trim() });
      groups.set(match[1], list);
    } else if (raw.trim() && !raw.startsWith("[")) {
      // ripgrep's --heading style: a bare file line followed by "12:text" lines.
      const heading = raw.match(/^(\d+)[:-](.*)$/);
      if (heading && current) {
        parsed += 1;
        const list = groups.get(current) ?? [];
        list.push({ line: heading[1], text: heading[2].trim() });
        groups.set(current, list);
      } else if (!heading) current = raw.trim();
    }
  }
  if (parsed === 0) return describeText(output);
  const files = [...groups.entries()].map(([file, list]) => ({ file, lines: list }));
  const capped = /search capped/i.test(output);
  return {
    summary: `${plural(parsed, "match", "matches")} in ${plural(files.length, "file")}${capped ? " (more not shown)" : ""}`,
    tone: "ok",
    sections: [{ kind: "matches", groups: files }],
  };
}

function describeText(output: string): ToolResult {
  const text = output.trim();
  if (!text) return { summary: "No output", tone: "neutral", sections: [] };
  const all = lines(text);
  if (looksLikeDiff(text)) {
    const added = all.filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
    const removed = all.filter((line) => line.startsWith("-") && !line.startsWith("---")).length;
    return { summary: `${added} added, ${removed} removed`, tone: "ok", sections: [{ kind: "diff", text }] };
  }
  if (all.length === 1 && text.length <= 90) return { summary: text, tone: "ok", sections: [] };
  return { summary: plural(all.length, "line"), tone: "ok", sections: [{ kind: "text", text }] };
}

function describeJson(output: string): ToolResult | null {
  const trimmed = output.trim();
  if (!/^[[{]/.test(trimmed)) return null;
  try {
    const value: unknown = JSON.parse(trimmed);
    if (Array.isArray(value)) {
      if (value.length === 0) return { summary: "Nothing found", tone: "neutral", sections: [] };
      if (value.every((item) => typeof item === "string")) return { summary: plural(value.length, "item"), tone: "ok", sections: [{ kind: "list", items: value as string[] }] };
      return { summary: plural(value.length, "item"), tone: "ok", sections: [{ kind: "text", text: JSON.stringify(value, null, 2) }] };
    }
    if (value && typeof value === "object") {
      const keys = Object.keys(value);
      return { summary: `${plural(keys.length, "field")}`, tone: "ok", sections: [{ kind: "text", text: JSON.stringify(value, null, 2) }] };
    }
  } catch { /* Not JSON after all; fall back to text. */ }
  return null;
}

/** Turns a finished tool's raw output or error into a short summary and readable sections. */
export function describeToolResult(name: string, output: string | undefined, error: string | undefined, failed: boolean | undefined): ToolResult | null {
  if (failed || error) {
    const reason = describeToolError(name, error ?? output ?? "");
    const detail = reason.detail && reason.detail !== reason.title ? reason.detail : "";
    return { summary: reason.title, tone: "error", hint: reason.hint || undefined, sections: detail ? [{ kind: "text", label: "What the tool said", text: detail, tone: "error" }] : [] };
  }
  if (output === undefined) return null;
  const text = output.trim();
  switch (name) {
    case "run_command": return describeCommand(output);
    case "search_files": return describeMatches(output);
    case "write_file": return { summary: "Saved", tone: "ok", sections: [] };
    case "patch_file": return { summary: "Edited", tone: "ok", sections: [] };
    case "list_directory":
    case "find_files": {
      const items = lines(text).filter(Boolean);
      if (items.length === 0) return { summary: name === "find_files" ? "No files found" : "Empty folder", tone: "neutral", sections: [] };
      return { summary: plural(items.length, name === "find_files" ? "file" : "item"), tone: "ok", sections: [{ kind: "list", items }] };
    }
    case "read_file": {
      const header = text.match(/^File: .*\((\d+) lines total, showing (\d+)-(\d+)\)/);
      const body = text.replace(/^File: [^\n]*\n(?:To see more[^\n]*\n)?---\n/, "");
      const count = lines(body).filter(Boolean).length;
      return {
        summary: header ? `Lines ${header[2]}–${header[3]} of ${header[1]}` : plural(count, "line"),
        tone: "ok",
        sections: body.trim() ? [{ kind: "text", text: body }] : [],
      };
    }
    default: return describeJson(output) ?? describeText(output);
  }
}
