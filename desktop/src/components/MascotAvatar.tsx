import { useMemo, type CSSProperties } from "react";
import { getMascotAppearance } from "../../../shared/mascot";
import type { MascotActivity } from "../../../shared/mascotActivity";
import { renderMascotArt } from "../../../shared/mascotArt";
import { useMascotPose } from "../renderer/hooks/useMascotPose";
import "../../../shared/mascot.css";

export function MascotAvatar({ seed, mascot, label, size = 38, activity = "idle", resting = false }: {
  seed: string;
  mascot?: string;
  label?: string;
  size?: number;
  activity?: MascotActivity;
  /** While idle, breathe and now and then melt into dots. For the one mascot in focus, not whole lists. */
  resting?: boolean;
}) {
  const appearance = getMascotAppearance(mascot ?? "auto", seed);
  const { pose, previous } = useMascotPose(activity, resting);
  // React rewrites innerHTML whenever this object changes, which would restart every
  // transition, so it only changes when the design does.
  const key = JSON.stringify(appearance);
  const art = useMemo(() => ({ __html: renderMascotArt(JSON.parse(key)) }), [key]);
  const lively = resting || activity !== "idle" || pose !== "idle";
  return (
    <span className={`luma-mascot-stage is-${pose}${previous ? ` was-${previous}` : ""}${lively ? " is-lively" : ""}`}
      style={{ width: size, height: size, "--m-color": appearance.color } as CSSProperties}
      role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <svg className="luma-mascot-svg" width={size} height={size} viewBox="0 0 48 48" focusable="false" dangerouslySetInnerHTML={art} />
    </span>
  );
}
