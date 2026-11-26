/** What a Teammate's mascot is acting out. Each one has a matching pose in `mascot.css`. */
export type MascotActivity =
  | "idle"
  /** Busy with nothing more specific to show: the mascot turns into dots. */
  | "working"
  | "thinking"
  | "planning"
  | "typing"
  | "reading"
  | "searching"
  | "talking"
  | "waiting"
  | "sleeping"
  /** Celebrates once if the mascot was just busy, otherwise looks idle. */
  | "done";

const TOOLS: Partial<Record<MascotActivity, readonly string[]>> = {
  planning: ["save_memory", "schedule_task", "cancel_scheduled_task", "add_task_dependency", "create_monitor", "learn_workflow", "propose_skill", "set_my_role", "evaluate_agent"],
  reading: ["read_file", "list_directory", "analyze_codebase", "inspect_project", "file_metadata", "count_lines", "recall_memory", "list_skills", "load_skill", "list_routines", "load_routine", "list_scheduled_tasks", "execution_metrics", "git_status", "git_diff", "git_changes", "git_log", "git_show", "git_blame", "git_branches", "github_get_repository", "github_get_pull_request", "github_get_pull_request_files", "github_list_issues", "github_list_pull_requests", "github_list_pull_request_reviews", "github_list_workflow_runs"],
  searching: ["web_search", "fetch_url", "http_request", "browser_automate", "search_files", "find_files", "find_symbols", "find_references", "find_todos"],
  talking: ["message_user", "message_teammate", "delegate_task", "get_delegated_task", "list_delegated_tasks", "list_teammates", "list_teams", "create_team", "add_team_member"],
  waiting: ["ask_question"],
  // A progress note for the title bar is not an activity of its own.
  thinking: ["set_titlebar_status"],
};

const BY_TOOL = new Map(Object.entries(TOOLS).flatMap(([activity, names]) => names.map((name) => [name, activity as MascotActivity] as const)));

/** Commands, file edits and anything unknown (plugins, MCP) are hands-on-keyboard work. */
export function activityForTool(name: string): MascotActivity {
  return BY_TOOL.get(name) ?? "typing";
}
