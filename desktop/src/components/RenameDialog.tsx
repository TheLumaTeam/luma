import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "../hooks/useFocusTrap";
import "./CommandSurfaces.css";

/** In-app replacement for window.prompt, which Electron does not implement. */
export default function RenameDialog({ title, label, initialValue, onSubmit, onClose }: {
  title: string;
  label: string;
  initialValue: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const inputId = `luma-rename-${useId().replace(/:/g, "")}`;
  const panelRef = useFocusTrap<HTMLFormElement>(true);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  const trimmed = value.trim();
  return createPortal(
    <div className="luma-command-output-backdrop luma-command-surfaces" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <form ref={panelRef} className="luma-command-query-panel" role="dialog" aria-modal="true" aria-label={title} onSubmit={(event) => {
        event.preventDefault();
        if (trimmed) onSubmit(trimmed);
      }}>
        <div className="luma-command-query-heading"><span>RENAME</span><label htmlFor={inputId}>{title}</label></div>
        <input id={inputId} autoFocus data-autofocus value={value} onChange={(event) => setValue(event.target.value)} onFocus={(event) => event.currentTarget.select()} placeholder={label} maxLength={120} autoComplete="off" spellCheck={false} />
        <footer><button type="button" onClick={onClose}>Cancel</button><button type="submit" disabled={!trimmed}>Rename</button></footer>
      </form>
    </div>,
    document.body,
  );
}
