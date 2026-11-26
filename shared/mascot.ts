export type MascotShape = {
  /** SVG for the flat outline in a 48×48 box. Every part takes the body colour, so overlapping parts merge. */
  silhouette: string;
  /** Where the face sits: its horizontal centre and the height of the eyes. */
  faceX: number;
  faceY: number;
  color: string;
  glasses: boolean;
};

export type MascotDesign = { shape: string; color: string; glasses: boolean };

export const MASCOT_OPTIONS = [
  { id: "sprout", label: "Round" },
  { id: "cube", label: "Cube" },
  { id: "star", label: "Star" },
  { id: "bunny", label: "Bunny" },
  { id: "leaf", label: "Drop" },
  { id: "blob", label: "Blob" },
  { id: "cloud", label: "Cloud" },
  { id: "moon", label: "Moon" },
  { id: "diamond", label: "Diamond" },
  { id: "mushroom", label: "Mushroom" },
  { id: "flower", label: "Flower" },
  { id: "ghost", label: "Ghost" },
] as const;

export const MASCOT_COLORS = ["#9298ed", "#67c9ae", "#ed9b7d", "#e5bd70", "#b49be8", "#6ebbd5", "#ee8eb8", "#a8b77b", "#f08b68", "#e5e5e5"] as const;
export type MascotId = (typeof MASCOT_OPTIONS)[number]["id"];

const path = (d: string) => `<path d="${d}"/>`;
const circle = (cx: number, cy: number, r: number) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`;

const shapes: Record<MascotId, Omit<MascotShape, "color" | "glasses">> = {
  sprout: { silhouette: circle(24, 25.5, 16), faceX: 23.5, faceY: 22.5 },
  cube: { silhouette: '<rect x="8.5" y="10.5" width="31" height="31" rx="11.5"/>', faceX: 23.5, faceY: 22 },
  star: { silhouette: '<path class="m-soft" d="M24 11L28.6 19.7L38.3 21.4L31.4 28.4L32.8 38.1L24 33.8L15.2 38.1L16.6 28.4L9.7 21.4L19.4 19.7Z"/>', faceX: 21.2, faceY: 25.5 },
  bunny: { silhouette: circle(24, 28, 14) + '<rect x="13.6" y="4" width="8" height="21" rx="4" transform="rotate(-9 17.6 14)"/><rect x="26.4" y="4" width="8" height="21" rx="4" transform="rotate(9 30.4 14)"/>', faceX: 22.5, faceY: 27 },
  leaf: { silhouette: path("M24 6.5C28.8 13 39.8 19.4 39.8 27.6C39.8 35.8 32.7 41.5 24 41.5C15.3 41.5 8.2 35.8 8.2 27.6C8.2 19.4 19.2 13 24 6.5Z"), faceX: 23, faceY: 26 },
  blob: { silhouette: path("M25.2 9.8C35 9.8 41.4 17 40.5 26.6C39.6 36 32.8 41.6 22.6 41C12.2 40.4 6.6 34 8.1 24.6C9.5 15.8 15.8 9.8 25.2 9.8Z"), faceX: 23.5, faceY: 22.5 },
  cloud: { silhouette: circle(15, 29.5, 9) + circle(24, 23, 11.5) + circle(33.5, 29, 9.5) + '<rect x="15" y="27" width="19" height="11.5" rx="3"/>', faceX: 22.5, faceY: 26 },
  moon: { silhouette: circle(22.8, 26.8, 15) + circle(39.4, 10.6, 3.4), faceX: 22, faceY: 24 },
  diamond: { silhouette: '<rect x="12" y="13.5" width="24" height="24" rx="8" transform="rotate(45 24 25.5)"/>', faceX: 20.8, faceY: 23.5 },
  mushroom: { silhouette: path("M6.5 25.4C6.5 15.6 14 9 24 9C34 9 41.5 15.6 41.5 25.4Q41.5 29.6 37 29.6H11Q6.5 29.6 6.5 25.4Z") + '<rect x="14" y="24" width="20" height="17" rx="8"/>', faceX: 23.5, faceY: 22 },
  flower: { silhouette: circle(24, 26, 11) + [[24, 17], [31.8, 21.5], [31.8, 30.5], [24, 35], [16.2, 30.5], [16.2, 21.5]].map(([x, y]) => circle(x!, y!, 7.4)).join(""), faceX: 22.5, faceY: 24 },
  ghost: { silhouette: path("M24 8.5C33 8.5 39.5 15.2 39.5 24.4V38.2Q39.5 42.2 36 40.2L32 37.8L27.6 40.8Q26 41.8 24 40.4Q22 41.8 20.4 40.8L16 37.8L12 40.2Q8.5 42.2 8.5 38.2V24.4C8.5 15.2 15 8.5 24 8.5Z"), faceX: 23, faceY: 21.5 },
};

const defaultColor = (shape: string) => MASCOT_COLORS[MASCOT_OPTIONS.findIndex((option) => option.id === shape) % MASCOT_COLORS.length] ?? MASCOT_COLORS[0];

function stableShape(seed: string): string {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return MASCOT_OPTIONS[(hash >>> 0) % MASCOT_OPTIONS.length].id;
}

function stableHash(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function getDefaultMascotDesign(seed: string): MascotDesign {
  const hash = stableHash(seed.trim().toLocaleLowerCase() || "luma");
  const shape = stableShape(seed.trim().toLocaleLowerCase() || "luma");
  const color = MASCOT_COLORS[(hash >>> 8) % MASCOT_COLORS.length];
  return { shape, color, glasses: false };
}

export function decodeMascotDesign(value: string, seed = "luma"): MascotDesign {
  if (!value || value === "auto") return getDefaultMascotDesign(seed);
  if (value.startsWith("custom:")) {
    try {
      const parsed = JSON.parse(value.slice(7)) as Partial<MascotDesign>;
      if (typeof parsed.shape === "string" && Object.prototype.hasOwnProperty.call(shapes, parsed.shape) && typeof parsed.color === "string" && /^#[0-9a-f]{6}$/i.test(parsed.color)) {
        return { shape: parsed.shape, color: parsed.color, glasses: parsed.glasses === true };
      }
    } catch { /* Fall back to the legacy mascot id. */ }
  }
  const shape = Object.prototype.hasOwnProperty.call(shapes, value) ? value : stableShape(value || "luma");
  return { shape, color: defaultColor(shape), glasses: false };
}

export function encodeMascotDesign(design: MascotDesign): string {
  return `custom:${JSON.stringify(design)}`;
}

export function getMascotAppearance(value: string, seed = "luma"): MascotShape {
  const design = decodeMascotDesign(value, seed);
  return { ...shapes[design.shape as MascotId], color: design.color, glasses: design.glasses };
}
