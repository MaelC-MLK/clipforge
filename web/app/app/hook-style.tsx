"use client";

import { FONTS, POSITIONS, type Edit } from "@/lib/edit";

const PLACES: Record<(typeof POSITIONS)[number], string> = { top: "En haut", middle: "Au milieu", bottom: "En bas" };

/** Réglages du titre à l'écran, partagés entre l'éditeur et le fast clip. */
export function HookStyleFields({ value, onChange }: { value: Edit["hookStyle"]; onChange: (v: Edit["hookStyle"]) => void }) {
  const set = (patch: Partial<Edit["hookStyle"]>) => onChange({ ...value, ...patch });
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="label" htmlFor="hookFont">
          Police
        </label>
        <select id="hookFont" className="input" value={value.font} onChange={(e) => set({ font: e.target.value as Edit["hookStyle"]["font"] })}>
          {FONTS.map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="hookPosition">
          Position
        </label>
        <select id="hookPosition" className="input" value={value.position} onChange={(e) => set({ position: e.target.value as Edit["hookStyle"]["position"] })}>
          {POSITIONS.map((p) => (
            <option key={p} value={p}>
              {PLACES[p]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="hookColor">
          Couleur du texte
        </label>
        <input id="hookColor" type="color" value={value.color} onChange={(e) => set({ color: e.target.value })} className="h-10 w-full rounded bg-transparent" />
      </div>
      <div>
        <label className="label" htmlFor="hookBg">
          {value.box ? "Couleur du cartouche" : "Couleur du contour"}
        </label>
        <input id="hookBg" type="color" value={value.bg} onChange={(e) => set({ bg: e.target.value })} className="h-10 w-full rounded bg-transparent" />
      </div>
      <div className="col-span-2">
        <label className="label" htmlFor="hookSize">
          Taille : {value.size}
        </label>
        <input id="hookSize" type="range" min={40} max={140} value={value.size} onChange={(e) => set({ size: Number(e.target.value) })} className="w-full accent-violet-500" />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={value.box} onChange={(e) => set({ box: e.target.checked })} className="accent-violet-500" />
        Cartouche derrière le texte
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={value.upper} onChange={(e) => set({ upper: e.target.checked })} className="accent-violet-500" />
        Tout en majuscules
      </label>
    </div>
  );
}

/** Aperçu HTML du titre, dans un cadre 9:16 en position relative. `scale` = largeur du cadre / 1080. */
export function HookPreview({ text, style, scale }: { text: string; style: Edit["hookStyle"]; scale: number }) {
  if (!text.trim()) return null;
  const place = style.position === "top" ? { top: `${(200 / 1920) * 100}%` } : style.position === "bottom" ? { bottom: `${(300 / 1920) * 100}%` } : { top: "50%", transform: "translateY(-50%)" };
  const size = style.size * scale;
  return (
    <span
      className="absolute inset-x-3 mx-auto w-fit text-center font-bold leading-tight"
      style={{
        ...place,
        fontFamily: `${style.font}, sans-serif`,
        fontSize: size,
        color: style.color,
        textTransform: style.upper ? "uppercase" : undefined,
        ...(style.box
          ? { background: style.bg, padding: `${size * 0.15}px ${size * 0.3}px`, borderRadius: size * 0.15 }
          : { WebkitTextStroke: `${Math.max(1, size / 14)}px ${style.bg}`, paintOrder: "stroke fill" }),
      }}
    >
      {text}
    </span>
  );
}
