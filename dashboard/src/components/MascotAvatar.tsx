import { useMemo, type CSSProperties } from "react";
import { getMascotAppearance } from "../../../shared/mascot";
import type { MascotActivity } from "../../../shared/mascotActivity";
import { renderMascotArt } from "../../../shared/mascotArt";
import "../../../shared/mascot.css";

export function MascotAvatar({ seed, mascot, label, size = 38, active = false, activity = "idle" }: {
  seed: string;
  mascot?: string;
  label?: string;
  size?: number;
  /** Breathe and blink. */
  active?: boolean;
  activity?: MascotActivity;
}) {
  const appearance = getMascotAppearance(mascot ?? "auto", seed);
  const key = JSON.stringify(appearance);
  const art = useMemo(() => ({ __html: renderMascotArt(JSON.parse(key)) }), [key]);
  return (
    <span className={`luma-mascot-stage is-${activity}${active || activity !== "idle" ? " is-lively" : ""}`}
      style={{ width: size, height: size, "--m-color": appearance.color } as CSSProperties}
      role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <svg className="luma-mascot-svg" width={size} height={size} viewBox="0 0 48 48" focusable="false" dangerouslySetInnerHTML={art} />
    </span>
  );
}
