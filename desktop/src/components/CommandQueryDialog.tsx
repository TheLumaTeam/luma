import { useEffect, useId, useState } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import "./CommandSurfaces.css";

export default function CommandQueryDialog({ title, placeholder, onClose, onRun }: {
  title: string;
  placeholder: string;
  onClose: () => void;
  onRun: (query: string) => void;
}) {
  const [query, setQuery] = useState("");
  const inputId = `luma-command-query-${useId().replace(/:/g, "")}`;
  const hintId = `${inputId}-hint`;
  const panelRef = useFocusTrap<HTMLFormElement>(true);
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
    <form ref={panelRef} className="luma-command-query-panel" role="dialog" aria-modal="true" aria-label={title} onSubmit={(event) => {
      event.preventDefault();
      if (query.trim()) onRun(query.trim());
    }}>
      <div className="luma-command-query-heading"><span>CORE COMMAND</span><label htmlFor={inputId}>{title}</label></div>
      <p id={hintId} className="luma-command-query-hint">Enter a value to run this command in the current workspace.</p>
      <input id={inputId} autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={placeholder} aria-describedby={hintId} autoComplete="off" spellCheck={false} />
      <footer><button type="button" onClick={onClose}>Cancel</button><button type="submit" disabled={!query.trim()}>Run</button></footer>
    </form>
  </div>;
}
