import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import "./CommandSurfaces.css";

type CommandOutputDialogProps = {
  title: string;
  content: string;
  onClose: () => void;
  onRefresh?: () => void | Promise<void>;
  onOpenFile?: (path: string) => void;
};

export default function CommandOutputDialog({ title, content, onClose, onRefresh, onOpenFile }: CommandOutputDialogProps) {
  const panelRef = useFocusTrap(true);
  const fileResults = useMemo(() => {
    if (title !== "/find") return null;
    try {
      const parsed: unknown = JSON.parse(content);
      return Array.isArray(parsed) ? parsed.filter((item): item is { path: string; score: number } =>
        typeof item === "object" && item !== null && typeof item.path === "string" && typeof item.score === "number") : null;
    } catch {
      return null;
    }
  }, [content, title]);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const refreshingRef = useRef(false);
  const refresh = useCallback(async () => {
    if (!onRefresh || refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    setRefreshError(false);
    try {
      await onRefresh();
    } catch {
      setRefreshError(true);
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }, [onRefresh]);
  useEffect(() => {
    if (!onRefresh) return;
    const interval = window.setInterval(() => { void refresh(); }, 5_000);
    return () => window.clearInterval(interval);
  }, [refresh, onRefresh]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  return <div className="luma-command-output-backdrop luma-command-surfaces" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <section ref={panelRef} className="luma-command-output-panel" role="dialog" aria-modal="true" aria-label={`${title} output`}>
      <header>
        <div><span>CORE COMMAND</span><h2>{title}</h2></div>
        <button type="button" onClick={onClose} aria-label="Close command output">×</button>
      </header>
      {title === "/find" && fileResults !== null ? fileResults.length > 0 ? <>
        <div className="luma-command-output-summary"><strong>{fileResults.length} {fileResults.length === 1 ? "file" : "files"} found</strong><span>Select a result to open it in the workspace.</span></div>
        <div className="luma-command-file-results" role="list" aria-label="Matching workspace files">
        {fileResults.map((file) => <div key={file.path} role="listitem">
          <button type="button" onClick={() => onOpenFile?.(file.path)} disabled={!onOpenFile}>
            <span>{file.path}</span><small aria-label={`Match score ${file.score}`}>{file.score}</small>
          </button>
        </div>)}
        </div>
      </> : <div className="luma-command-output-empty" role="status"><strong>No matching files</strong><span>Try a broader search or a different query.</span></div> : <pre>{content || "No output was returned by this command."}</pre>}
      <footer><span role="status">{refreshError ? "Refresh failed · showing the latest available result" : onRefresh ? "Live Core data · refreshes every 5 seconds" : "Read-only result from Luma Core"}</span><div>{onRefresh && <button type="button" onClick={() => void refresh()} disabled={refreshing} aria-label="Refresh command output">{refreshing ? "Refreshing…" : "Refresh"}</button>}<button type="button" onClick={onClose}>Close</button></div></footer>
    </section>
  </div>;
}
