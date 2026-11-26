// Réglages de montage d'un clip (colonne Clip.edit). Partagé entre le navigateur et le serveur ;
// le worker Python lit les mêmes champs dans worker/worker.py et worker/render.py.

export const FONTS = ["Montserrat", "Bebas Neue", "Lato"] as const; // installées dans worker/Dockerfile
export const CROPS = ["face", "center", "manual", "split"] as const;
export const POSITIONS = ["bottom", "middle", "top"] as const;
export const PRESETS = ["karaoke", "big"] as const;

export type Word = { w: string; start: number; end: number };

export type Edit = {
  crop: (typeof CROPS)[number];
  keyframes: { t: number; x: number }[]; // cadrage manuel : centre horizontal (0 à 1) à l'instant t du clip
  facecam: { x: number; y: number; w: number; h: number }; // mode split : zone de la facecam, en fractions de l'image
  hide: { on: boolean; x: number; y: number; w: number; h: number }; // zone floutée de la source (filigrane, HUD), en fractions de l'image
  ratio: number; // part de la hauteur donnée à la partie du haut (split et vidéo secondaire)
  stackSourceId: string; // vidéo secondaire de la bibliothèque, "" = aucune
  stackPosition: "top" | "bottom";
  subtitles: boolean;
  subStyle: {
    preset: (typeof PRESETS)[number];
    font: (typeof FONTS)[number];
    size: number;
    color: string; // #RRGGBB, couleur du mot prononcé
    outline: number;
    position: (typeof POSITIONS)[number];
  };
  voice: boolean;
  music: string; // nom d'un fichier de la bibliothèque de musiques, "" = aucune
  musicVolume: number; // 0 à 100
  musicFade: boolean;
  hook: string;
  hookFull: boolean; // accroche affichée pendant tout le clip au lieu des 3 premières secondes
  hookStyle: {
    font: (typeof FONTS)[number];
    size: number;
    color: string; // #RRGGBB, couleur du texte
    bg: string; // #RRGGBB, cartouche ou contour
    box: boolean; // cartouche plein derrière le texte, sinon simple contour
    position: (typeof POSITIONS)[number];
    upper: boolean;
  };
  progressBar: boolean;
  watermark: string;
  zoomPunch: boolean;
  cutSilences: boolean;
  loudnorm: boolean;
  voiceOnly: boolean; // garde seulement la voix (Demucs) : musique et sons du jeu retirés
  denoise: boolean; // atténue le bruit de fond
  customWords: boolean; // les mots ont été corrigés à la main : le worker ne retranscrit pas
};

export const DEFAULT_EDIT: Edit = {
  crop: "face",
  keyframes: [],
  facecam: { x: 0, y: 0, w: 0.3, h: 0.3 },
  ratio: 0.4,
  hide: { on: false, x: 0.75, y: 0.03, w: 0.2, h: 0.1 },
  stackSourceId: "",
  stackPosition: "bottom",
  subtitles: true,
  subStyle: { preset: "karaoke", font: "Montserrat", size: 92, color: "#FFFF00", outline: 7, position: "bottom" },
  voice: false,
  music: "",
  musicVolume: 30,
  musicFade: true,
  hook: "",
  hookFull: false,
  hookStyle: { font: "Montserrat", size: 84, color: "#000000", bg: "#FFFFFF", box: true, position: "top", upper: false },
  progressBar: false,
  watermark: "",
  zoomPunch: false,
  cutSilences: false,
  loudnorm: true,
  voiceOnly: false,
  denoise: false,
  customWords: false,
};

