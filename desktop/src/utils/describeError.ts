import { describeToolError } from "./describeToolResult";

export type ErrorKind = "auth" | "limit" | "model" | "network" | "context" | "permission" | "missing" | "response" | "core" | "provider" | "stopped" | "other";

export type ErrorDescription = {
  kind: ErrorKind;
  /** Short, plain-language statement of what happened. */
  title: string;
  /** One sentence on what to do next, when there is something to do. */
  hint: string;
  /** The original text, kept for people who need it. Empty when it adds nothing. */
  detail: string;
  severity: "error" | "warning";
};

type Rule = { kind: ErrorKind; test: RegExp; title: string; hint: string; severity?: "error" | "warning" };

const RULES: Rule[] = [
  { kind: "stopped", test: /\b(cancel+ed|aborted|interrupted by user)\b/i, title: "Stopped", hint: "Nothing more will run for this request.", severity: "warning" },
  { kind: "auth", test: /\b(401|403)\b|unauthori[sz]ed|invalid[_ ]api[_ ]key|incorrect api key|api key (is )?(missing|required|invalid|not set)|authentication/i, title: "The API key was rejected", hint: "Check the key for this provider in Settings, under Model." },
  { kind: "limit", test: /\b429\b|rate[_ ]limit|quota|insufficient[_ ]funds|credit balance|too many requests|billing/i, title: "Rate limit or usage quota reached", hint: "Wait a moment and retry, or switch to another model or provider." },
  { kind: "context", test: /context[_ ]length|maximum context|context window|too many tokens|prompt is too long|token limit/i, title: "This conversation is too long for the model", hint: "Start a new chat, or switch to a model with a larger context window." },
  { kind: "model", test: /model[^.\n]{0,60}(not found|does not exist|unavailable|not supported|unknown)|(unknown|unsupported|invalid) model|no such model/i, title: "That model isn't available", hint: "Pick a different model from the model menu." },
  { kind: "provider", test: /\b(500|502|503|504|529)\b|overloaded|service unavailable|bad gateway|internal server error|upstream/i, title: "The model provider is having trouble", hint: "This is usually temporary. Try again in a minute." },
  { kind: "network", test: /fetch failed|econnrefused|econnreset|enotfound|etimedout|timed? ?out|network|dns|unreachable|connection (refused|reset|closed)|error sending request|tls|certificate/i, title: "Can't reach the model provider", hint: "Check your connection and the endpoint URL in Settings, under Model." },
  { kind: "core", test: /core (process )?(exited|crashed|stopped|is not running|not connected)|not connected|desktop-server|protocol version|spawn .*luma-core|broken pipe/i, title: "Luma's core isn't responding", hint: "Reload Luma. If it keeps happening, check the log file in Settings." },
  { kind: "permission", test: /eacces|eperm|permission denied|operation not permitted|read-only file system|outside (of )?the workspace|path escapes/i, title: "Luma isn't allowed to do that", hint: "Check the folder's permissions, or that the path is inside this workspace." },
  { kind: "missing", test: /enoent|no such file|not found|does not exist|cannot find/i, title: "Couldn't find that file or folder", hint: "It may have been moved or deleted." },
  { kind: "response", test: /not valid json|invalid json|unexpected token|json parse|expected value|unexpected (end|response)|malformed|failed to (parse|deserialize)|missing field/i, title: "The reply wasn't in a form Luma understands", hint: "Retry the request. If it keeps happening, try a different model." },
];

function firstLine(text: string) {
  return text.split("\n").find((line) => line.trim())?.trim() ?? "";
}

function cleanLead(line: string) {
  return line.replace(/^(error|failed|failure)\s*[:\-–]\s*/i, "").replace(/^Error: /, "").trim();
}

export function describeError(raw: unknown, fallbackTitle = "Something went wrong"): ErrorDescription {
  const text = (raw instanceof Error ? raw.message : typeof raw === "string" ? raw : raw === undefined || raw === null ? "" : String(raw)).trim();
  if (!text) return { kind: "other", title: fallbackTitle, hint: "", detail: "", severity: "error" };

  // The core reports a tool that could not run as "Failed to run tool\n<tool>: <reason>".
  const toolFailure = text.match(/^Failed to run tool\n([^\s:]+): ([\s\S]*)$/);
  if (toolFailure) {
    const reason = describeToolError(toolFailure[1], toolFailure[2]);
    return { kind: "other", title: reason.title, hint: reason.hint, detail: reason.detail, severity: "error" };
  }

  const rule = RULES.find((candidate) => candidate.test.test(text));
  const lead = cleanLead(firstLine(text));
  if (rule) {
    // Keep the original wording when it is more specific than the headline.
    return { kind: rule.kind, title: rule.title, hint: rule.hint, detail: text, severity: rule.severity ?? "error" };
  }

  const multiline = text.split("\n").filter((line) => line.trim()).length > 1;
  const short = lead.length <= 110;
  return {
    kind: "other",
    title: short && lead ? lead.replace(/[.\s]+$/, "") : fallbackTitle,
    hint: "",
    detail: multiline || !short ? text : "",
    severity: "error",
  };
}
