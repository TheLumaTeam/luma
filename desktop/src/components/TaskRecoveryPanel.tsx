import type { TaskActionRecord } from "../../../shared/protocol";
import ErrorNotice from "./ErrorNotice";

const MIN_ACKNOWLEDGEMENT = 8;

type TaskRecoveryPanelProps = {
  actions: TaskActionRecord[];
  loading: boolean;
  error: string;
  acknowledgement: string;
  busy: boolean;
  onAcknowledgementChange: (value: string) => void;
  onReload: () => void;
  onReconcile: () => void;
  onRetry: () => void;
  onClose: () => void;
};

function actionStatusLabel(status: string) {
  const text = status.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export default function TaskRecoveryPanel({
  actions, loading, error, acknowledgement, busy,
  onAcknowledgementChange, onReload, onReconcile, onRetry, onClose,
}: TaskRecoveryPanelProps) {
  const needsReview = actions.some((action) => action.reconciliation === null);
  const trimmedLength = acknowledgement.trim().length;
  const tooShort = trimmedLength < MIN_ACKNOWLEDGEMENT;

  return <div className="luma-recovery-panel">
    <div className="luma-recovery-heading">
      <div>
        <strong>Recovery journal</strong>
        <span>{actions.length} recorded {actions.length === 1 ? "action" : "actions"}</span>
      </div>
      {!loading && !error && <span className="luma-recovery-status" data-state={needsReview ? "review" : "ready"}>{needsReview ? "Review required" : "Ready to retry"}</span>}
    </div>

    {loading ? <p className="luma-inspector-empty" role="status">Loading recorded actions…</p>
      : error ? <ErrorNotice error={error} fallbackTitle="Couldn't load the recovery journal" onRetry={onReload} />
      : actions.length === 0 ? <p className="luma-inspector-empty">No tool actions were recorded for this task. You can retry it when you're ready.</p>
      : <div className="luma-recovery-timeline">{actions.map((action) => <article key={action.id} className="luma-recovery-action">
        <div className="luma-recovery-action-heading">
          <span className="luma-recovery-sequence">{action.sequence}</span>
          <strong>{action.tool_name}</strong>
          <span data-reconciled={Boolean(action.reconciliation)}>{action.reconciliation ? "Reconciled" : actionStatusLabel(action.status)}</span>
        </div>
        <details><summary>Input <span>{action.input.length.toLocaleString()} characters</span></summary><pre>{action.input || "No input recorded."}</pre></details>
        {action.output && <details><summary>Output <span>{action.output.length.toLocaleString()} characters</span></summary><pre>{action.output}</pre></details>}
        {action.reconciliation && <p className="luma-recovery-reconciliation">Reconciliation: {action.reconciliation}</p>}
      </article>)}</div>}

    {!loading && !error && needsReview && <div className="luma-recovery-form">
      <label>
        <span>Describe how you checked the recorded actions and current state</span>
        <textarea
          className="luma-input"
          value={acknowledgement}
          onChange={(event) => onAcknowledgementChange(event.target.value)}
          rows={3}
          placeholder="I checked the repository and confirmed the recorded changes are already present…"
        />
      </label>
      {trimmedLength > 0 && tooShort && <small>At least {MIN_ACKNOWLEDGEMENT} characters</small>}
    </div>}

    <div className="luma-recovery-footer">
      <button type="button" className="luma-inspector-action is-ghost" onClick={onClose}>Close</button>
      {loading ? null
        : error ? <button type="button" className="luma-inspector-action" onClick={onReload}>Reload recovery journal</button>
        : needsReview ? <button type="button" className="luma-inspector-action is-primary" disabled={busy || tooShort} onClick={onReconcile}>Confirm reconciliation</button>
        : <button type="button" className="luma-inspector-action is-primary" disabled={busy} onClick={onRetry}>Retry task</button>}
    </div>
  </div>;
}