const num = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;
const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\r\n]+/g, " ").slice(0, max) : "");
const hex = (v: unknown, fallback: string) => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** Ne garde que des valeurs connues et bornées : tout ce qui vient du navigateur passe par ici. */
export function sanitizeEdit(input: unknown): Edit {
  const i = obj(input);
  const d = DEFAULT_EDIT;
  const style = obj(i.subStyle);
  const hs = obj(i.hookStyle);
  const dh = d.hookStyle;
  const cam = obj(i.facecam);
  const hide = obj(i.hide);
  const hw = num(hide.w, 0.02, 1, d.hide.w);
  const hh = num(hide.h, 0.02, 1, d.hide.h);
  const w = num(cam.w, 0.05, 1, d.facecam.w);
  const h = num(cam.h, 0.05, 1, d.facecam.h);
  return {
    crop: pick(i.crop, CROPS, d.crop),
    keyframes: (Array.isArray(i.keyframes) ? i.keyframes : [])
      .slice(0, 100)
      .map((k) => ({ t: num(obj(k).t, 0, 3600, 0), x: num(obj(k).x, 0, 1, 0.5) }))
      .sort((a, b) => a.t - b.t),
    facecam: { x: num(cam.x, 0, 1 - w, 0), y: num(cam.y, 0, 1 - h, 0), w, h },
    hide: { on: Boolean(hide.on), x: num(hide.x, 0, 1 - hw, d.hide.x), y: num(hide.y, 0, 1 - hh, d.hide.y), w: hw, h: hh },
    ratio: num(i.ratio, 0.2, 0.8, d.ratio),
    stackSourceId: text(i.stackSourceId, 40),
    stackPosition: pick(i.stackPosition, ["top", "bottom"] as const, d.stackPosition),
    subtitles: Boolean(i.subtitles),
    subStyle: {
      preset: pick(style.preset, PRESETS, d.subStyle.preset),
      font: pick(style.font, FONTS, d.subStyle.font),
      size: Math.round(num(style.size, 40, 160, d.subStyle.size)),
      color: hex(style.color, d.subStyle.color),
      outline: Math.round(num(style.outline, 0, 16, d.subStyle.outline)),
      position: pick(style.position, POSITIONS, d.subStyle.position),
    },
    voice: Boolean(i.voice),
    music: text(i.music, 100),
    musicVolume: Math.round(num(i.musicVolume, 0, 100, d.musicVolume)),
    musicFade: Boolean(i.musicFade),
    hook: text(i.hook, 80),
    hookFull: Boolean(i.hookFull),
    hookStyle: {
      font: pick(hs.font, FONTS, dh.font),
      size: Math.round(num(hs.size, 40, 140, dh.size)),
      color: hex(hs.color, dh.color),
      bg: hex(hs.bg, dh.bg),
      box: hs.box === undefined ? dh.box : Boolean(hs.box),
      position: pick(hs.position, POSITIONS, dh.position),
      upper: Boolean(hs.upper),
    },
    progressBar: Boolean(i.progressBar),
    watermark: text(i.watermark, 40),
    zoomPunch: Boolean(i.zoomPunch),
    cutSilences: Boolean(i.cutSilences),
    loudnorm: Boolean(i.loudnorm),
    voiceOnly: Boolean(i.voiceOnly),
    denoise: Boolean(i.denoise),
    customWords: Boolean(i.customWords),
  };
}

/** Mots corrigés par l'utilisateur : texte borné, temps dans le clip, fin après le début. null si invalide. */
export function sanitizeWords(input: unknown, duration: number): Word[] | null {
  if (!Array.isArray(input) || input.length > 2000) return null;
  const words = input.map((x) => {
    const start = num(obj(x).start, 0, duration, 0);
    return { w: text(obj(x).w, 60).trim(), start, end: num(obj(x).end, start, duration, start) };
  });
  return words.filter((w) => w.w).sort((a, b) => a.start - b.start);
}

/** Centre horizontal du cadre à l'instant t, entre les images clés (même calcul que crop_x_expr côté worker). */
export function keyframeX(keyframes: Edit["keyframes"], t: number): number {
  if (keyframes.length === 0) return 0.5;
  if (t <= keyframes[0].t) return keyframes[0].x;
  for (let i = 1; i < keyframes.length; i++) {
    const a = keyframes[i - 1];
    const b = keyframes[i];
    if (t < b.t) return a.x + ((b.x - a.x) * (t - a.t)) / (b.t - a.t || 1);
  }
  return keyframes[keyframes.length - 1].x;
}

export const MIN_PART_SECONDS = 10;
export const MAX_PARTS = 60;

/** Découpe [0, duration] en parties de `seconds` secondes. Une fin de moins de 10 s est rattachée à la partie d'avant. */
export function splitParts(duration: number, seconds: number, maxPart: number): { start: number; end: number }[] {
  if (!(duration > 0) || !(seconds > 0)) return [];
  const parts: { start: number; end: number }[] = [];
  for (let start = 0; start < duration; start += seconds) parts.push({ start, end: Math.min(start + seconds, duration) });
  const last = parts[parts.length - 1];
  const before = parts[parts.length - 2];
  if (before && last.end - last.start < MIN_PART_SECONDS && last.end - before.start <= maxPart) {
    before.end = last.end;
    parts.pop();
  }
  return parts;
}
