import { useEffect, useMemo, useState } from "react";
import { describeToolResult, type ResultSection } from "../utils/describeToolResult";
import "./ToolCalls.css";

export type ToolCallData = {
  id: string;
  name: string;
  input: string;
  durationMs?: number;
  finished?: boolean;
  failed?: boolean;
  diff?: string;
  output?: string;
  error?: string;
};

type Field = { label: string; value: string; mono?: boolean; block?: boolean };
type Description = { verb: string; target: string; fields: Field[] };

const PATH_KEYS = ["path", "file_path", "filePath", "target", "directory", "dir"];
const BLOCK_THRESHOLD = 160;

function humanize(key: string) {
  const text = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function parseInput(input: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(input);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function firstText(data: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = text(data[key]);
    if (value) return value;
  }
  return null;
}

function shorten(value: string, max = 80) {
  const single = value.replace(/\s+/g, " ").trim();
  return single.length > max ? `${single.slice(0, max - 1)}…` : single;
}

function lineCount(value: string) {
  return value.split("\n").length;
}

function fieldFor(key: string, value: unknown): Field | null {
  if (value === null || value === undefined || value === "") return null;
  const label = humanize(key);
  if (typeof value === "string") {
    const multiline = value.includes("\n") || value.length > BLOCK_THRESHOLD;
    return { label, value, mono: multiline || PATH_KEYS.includes(key) || /^(https?:|\/|\.\/|~)/.test(value), block: multiline };
  }
  if (typeof value === "number" || typeof value === "boolean") return { label, value: String(value) };
  return { label, value: JSON.stringify(value, null, 2), mono: true, block: true };
}

function genericFields(data: Record<string, unknown>, skip: string[] = []) {
  return Object.entries(data)
    .filter(([key]) => !skip.includes(key))
    .flatMap(([key, value]) => fieldFor(key, value) ?? []);
}

/** Turns a raw tool name and JSON input into a readable verb, target and labelled fields. */
/** Older and simpler tools take a bare string; give it the field the tool means. */
function plainInputData(name: string, input: string): Record<string, unknown> | null {
  const text = input.trim();
  if (!text) return null;
  switch (name) {
    case "run_command": return { command: text };
    case "read_file": case "list_directory": case "write_file": case "patch_file": case "find_files": return { path: text };
    case "search_files": return { pattern: text };
    case "web_search": return { query: text };
    case "fetch_url": return { url: text };
    default: return null;
  }
}

export function describeTool(name: string, input: string): Description {
  const description = describeToolFields(name, input);
  // One field that the row already shows in full adds nothing.
  if (description.fields.length === 1 && description.target && !description.target.endsWith("…") && description.target.includes(description.fields[0].value.trim())) {
    return { ...description, fields: [] };
  }
  return description;
}

function describeToolFields(name: string, input: string): Description {
  const data = parseInput(input) ?? plainInputData(name, input);
  // MCP tools arrive as mcp__server__tool; show just the tool part.
  const fallbackVerb = humanize(name.replace(/^mcp__[^_]+(?:_[^_]+)*?__/, "").replace(/^mcp_/, ""));
  if (!data) return { verb: fallbackVerb, target: input ? shorten(input, 60) : "", fields: input ? [{ label: "Input", value: input, mono: true, block: true }] : [] };

  const path = firstText(data, PATH_KEYS);
  switch (name) {
    case "read_file":
      return { verb: "Read", target: path ?? "", fields: genericFields(data) };
    case "list_directory":
      return { verb: "Listed", target: path ?? ".", fields: genericFields(data) };
    case "search_files": {
      const query = firstText(data, ["pattern", "query", "regex", "text"]);
      return { verb: "Searched", target: query ? `“${shorten(query, 48)}”${path ? ` in ${path}` : ""}` : path ?? "", fields: genericFields(data) };
    }
    case "write_file": {
      const content = text(data.content);
      const fields = genericFields(data, ["content"]);
      if (content) fields.push({ label: `Content · ${lineCount(content)} ${lineCount(content) === 1 ? "line" : "lines"}`, value: content, mono: true, block: true });
      return { verb: "Wrote", target: path ?? "", fields };
    }
    case "patch_file":
      return { verb: "Edited", target: path ?? "", fields: genericFields(data) };
    case "run_command": {
      const command = firstText(data, ["command", "cmd"]);
      return { verb: "Ran", target: command ? shorten(command, 72) : "", fields: [...(command ? [{ label: "Command", value: command, mono: true, block: true }] : []), ...genericFields(data, ["command", "cmd"])] };
    }
    case "web_search": {
      const query = firstText(data, ["query", "q"]);
      return { verb: "Searched the web", target: query ? `“${shorten(query, 60)}”` : "", fields: genericFields(data) };
    }
    case "fetch_url":
    case "http_request": {
      const url = firstText(data, ["url"]);
      const method = text(data.method)?.toUpperCase();
      return { verb: name === "fetch_url" ? "Fetched" : method ? `${method} request to` : "Requested", target: url ?? "", fields: genericFields(data) };
    }
    default: {
      const target = path ?? firstText(data, ["query", "name", "title", "url", "command", "id"]) ?? "";
      return { verb: fallbackVerb, target: shorten(target, 72), fields: genericFields(data) };
    }
  }
}

export function formatDuration(durationMs: number) {
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`;
  const seconds = durationMs / 1000;
  return seconds < 60 ? `${seconds.toFixed(seconds < 10 ? 1 : 0)} s` : `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;
}

function DiffView({ diff }: { diff: string }) {
  return <pre className="luma-toolcall-diff" aria-label="Changes">{diff.split("\n").map((line, index) => {
    const kind = line.startsWith("+") && !line.startsWith("+++") ? "add" : line.startsWith("-") && !line.startsWith("---") ? "del" : line.startsWith("@@") ? "hunk" : "ctx";
    return <span key={index} data-kind={kind}>{line || " "}{"\n"}</span>;
  })}</pre>;
}

function FieldValue({ field }: { field: Field }) {
  if (!field.block) return <dd className={field.mono ? "is-mono" : undefined}>{field.value}</dd>;
  const lines = lineCount(field.value);
  // Long values stay collapsed so one big file or payload doesn't swamp the row.
  const collapsedByDefault = lines > 6 || field.value.length > 400;
  return <dd><details open={!collapsedByDefault} className="luma-toolcall-block">
    <summary>{collapsedByDefault ? `Show ${lines} ${lines === 1 ? "line" : "lines"}` : "Value"}</summary>
    <pre>{field.value}</pre>
  </details></dd>;
}

function ResultText({ label, text, tone }: { label?: string; text: string; tone?: "error" }) {
  const count = lineCount(text);
  const collapsed = count > 8 || text.length > 600;
  return <div className="luma-toolcall-result-block" data-tone={tone}>
    {label && <span className="luma-toolcall-sub">{label}</span>}
    <details className="luma-toolcall-block" open={!collapsed}>
      <summary>{`Show ${count} ${count === 1 ? "line" : "lines"}`}</summary>
      <pre>{text}</pre>
    </details>
  </div>;
}

function ResultSectionView({ section }: { section: ResultSection }) {
  switch (section.kind) {
    case "message":
      return <p className="luma-toolcall-message">{section.text}</p>;
    case "diff":
      return <DiffView diff={section.text} />;
    case "text":
      return <ResultText label={section.label} text={section.text} tone={section.tone} />;
    case "list": {
      const long = section.items.length > 12;
      const items = <ul className="luma-toolcall-list-items">{section.items.map((item, index) => <li key={`${item}-${index}`} data-folder={item.endsWith("/")}>{item}</li>)}</ul>;
      return <div className="luma-toolcall-result-block">
        {section.label && <span className="luma-toolcall-sub">{section.label}</span>}
        {long ? <details className="luma-toolcall-block"><summary>{`Show all ${section.items.length}`}</summary>{items}</details> : items}
      </div>;
    }
    case "matches":
      return <div className="luma-toolcall-matches">
        {section.groups.slice(0, 40).map((group) => <div key={group.file} className="luma-toolcall-match-file">
          <span className="luma-toolcall-file">{group.file}</span>
          {group.lines.slice(0, 12).map((entry, index) => <div key={`${entry.line}-${index}`} className="luma-toolcall-match-line"><span>{entry.line}</span><code>{entry.text || " "}</code></div>)}
          {group.lines.length > 12 && <span className="luma-toolcall-more">{`and ${group.lines.length - 12} more in this file`}</span>}
        </div>)}
        {section.groups.length > 40 && <span className="luma-toolcall-more">{`and ${section.groups.length - 40} more files`}</span>}
      </div>;
  }
}

export function ToolCallRow({ tool }: { tool: ToolCallData }) {
  const [open, setOpen] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const description = describeTool(tool.name, tool.input);
  const finished = tool.finished ?? tool.durationMs !== undefined;
  const result = useMemo(() => (finished ? describeToolResult(tool.name, tool.output, tool.error, tool.failed) : null), [finished, tool.name, tool.output, tool.error, tool.failed]);
  const failed = Boolean(tool.failed) || result?.tone === "error";
  const hasDetails = description.fields.length > 0 || Boolean(tool.diff) || Boolean(result && (result.sections.length > 0 || result.hint));
  const state = failed ? "failed" : finished ? "finished" : "running";
  const label = `${description.verb}${description.target ? ` ${description.target}` : ""}`;

  // A failure is the one thing worth seeing without asking, so it opens itself once.
  useEffect(() => { if (failed && hasDetails) setOpen(true); }, [failed, hasDetails]);

  return <div className="luma-toolcall" data-state={state} role="listitem" aria-label={`${label}, ${state}${result ? `: ${result.summary}` : ""}`}>
    <button type="button" className="luma-toolcall-head" aria-expanded={hasDetails ? open : undefined} disabled={!hasDetails} onClick={() => setOpen((value) => !value)}>
      <span className="luma-toolcall-dot" aria-hidden="true" />
      <span className="luma-toolcall-verb">{description.verb}</span>
      {description.target && <span className="luma-toolcall-target" title={description.target}>{description.target}</span>}
      <span className="luma-toolcall-meta">
        {result?.summary && <span className="luma-toolcall-summary" data-tone={result.tone} title={result.summary}>{result.summary}</span>}
        {!result && tool.failed && <span className="luma-toolcall-failed">Failed</span>}
        {!finished ? <span>Running…</span> : tool.durationMs !== undefined && <span>{formatDuration(tool.durationMs)}</span>}
      </span>
      {hasDetails && <svg className="luma-toolcall-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>}
    </button>
    {open && hasDetails && <div className="luma-toolcall-body">
      {result?.hint && <p className="luma-toolcall-hint">{result.hint}</p>}
      {tool.diff && <DiffView diff={tool.diff} />}
      {result?.sections.map((section, index) => <ResultSectionView key={index} section={section} />)}
      {description.fields.length > 0 && <div className="luma-toolcall-request">
        <span className="luma-toolcall-sub">Request</span>
        <dl className="luma-toolcall-fields">
          {description.fields.map((field) => <div key={field.label}><dt>{field.label}</dt><FieldValue field={field} /></div>)}
        </dl>
      </div>}
      {(tool.input || tool.output || tool.error) && <button type="button" className="luma-toolcall-raw-toggle" onClick={() => setShowRaw((value) => !value)}>{showRaw ? "Hide raw data" : "Show raw data"}</button>}
      {showRaw && <>
        {tool.input && <pre className="luma-toolcall-raw">{tool.input}</pre>}
        {(tool.output || tool.error) && <pre className="luma-toolcall-raw">{tool.error ?? tool.output}</pre>}
      </>}
    </div>}
  </div>;
}

export function ToolCallList({ tools, label = "Tool activity" }: { tools: ToolCallData[]; label?: string }) {
  return <div className="luma-toolcall-list" role="list" aria-label={label}>
    {tools.map((tool) => <ToolCallRow key={tool.id} tool={tool} />)}
  </div>;
}
