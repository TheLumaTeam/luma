import { useCallback, useEffect, useState } from "react";
import type { BrowserView } from "../../../shared/protocol";
import "./BrowserPanel.css";

/** A Teammate's browser: what it last showed, and the switch to drive it yourself. */
export function BrowserPanel({ agentId, name }: { agentId: string; name: string }) {
  const [view, setView] = useState<BrowserView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try { setView(await window.luma.getBrowserView(agentId)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }, [agentId]);

  useEffect(() => {
    let pending: number | undefined;
    const unsubscribe = window.luma.onEvent((event) => {
      if (event.type !== "runtime_update" || pending !== undefined || !event.data.events.some((item) => item.agent_id === agentId)) return;
      pending = window.setTimeout(() => { pending = undefined; void load(); }, 400);
    });
    setView(null);
    void load();
    // The picture also changes without events, while the browser is in use.
    const timer = window.setInterval(() => void load(), 3_000);
    return () => { unsubscribe(); window.clearTimeout(pending); window.clearInterval(timer); };
  }, [agentId, load]);

  const act = async (action: () => Promise<BrowserView>) => {
    setBusy(true);
    setError("");
    try { setView(await action()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };

  const current = view?.agent_id === agentId ? view : null;
  return <section className="luma-browser-panel">
    {current?.in_control
      ? <>
        <p><strong>You have control.</strong> Use the browser window, then press I’m done. {name} can’t use it until you do.</p>
        <button type="button" className="luma-btn-primary" disabled={busy} onClick={() => void act(() => window.luma.releaseBrowser(agentId))}>{busy ? "Handing back…" : "I’m done"}</button>
      </>
      : <>
        <p>Sign-ins stay in {name}’s own browser. Take control to sign in or finish a step yourself; what you type there isn’t sent to the model, but {name} can read pages you leave open.</p>
        <button type="button" className="luma-btn-secondary" disabled={busy} onClick={() => void act(() => window.luma.takeBrowserControl(agentId))}>{busy ? "Opening…" : "Take control"}</button>
      </>}
    {error && <p role="alert" className="luma-browser-error">{error}</p>}
    {current?.image
      ? <figure>
        <img src={`data:image/jpeg;base64,${current.image}`} alt={current.title ? `Browser showing ${current.title}` : "The latest browser page"} />
        <figcaption><span>{current.title || "Untitled page"}</span><span>{current.url}</span>{current.updated_at ? <time>{new Date(current.updated_at * 1000).toLocaleString()}</time> : null}</figcaption>
      </figure>
      : <p className="luma-inspector-empty">Nothing to show yet. The picture appears once the browser is used.</p>}
    {(current?.url || current?.image) && !current?.in_control && <button type="button" className="luma-btn-ghost" disabled={busy} onClick={() => { if (window.confirm(`Sign ${name} out everywhere and clear its browser data?`)) void act(() => window.luma.clearBrowser(agentId)); }}>Clear browser data</button>}
  </section>;
}
