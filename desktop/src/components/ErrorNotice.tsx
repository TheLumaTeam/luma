import { useState } from "react";
import { describeError, type ErrorDescription } from "../utils/describeError";
import "./ErrorNotice.css";

type ErrorNoticeProps = {
  /** The raw error, or an error already run through describeError. */
  error: unknown;
  /** Title to use when the error carries no usable text of its own. */
  fallbackTitle?: string;
  /** "block" sits in a thread, "banner" spans a pane edge to edge, "inline" is one quiet line for tight spaces. */
  variant?: "block" | "banner" | "inline";
  /** Start with the original error text visible. */
  detailsOpen?: boolean;
  /** Replaces the suggested next step when the surrounding view knows better. */
  hint?: string;
  onRetry?: () => void;
  retryLabel?: string;
  onDismiss?: () => void;
};

function Glyph({ severity }: { severity: ErrorDescription["severity"] }) {
  return severity === "warning"
    ? <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2 14.5 13.5h-13L8 2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /><path d="M8 6.5v3.2M8 11.6v.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
    : <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.3" stroke="currentColor" strokeWidth="1.4" /><path d="M8 4.8v3.9M8 11v.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>;
}

/** A calm, readable error: what happened, what to do, and the original text on request. */
export default function ErrorNotice({ error, fallbackTitle, variant = "block", detailsOpen = false, hint, onRetry, retryLabel = "Try again", onDismiss }: ErrorNoticeProps) {
  const described = describeError(error, fallbackTitle);
  const description = hint === undefined ? described : { ...described, hint };
  const [open, setOpen] = useState(detailsOpen);
  const [copied, setCopied] = useState(false);
  const hasDetail = Boolean(description.detail) && description.detail.trim() !== description.title;

  async function copy() {
    try {
      await navigator.clipboard.writeText(description.detail || description.title);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { /* Clipboard can be unavailable; the text is still selectable. */ }
  }

  if (variant === "inline") {
    return <p className="luma-error-inline" role="alert" data-severity={description.severity}>
      <Glyph severity={description.severity} />
      <span><strong>{description.title}.</strong>{description.hint ? ` ${description.hint}` : ""}</span>
    </p>;
  }

  return <div className="luma-error" role="alert" data-variant={variant} data-severity={description.severity} data-kind={description.kind}>
    <span className="luma-error-glyph"><Glyph severity={description.severity} /></span>
    <div className="luma-error-body">
      <p className="luma-error-title">{description.title}</p>
      {description.hint && <p className="luma-error-hint">{description.hint}</p>}
      {(onRetry || hasDetail) && <div className="luma-error-actions">
        {onRetry && <button type="button" className="luma-error-action is-primary" onClick={onRetry}>{retryLabel}</button>}
        {hasDetail && <button type="button" className="luma-error-action" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{open ? "Hide details" : "Show details"}</button>}
        {hasDetail && open && <button type="button" className="luma-error-action" onClick={() => void copy()}>{copied ? "Copied" : "Copy"}</button>}
      </div>}
      {hasDetail && open && <pre className="luma-error-detail">{description.detail}</pre>}
    </div>
    {onDismiss && <button type="button" className="luma-error-dismiss" aria-label="Dismiss" onClick={onDismiss}>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="m2.5 2.5 7 7m0-7-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
    </button>}
  </div>;
}
