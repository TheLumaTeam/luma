import type { ApprovalRecord } from "../../../shared/protocol";
import "./ApprovalCard.css";

const ASKS: Record<string, string> = {
  approve_plan: "wants you to approve a plan",
  run_command: "wants to run a command",
  write_file: "wants to write a file",
  patch_file: "wants to edit a file",
  http_request: "wants to send a web request",
  delegate_task: "wants to hand work to a teammate",
  message_teammate: "wants to message a teammate",
  schedule_task: "wants to schedule something",
  set_my_role: "wants to set its role",
  cancel_scheduled_task: "wants to cancel a schedule",
};

/** A permission request, shown in the conversation where the work is waiting. */
export function ApprovalCard({ approval, teammate, busy, onResolve }: {
  approval: ApprovalRecord;
  teammate: string;
  busy: boolean;
  onResolve: (allowed: boolean) => void;
}) {
  const ask = ASKS[approval.tool] ?? `wants to use ${approval.tool.replace(/[_-]+/g, " ")}`;
  return <div className="luma-approval-card" role="group" aria-label={`${teammate} ${ask}`}>
    <div className="luma-approval-card-title">{teammate} {ask}</div>
    <pre className="luma-approval-card-detail">{approval.arguments}</pre>
    <div className="luma-approval-card-actions">
      <button type="button" className="luma-btn-primary" disabled={busy} onClick={() => onResolve(true)}>{approval.tool === "approve_plan" ? "Approve plan" : "Allow once"}</button>
      <button type="button" className="luma-btn-secondary" disabled={busy} onClick={() => onResolve(false)}>Deny</button>
    </div>
  </div>;
}
