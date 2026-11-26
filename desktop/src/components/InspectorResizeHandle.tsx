import { useState } from "react";

const STORAGE_KEY = "luma.inspector-width";
const CSS_VAR = "--luma-inspector-width";
const MIN_WIDTH = 260;
const MAX_WIDTH = 720;
const DEFAULT_WIDTH = 360;

function maxWidth() {
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(window.innerWidth * 0.6)));
}

function clamp(width: number) {
  return Math.max(MIN_WIDTH, Math.min(maxWidth(), Math.round(width)));
}

function readStoredWidth() {
  try {
    const saved = Number(window.localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(saved) && saved >= MIN_WIDTH ? clamp(saved) : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

function applyWidth(width: number) {
  document.documentElement.style.setProperty(CSS_VAR, `${width}px`);
}

// Apply the saved width before the first inspector paints.
applyWidth(readStoredWidth());

/** Drag handle on the left edge of the right-hand inspector panes (Code and Teammates). */
export default function InspectorResizeHandle() {
  const [width, setWidth] = useState(readStoredWidth);

  function update(next: number, persist: boolean) {
    const value = clamp(next);
    setWidth(value);
    applyWidth(value);
    if (persist) {
      try { window.localStorage.setItem(STORAGE_KEY, String(value)); } catch { /* Keep the width for this session. */ }
    }
  }

  return <div
    className="luma-inspector-resize"
    role="separator"
    aria-orientation="vertical"
    aria-label="Resize inspector"
    aria-valuemin={MIN_WIDTH}
    aria-valuemax={MAX_WIDTH}
    aria-valuenow={width}
    tabIndex={0}
    onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.dataset.dragging = "true"; }}
    onPointerMove={(event) => {
      if (event.currentTarget.dataset.dragging !== "true") return;
      const pane = event.currentTarget.parentElement;
      if (pane) update(pane.getBoundingClientRect().right - event.clientX, false);
    }}
    onPointerUp={(event) => {
      event.currentTarget.dataset.dragging = "false";
      update(width, true);
    }}
    onPointerCancel={(event) => { event.currentTarget.dataset.dragging = "false"; }}
    onKeyDown={(event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      update(width + (event.key === "ArrowLeft" ? 16 : -16), true);
    }}
    onDoubleClick={() => update(DEFAULT_WIDTH, true)}
  />;
}
