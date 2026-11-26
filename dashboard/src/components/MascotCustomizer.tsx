import type { CSSProperties } from "react";
import { decodeMascotDesign, encodeMascotDesign, MASCOT_COLORS, MASCOT_OPTIONS } from "../../../shared/mascot";
import { MascotAvatar } from "./MascotAvatar";

export function MascotCustomizer({ value, seed = "luma", onChange }: { value: string; seed?: string; onChange: (value: string) => void }) {
  const design = decodeMascotDesign(value, seed);
  const update = (next: Partial<typeof design>) => onChange(encodeMascotDesign({ ...design, ...next }));
  return <div className="mascot-customizer">
    <div className="mascot-customizer-preview"><MascotAvatar seed={seed} mascot={value} size={76} label="Mascot preview" active /><div><strong>Your mascot</strong><span>Mix a shape, color and accessory.</span></div></div>
    <div className="mascot-customizer-group"><span className="mascot-customizer-label">SHAPE</span><div className="mascot-shape-grid">{MASCOT_OPTIONS.map((option) => <button key={option.id} type="button" aria-label={`${option.label} shape`} title={option.label} aria-pressed={design.shape === option.id} onClick={() => update({ shape: option.id })}><MascotAvatar seed={seed} mascot={encodeMascotDesign({ shape: option.id, color: design.color, glasses: false })} size={24} /><span>{option.label}</span></button>)}</div></div>
    <div className="mascot-customizer-group"><span className="mascot-customizer-label">COLOR</span><div className="mascot-color-grid">{MASCOT_COLORS.map((color) => <button key={color} type="button" aria-label={`Use ${color} mascot color`} title={color} aria-pressed={design.color === color} onClick={() => update({ color })} style={{ "--mascot-swatch": color } as CSSProperties} />)}<label className="mascot-custom-color" title="Choose a custom color"><input type="color" aria-label="Choose a custom mascot color" value={design.color} onChange={(event) => update({ color: event.target.value })} /><span>Custom</span></label></div></div>
    <label className="mascot-glasses-toggle"><input type="checkbox" checked={design.glasses} onChange={(event) => update({ glasses: event.target.checked })} /><span>Add glasses</span><small>Give your teammate a little extra personality.</small></label>
  </div>;
}
