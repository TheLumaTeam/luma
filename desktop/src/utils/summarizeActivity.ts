type Activity = { name: string; failed?: boolean; durationMs?: number };

type Phrase = { doing: string; done: (count: number) => string };

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

const WEB: Phrase = { doing: "Checking the web", done: (count) => `Checked ${plural(count, "page")}` };
const SEARCH: Phrase = { doing: "Searching the web", done: (count) => (count === 1 ? "Searched the web" : `Ran ${count} web searches`) };
const FILES: Phrase = { doing: "Looking through files", done: (count) => `Looked through files ${count === 1 ? "once" : `${count} times`}` };
const EDITS: Phrase = { doing: "Editing files", done: (count) => `Made ${plural(count, "file change")}` };
const COMMANDS: Phrase = { doing: "Running a command", done: (count) => `Ran ${plural(count, "command")}` };
const RECALL: Phrase = { doing: "Checking notes", done: () => "Checked notes" };
const REMEMBER: Phrase = { doing: "Saving a note", done: () => "Saved a note" };
const DELEGATE: Phrase = { doing: "Asking a teammate", done: () => "Worked with teammates" };
const OTHER: Phrase = { doing: "Working", done: (count) => `Took ${plural(count, "other step")}` };

const PHRASES: Record<string, Phrase> = {
  web_search: SEARCH,
  fetch_url: WEB, http_request: WEB, browser_automate: WEB,
  read_file: FILES, list_directory: FILES, search_files: FILES, find_files: FILES,
  write_file: EDITS, patch_file: EDITS,
  run_command: COMMANDS,
  recall_memory: RECALL, save_memory: REMEMBER,
  delegate_task: DELEGATE, get_delegated_task: DELEGATE, list_delegated_tasks: DELEGATE, list_teammates: DELEGATE,
};

/** One plain line for a group of tool calls, such as "Searched the web · Checked 4 pages". */
export function summarizeActivity(tools: Activity[], running: boolean): string {
  // The title bar status is how a Teammate reports progress, not something it did.
  const visible = tools.filter((tool) => tool.name !== "set_titlebar_status");
  if (visible.length === 0) return running ? "Working…" : "Updated status";
  const current = running ? [...visible].reverse().find((tool) => tool.durationMs === undefined) : undefined;
  if (current) return `${(PHRASES[current.name] ?? OTHER).doing}…`;
  const counts = new Map<Phrase, number>();
  for (const tool of visible) {
    const phrase = PHRASES[tool.name] ?? OTHER;
    counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
  }
  const failed = visible.filter((tool) => tool.failed).length;
  const parts = [...counts].map(([phrase, count]) => phrase.done(count));
  if (failed > 0) parts.push(`${failed} failed`);
  return parts.join(" · ");
}
