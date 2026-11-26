import type { MascotShape } from "./mascot";

/** White eyes disappear on very pale bodies, which get dark ones instead. */
function eyeColor(color: string): string {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(color.slice(at, at + 2), 16));
  return (r! * 299 + g! * 587 + b! * 114) / 1000 > 200 ? "#1f2028" : "#fff";
}

/**
 * The whole mascot as SVG markup for a `0 0 48 48` view box: flat colour, two eyes,
 * and the hands and props it picks up while working.
 *
 * Every pose and prop is always present and `mascot.css` decides which are
 * visible. The markup therefore never changes while a Teammate moves between
 * activities, which is what lets those changes animate instead of jumping.
 *
 * Only call this with an appearance from `getMascotAppearance`, which validates
 * the colour and shape.
 */
export function renderMascotArt(appearance: MascotShape): string {
  const { silhouette, faceX, faceY, color, glasses } = appearance;
  // Glasses need room: the eyes sit further apart, and the face shifts back so the frames stay on the body.
  const left = faceX + (glasses ? -1.8 : 0.6);
  const right = left + (glasses ? 11.4 : 7);

  // The face is turned slightly away: both eyes lean, and the far one is narrower and higher.
  const lean = (x: number, y: number, art: string) => `<g transform="translate(${x} ${y}) rotate(-18)">${art}</g>`;
  const eyePair = (near: string, far = near) => lean(left, faceY + 0.5, near) + lean(right, faceY - 0.7, far);
  // Closed eyes sit level and a little apart; tilted, two arcs read as one squiggle.
  const arcs = (d: string) => (glasses ? [left, right] : [left - 0.9, right + 1.1]).map((x) => `<path transform="translate(${x} ${faceY})" d="${d}"/>`).join("");
  const pill = (width: number, height = 7.8) => `<rect x="${-width / 2}" y="${-height / 2}" width="${width}" height="${height}" rx="${width / 2}"/>`;

  const openEyes = glasses ? eyePair(pill(2.5, 4.6), pill(2.3, 4.4)) : eyePair(pill(3.8), pill(3.2));
  const tilt = (Math.atan2(-1.2, right - left) * 180) / Math.PI;
  const far = Math.hypot(right - left, 1.2);
  const lens = (x: number, r: number) => `<circle class="m-lens-glass" cx="${x}" r="${r}"/>`;
  const frames = `<g class="m-glasses" transform="translate(${left} ${faceY + 0.5}) rotate(${tilt.toFixed(2)})">
    ${lens(0, 3.8)}${lens(far, 3.6)}
    <path d="M3.6 -1.1Q${(3.8 + far - 3.6) / 2} -2.8 ${far - 3.4} -1.1M-3.7 -.9L-6.2 -1.8"/>
  </g>`;

  const eyes = `<g class="m-gaze"><g class="m-look" style="color:${eyeColor(color)}">
    ${glasses ? frames : ""}
    <g class="m-eyes m-eyes-open"><g class="m-blink" style="transform-origin:${faceX + 4}px ${faceY}px">${openEyes}</g></g>
    <g class="m-eyes m-eyes-happy">${arcs(glasses ? "M-1.8 1Q0 -2.4 1.8 1" : "M-2.4 1.3Q0 -3.2 2.4 1.3")}</g>
    <g class="m-eyes m-eyes-shut">${arcs(glasses ? "M-1.8 0Q0 1.8 1.8 0" : "M-2.4 0Q0 2.4 2.4 0")}</g>
  </g></g>`;

  // Hands are drawn around 0,0 so each activity can place and animate them.
  const hand = (x: number, y: number, motion = "") => `<g transform="translate(${x} ${y})"><circle class="m-hand ${motion}" r="3.7"/></g>`;
  const bubble = `<path class="m-card" d="M34 1.5H44.5Q48.5 1.5 48.5 5.5V8.5Q48.5 12.5 44.5 12.5H39L34.6 15.8L35.4 12.4Q30 12 30 8.5V5.5Q30 1.5 34 1.5Z"/>`;
  const dot = (x: number, motion: string) => `<circle class="m-mark ${motion}" cx="${x}" cy="7" r="1.45"/>`;

  const activities: Record<string, string> = {
    // A finger tapping the side of the head.
    thinking: `
      <g class="m-tap"><g transform="translate(${glasses ? "1 2.2" : "0 0"})"><path class="m-finger" d="M39.4 ${faceY + 3.6}L35 ${faceY - 0.8}"/><circle class="m-hand" cx="40.6" cy="${faceY + 5}" r="3.9"/></g></g>
      <circle class="m-fill m-thought" cx="10" cy="11.5" r="1.3"/>
      <circle class="m-fill m-thought m-thought-2" cx="6.4" cy="7" r="1.9"/>
      <circle class="m-fill m-thought m-thought-3" cx="9.6" cy="1.8" r="2.5"/>`,
    // A sheet held in one hand while the other writes on it.
    planning: `
      <g transform="rotate(-6 18 39)">
        <rect class="m-card" x="8" y="30.5" width="20" height="18" rx="2.6"/>
        <path class="m-ruled m-ruled-1" pathLength="1" d="M12 35.4H24"/>
        <path class="m-ruled m-ruled-2" pathLength="1" d="M12 39.6H23"/>
        <path class="m-ruled m-ruled-3" pathLength="1" d="M12 43.8H20"/>
      </g>
      ${hand(8.4, 42.5)}
      <g class="m-scribble"><g transform="translate(25 40)"><path class="m-pencil" d="M.4 -.4L8.6 -10.4"/><path class="m-nib" d="M0 0L1.2 -1.5"/><circle class="m-hand" cx="7" cy="-5.4" r="3.7"/></g></g>`,
    // The back of a laptop, with a hand working at each side.
    typing: `
      <rect class="m-device" x="11.5" y="31.5" width="25" height="15" rx="3"/>
      <circle class="m-fill" cx="24" cy="39" r="2.1"/>
      <rect class="m-device-edge" x="6" y="45.5" width="36" height="2.8" rx="1.4"/>
      ${hand(10, 43, "m-key-left")}${hand(38, 43, "m-key-right")}`,
    // An open book.
    reading: `
      <path class="m-card" d="M7 33Q16 30.4 24 34.4Q32 30.4 41 33V45.6Q32 43 24 47Q16 43 7 45.6Z"/>
      <path class="m-ruled" d="M24 35V46M11.4 36.6Q16 36 20 37.6M11.4 40.8Q16 40.2 20 41.8M28 37.6Q32 36 36.6 36.6M28 41.8Q32 40.2 36.6 40.8"/>
      <path class="m-card m-leafturn" d="M24 34.4Q32 30.4 41 33V45.6Q32 43 24 47Z"/>
      ${hand(7, 41)}${hand(41, 41)}`,
    // A magnifying glass sweeping back and forth.
    searching: `
      <g class="m-sweep"><g transform="translate(32 ${faceY + 12})"><path class="m-handle" d="M5 5L10 10"/><circle class="m-lens" r="6.8"/><circle class="m-hand" cx="10.4" cy="10.4" r="3.7"/></g></g>`,
    talking: `<g class="m-bubble">${bubble}${dot(34.6, "m-say")}${dot(39.2, "m-say m-say-2")}${dot(43.8, "m-say m-say-3")}</g>`,
    // A raised, waving hand: this Teammate needs an answer.
    waiting: `
      <g class="m-bubble">${bubble}<path class="m-ask" d="M37.1 5.4Q37.2 3.8 39.2 3.8Q41.3 3.8 41.3 5.4Q41.3 6.5 40 7.1Q39.2 7.5 39.2 8.4"/><circle class="m-mark" cx="39.2" cy="10.4" r=".95"/></g>
      ${hand(5.4, 25, "m-wave")}`,
    sleeping: `<g class="m-z"><path d="M36 13H40.5L36 17.5H40.5"/></g><g class="m-z m-z-2"><path d="M41 6H44.5L41 9.5H44.5"/></g><g class="m-z m-z-3"><path d="M45 .5H47.5L45 3H47.5"/></g>`,
    done: `<g class="m-burst"><path d="M9 12L5.6 8.6M7 20H2.4M16 6.4L14.6 2M39 12L42.4 8.6M41 20H45.6M32 6.4L33.4 2"/></g>`,
  };

  return `<g class="m-dots">${["left", "mid", "right"].map((side) => `<g class="m-dot m-dot-${side}"><circle class="m-fill" r="4.8" cx="24" cy="26"/></g>`).join("")}</g>
    <g class="m-morph"><g class="m-bob"><g class="m-pose"><g class="m-motion">
      <g class="m-fill m-body">${silhouette}</g>
      <g class="m-face">${eyes}</g>
    </g></g></g></g>
    ${Object.entries(activities).map(([name, art]) => `<g class="m-act m-act-${name}">${art}</g>`).join("")}`;
}
