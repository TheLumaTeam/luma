import { useEffect, useRef, useState } from "react";
import type { MascotActivity } from "../../../../shared/mascotActivity";

/** Shortest time a pose stays up. Tools can finish in milliseconds, and flicking between poses reads as a glitch. */
const MIN_POSE_MS = 1200;
/** How long an outgoing pose keeps animating while it fades. */
const FADE_MS = 520;
const CELEBRATION_MS = 1900;
const REST_DOTS_MS = 2400;
const REST_GAP_MS = 9000;

const settle = (activity: MascotActivity): MascotActivity => (activity === "done" ? "idle" : activity);

/** Turns the activity reported by the app into the pose to draw. */
export function useMascotPose(activity: MascotActivity, resting: boolean): { pose: MascotActivity; previous: MascotActivity | null } {
  // History mounts already finished, so only work seen happening is celebrated.
  const [state, setState] = useState<{ pose: MascotActivity; previous: MascotActivity | null }>(() => ({ pose: settle(activity), previous: null }));
  const [dozing, setDozing] = useState(false);
  const since = useRef(0);
  const target = useRef(activity);

  useEffect(() => {
    const finished = activity === "done" && target.current !== "done";
    target.current = activity;
    const next = finished ? "done" : settle(activity);
    // Needing an answer should not wait its turn.
    const delay = next === "waiting" ? 0 : Math.max(0, since.current + MIN_POSE_MS - Date.now());
    const timer = window.setTimeout(() => {
      setState((current) => {
        if (current.pose === next || (next === "done" && current.pose === "idle")) return current;
        since.current = Date.now();
        return { pose: next, previous: current.pose };
      });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [activity]);

  useEffect(() => {
    if (state.pose !== "done") return;
    const timer = window.setTimeout(() => setState({ pose: "idle", previous: "done" }), CELEBRATION_MS);
    return () => window.clearTimeout(timer);
  }, [state.pose]);

  useEffect(() => {
    if (!state.previous) return;
    const timer = window.setTimeout(() => setState((current) => ({ ...current, previous: null })), FADE_MS);
    return () => window.clearTimeout(timer);
  }, [state]);

  const canRest = resting && state.pose === "idle";
  useEffect(() => {
    if (!canRest || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let timer: number;
    const schedule = (asDots: boolean, delay: number) => {
      timer = window.setTimeout(() => {
        setDozing(asDots);
        schedule(!asDots, asDots ? REST_DOTS_MS : REST_GAP_MS + Math.random() * 5000);
      }, delay);
    };
    // A staggered first turn keeps several resting mascots from moving in step.
    schedule(true, 3000 + Math.random() * 4000);
    return () => { window.clearTimeout(timer); setDozing(false); };
  }, [canRest]);

  if (canRest && dozing) return { pose: "working", previous: null };
  // Coming back from a doze, the dots still need to animate on their way out.
  return { pose: state.pose, previous: state.previous ?? (canRest ? "working" : null) };
}
