"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { CROPS, DEFAULT_EDIT, type Edit, FONTS, keyframeX, POSITIONS, PRESETS, type Word } from "@/lib/edit";
import type { SourceState } from "@/lib/storage";
import { MAX_CLIP_SECONDS, MUSIC_EXT } from "@/lib/upload";
import { Moments } from "./moments";
import { createClip, createClipsBatch, deleteClip, deleteMusic, deleteTemplate, getClipWords, rerenderClips, saveTemplate } from "../../../actions";

const CROP_LABELS: Record<(typeof CROPS)[number], string> = {
  face: "Suivi automatique du visage",
  center: "Centre",
  manual: "Manuel (images clés)",
  split: "Split : facecam en haut, jeu en bas",
};
const POSITION_LABELS: Record<(typeof POSITIONS)[number], string> = { bottom: "Bas", middle: "Milieu", top: "Haut" };
const PRESET_LABELS: Record<(typeof PRESETS)[number], string> = { karaoke: "Karaoké (mot surligné)", big: "Gros texte, un mot à la fois" };

function clock(seconds: number) {
  const s = Math.max(0, seconds);
  const pad = (n: number) => String(Math.floor(n)).padStart(2, "0");
  return `${Math.floor(s / 3600)}:${pad((s % 3600) / 60)}:${pad(s % 60)}.${Math.floor((s % 1) * 10)}`;
}

function Section({ title, open, children }: { title: string; open?: boolean; children: ReactNode }) {
  return (
    <details className="card" open={open}>
      <summary className="cursor-pointer font-medium">{title}</summary>
      <div className="mt-4 space-y-4">{children}</div>
    </details>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4" />
      {label}
    </label>
  );
}

function Slider(props: { id: string; label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="label" htmlFor={props.id}>
        {props.label}
      </label>
      <input
        id={props.id}
        type="range"
        className="w-full"
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </div>
  );
}

const PW = 540; // l'aperçu est dessiné en 540x960, la moitié du rendu final
const PH = 960;

/** Aperçu vertical approximatif, dessiné à partir de la vidéo basse résolution en cours de lecture. */
function Preview(props: { video: RefObject<HTMLVideoElement | null>; edit: Edit; start: number; end: number; manualX: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const second = useRef<HTMLVideoElement>(null);
  const { video, edit, start, end, manualX } = props;

  useEffect(() => {
    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const v = video.current;
      const ctx = canvas.current?.getContext("2d");
      if (!v || !ctx) return;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, PW, PH);
      if (!v.videoWidth) return;
      const t = v.currentTime - start;

      // Dessine une zone de l'image source en remplissant la destination, sans déformer.
      const cover = (img: HTMLVideoElement, r: { x: number; y: number; w: number; h: number }, dy: number, dh: number, centerX = 0.5) => {
        const cw = Math.min(r.w, (r.h * PW) / dh);
        const ch = (cw * dh) / PW;
        const cx = Math.min(Math.max(r.x + centerX * r.w - cw / 2, r.x), r.x + r.w - cw);
        ctx.drawImage(img, cx, r.y + (r.h - ch) / 2, cw, ch, 0, dy, PW, dh);
      };
      const whole = { x: 0, y: 0, w: v.videoWidth, h: v.videoHeight };
      const topH = Math.round(PH * edit.ratio);
      const centerX = edit.crop === "manual" ? (edit.keyframes.length ? keyframeX(edit.keyframes, t) : manualX) : 0.5;

      if (edit.crop === "split") {
        const f = edit.facecam;
        cover(v, { x: f.x * whole.w, y: f.y * whole.h, w: f.w * whole.w, h: f.h * whole.h }, 0, topH);
        cover(v, whole, topH, PH - topH);
      } else if (edit.stackSourceId) {
        const mainTop = edit.stackPosition === "bottom";
        cover(v, whole, mainTop ? 0 : topH, mainTop ? topH : PH - topH, centerX);
        const s = second.current;
        if (s?.videoWidth) cover(s, { x: 0, y: 0, w: s.videoWidth, h: s.videoHeight }, mainTop ? topH : 0, mainTop ? PH - topH : topH);
      } else {
        cover(v, whole, 0, PH, centerX);
      }

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const font = (size: number) => `bold ${size}px ${edit.subStyle.font}, sans-serif`;
      if (edit.watermark.trim()) {
        ctx.font = font(20);
        ctx.textAlign = "right";
        ctx.fillStyle = "rgba(255,255,255,0.5)";
        ctx.fillText(edit.watermark, PW - 20, 40);
        ctx.textAlign = "center";
      }
      if (edit.hook.trim() && t >= 0 && t < 3) {
        ctx.font = font(34);
        const width = Math.min(ctx.measureText(edit.hook).width + 30, PW - 40);
        ctx.fillStyle = "#fff";
        ctx.fillRect((PW - width) / 2, 100, width, 56);
        ctx.fillStyle = "#000";
        ctx.fillText(edit.hook, PW / 2, 129, PW - 60);
      }
      if (edit.subtitles) {
        const st = edit.subStyle;
        const big = st.preset === "big";
        const y = st.position === "top" ? 220 : st.position === "middle" ? PH / 2 : PH - 290;
        ctx.font = font((st.size / 2) * (big ? 1.4 : 1));
        ctx.lineWidth = st.outline;
        ctx.lineJoin = "round";
        ctx.strokeStyle = "#000";
        const parts = big ? [["EXEMPLE", st.color]] : [["EXEMPLE ", st.color], ["DE TEXTE", "#fff"]];
        let x = PW / 2 - ctx.measureText(parts.map((p) => p[0]).join("")).width / 2;
        ctx.textAlign = "left";
        for (const [word, color] of parts) {
          if (st.outline) ctx.strokeText(word, x, y);
          ctx.fillStyle = color;
          ctx.fillText(word, x, y);
          x += ctx.measureText(word).width;
        }
      }
      if (edit.progressBar && end > start) {
        ctx.fillStyle = "#FFD400";
        ctx.fillRect(0, PH - 8, PW * Math.min(Math.max(t / (end - start), 0), 1), 8);
      }
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [video, edit, start, end, manualX]);

  return (
    <div>
      <canvas ref={canvas} width={PW} height={PH} className="mx-auto w-full max-w-[270px] rounded bg-black" aria-label="Aperçu vertical du clip" />
      {edit.stackSourceId && edit.crop !== "split" && (
        <video ref={second} src={`/api/sources/${edit.stackSourceId}/video`} muted loop autoPlay playsInline className="hidden" />
      )}
      <p className="mt-2 text-center text-xs text-zinc-500">
        Aperçu approximatif. Le suivi du visage, les zooms, la coupe des silences et le vrai texte des sous-titres
        n&apos;apparaissent qu&apos;au rendu.
      </p>
    </div>
  );
}

/** Correction du texte et du minutage des sous-titres d'un clip déjà rendu. */
function WordsEditor({ clipId, onDone }: { clipId: string; onDone: (message: { error?: string; ok?: string }) => void }) {
  const [words, setWords] = useState<Word[] | null>(null);
  useEffect(() => {
    getClipWords(clipId).then(setWords);
  }, [clipId]);
  if (!words) return <p className="mt-3 text-sm text-zinc-500">Chargement…</p>;

  const change = (i: number, patch: Partial<Word>) => setWords(words.map((w, j) => (j === i ? { ...w, ...patch } : w)));
  return (
    <div className="mt-3 space-y-2">
      <p className="text-xs text-zinc-500">Texte, début et fin de chaque mot (secondes depuis le début du clip).</p>
      <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
        {words.map((w, i) => (
          <div key={i} className="flex gap-1">
            <input aria-label="Mot" className="input min-w-0 flex-1" value={w.w} maxLength={60} onChange={(e) => change(i, { w: e.target.value })} />
            <input aria-label="Début" className="input w-20" type="number" step={0.05} min={0} value={w.start} onChange={(e) => change(i, { start: Number(e.target.value) })} />
            <input aria-label="Fin" className="input w-20" type="number" step={0.05} min={0} value={w.end} onChange={(e) => change(i, { end: Number(e.target.value) })} />
            <button type="button" className="btn-ghost" aria-label={`Retirer le mot ${w.w}`} onClick={() => setWords(words.filter((_, j) => j !== i))}>
              ×
            </button>
          </div>
        ))}
      </div>
      <button className="btn" onClick={async () => onDone(await rerenderClips({ ids: [clipId], words }))}>
        Enregistrer et refaire le rendu
      </button>
    </div>
  );
}

export function Editor({
  purged,
  sourceId,
  duration,
  initial,
  estimateUsd,
  budgetLeftUsd,
  subscription,
  musicFiles,
  sources,
  templates,
}: {
  purged: boolean;
  sourceId: string;
  duration: number;
  initial: SourceState;
  estimateUsd: number;
  budgetLeftUsd: number;
  subscription: boolean;
  musicFiles: string[];
  sources: { id: string; title: string }[];
  templates: { id: string; name: string; edit: Edit }[];
}) {
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState(initial);
  const clips = state.clips;
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(Math.min(30, duration));
  const [title, setTitle] = useState("");
  const [edit, setEdit] = useState<Edit>(DEFAULT_EDIT);
  const [manualX, setManualX] = useState(0.5);
  const [musicList, setMusicList] = useState(musicFiles);
  const [templateId, setTemplateId] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [message, setMessage] = useState<{ error?: string; ok?: string }>({});
  const [pending, setPending] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const [editingWords, setEditingWords] = useState<string | null>(null);

  // Rendus, analyse et moments proposés, en temps réel.
  useEffect(() => {
    const events = new EventSource(`/api/events?source=${sourceId}`);
    events.onmessage = (e) => setState(JSON.parse(e.data));
    return () => events.close();
  }, [sourceId]);

  const set = <K extends keyof Edit>(key: K, value: Edit[K]) => setEdit((e) => ({ ...e, [key]: value }));
  const setStyle = (patch: Partial<Edit["subStyle"]>) => setEdit((e) => ({ ...e, subStyle: { ...e.subStyle, ...patch } }));
  const setCam = (patch: Partial<Edit["facecam"]>) => setEdit((e) => ({ ...e, facecam: { ...e.facecam, ...patch } }));

  const now = () => Math.round((video.current?.currentTime ?? 0) * 10) / 10;
  const length = end - start;
  const valid = length >= 1 && length <= MAX_CLIP_SECONDS;

  function preview() {
    const v = video.current;
    if (!v) return;
    v.currentTime = start;
    v.play();
    const stop = () => {
      if (v.currentTime >= end) {
        v.pause();
        v.removeEventListener("timeupdate", stop);
      }
    };
    v.addEventListener("timeupdate", stop);
  }

  async function run(action: () => Promise<{ error?: string; ok?: string }>) {
    setPending(true);
    setMessage(await action());
    setPending(false);
  }

  function addKeyframe() {
    const t = Math.min(Math.max(now() - start, 0), length);
    // Une image clé posée au même instant remplace la précédente.
    set("keyframes", [...edit.keyframes.filter((k) => Math.abs(k.t - t) > 0.05), { t, x: manualX }].sort((a, b) => a.t - b.t));
  }

  async function addMusic(file: File | undefined) {
    if (!file) return;
    setMessage({});
    const res = await fetch("/api/music", { method: "POST", headers: { "x-filename": encodeURIComponent(file.name) }, body: file });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setMessage({ error: body.error ?? "Envoi de la musique impossible." });
    setMusicList(body.music);
    set("music", body.added);
  }

  async function removeMusic() {
    if (!confirm(`Supprimer la musique « ${edit.music} » ?`)) return;
    await deleteMusic(edit.music);
    setMusicList(musicList.filter((m) => m !== edit.music));
    set("music", "");
  }

  const template = templates.find((t) => t.id === templateId);
  const idle = clips.filter((c) => c.status !== "rendering");

  return (
    <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
      {purged && (
        <p className="card h-fit text-sm text-zinc-300">
          La vidéo d&apos;origine a été supprimée automatiquement (réglage « Supprimer les fichiers des sources » dans Compte). Les clips déjà rendus
          restent disponibles : tu peux les voir, les télécharger et les publier, mais plus les refaire.
        </p>
      )}
      <div className={purged ? "hidden" : "space-y-4"}>
        <div className="grid items-start gap-4 sm:grid-cols-[1fr_auto]">
          <video ref={video} className="w-full rounded bg-black" src={`/api/sources/${sourceId}/video`} controls />
          <Preview video={video} edit={edit} start={start} end={end} manualX={manualX} />
        </div>

        <Moments
          sourceId={sourceId}
          duration={duration}
          state={state}
          estimateUsd={estimateUsd}
          budgetLeftUsd={budgetLeftUsd}
          subscription={subscription}
          onSeek={(t) => {
            if (video.current) video.current.currentTime = t;
          }}
          onBatch={(ids) => run(() => createClipsBatch({ sourceId, candidateIds: ids, edit }))}
          onPick={(c) => {
            setStart(Math.round(c.start * 10) / 10);
            setEnd(Math.round(c.end * 10) / 10);
            setTitle(c.title);
            if (video.current) video.current.currentTime = c.start;
          }}
        />

        <Section title="Découpe" open>
          <div className="grid grid-cols-2 gap-4">
            {(
              [
                ["Début", start, setStart, "start"],
                ["Fin", end, setEnd, "end"],
              ] as const
            ).map(([label, value, setValue, id]) => (
              <div key={id}>
                <label className="label" htmlFor={id}>
                  {label} (secondes)
                </label>
                <div className="flex gap-2">
                  <input id={id} type="number" min={0} max={duration} step={0.1} value={value} onChange={(e) => setValue(Number(e.target.value))} className="input" />
                  <button type="button" className="btn-ghost whitespace-nowrap" onClick={() => setValue(now())}>
                    Position actuelle
                  </button>
                </div>
                <p className="mt-1 text-xs text-zinc-500">{clock(value)}</p>
              </div>
            ))}
          </div>
          <p className={`text-sm ${valid ? "text-zinc-400" : "text-red-400"}`}>
            Durée du clip : {length.toFixed(1)} s (entre 1 et {MAX_CLIP_SECONDS} s)
            <button type="button" className="btn-ghost ml-3" onClick={preview} disabled={!valid}>
              Lire l&apos;extrait
            </button>
          </p>
          <div>
            <label className="label" htmlFor="title">
              Titre
            </label>
            <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} placeholder="Titre du clip" className="input" />
          </div>
        </Section>

        <Section title="Cadrage" open>
          <div>
            <label className="label" htmlFor="crop">
              Recadrage vertical 9:16
            </label>
            <select id="crop" value={edit.crop} onChange={(e) => set("crop", e.target.value as Edit["crop"])} className="input">
              {CROPS.map((c) => (
                <option key={c} value={c}>
                  {CROP_LABELS[c]}
                </option>
              ))}
            </select>
          </div>

          {edit.crop === "manual" && (
            <div className="space-y-2">
              <Slider id="kx" label="Position horizontale du cadre" min={0} max={1} step={0.01} value={manualX} onChange={setManualX} />
              <button type="button" className="btn-ghost" onClick={addKeyframe}>
                Poser une image clé à la position de lecture
              </button>
              <p className="text-xs text-zinc-500">
                Le cadre glisse d&apos;une image clé à la suivante. Sans image clé, il reste à la position du curseur
                {edit.keyframes.length === 0 && " (pose-en au moins une pour l'enregistrer)"}.
              </p>
              <ul className="space-y-1 text-sm">
                {edit.keyframes.map((k) => (
                  <li key={k.t} className="flex items-center gap-2">
                    {clock(k.t)} : {Math.round(k.x * 100)} %
                    <button type="button" className="btn-ghost" onClick={() => set("keyframes", edit.keyframes.filter((x) => x !== k))}>
                      Retirer
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {edit.crop === "split" && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              <p className="col-span-2 text-xs text-zinc-500">Zone de la facecam dans la vidéo d&apos;origine (vérifie-la dans l&apos;aperçu).</p>
              <Slider id="fx" label="Bord gauche" min={0} max={1 - edit.facecam.w} step={0.01} value={edit.facecam.x} onChange={(x) => setCam({ x })} />
              <Slider id="fy" label="Bord haut" min={0} max={1 - edit.facecam.h} step={0.01} value={edit.facecam.y} onChange={(y) => setCam({ y })} />
              <Slider id="fw" label="Largeur" min={0.05} max={1} step={0.01} value={edit.facecam.w} onChange={(w) => setCam({ w, x: Math.min(edit.facecam.x, 1 - w) })} />
              <Slider id="fh" label="Hauteur" min={0.05} max={1} step={0.01} value={edit.facecam.h} onChange={(h) => setCam({ h, y: Math.min(edit.facecam.y, 1 - h) })} />
            </div>
          )}

          {edit.crop !== "split" && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label" htmlFor="stack">
                  Vidéo secondaire empilée
                </label>
                <select id="stack" value={edit.stackSourceId} onChange={(e) => set("stackSourceId", e.target.value)} className="input">
                  <option value="">Aucune</option>
                  {sources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </select>
              </div>
              {edit.stackSourceId && (
                <div>
                  <label className="label" htmlFor="stackPosition">
                    Place de la vidéo secondaire
                  </label>
                  <select id="stackPosition" value={edit.stackPosition} onChange={(e) => set("stackPosition", e.target.value as Edit["stackPosition"])} className="input">
                    <option value="bottom">En dessous</option>
                    <option value="top">Au-dessus</option>
                  </select>
                </div>
              )}
              {sources.length === 0 && (
                <p className="col-span-2 text-xs text-zinc-500">Importe une autre vidéo dans la bibliothèque (gameplay, par exemple) pour l&apos;empiler ici.</p>
              )}
            </div>
          )}

          {(edit.crop === "split" || edit.stackSourceId) && (
            <Slider id="ratio" label={`Part de la hauteur pour la partie du haut : ${Math.round(edit.ratio * 100)} %`} min={0.2} max={0.8} step={0.01} value={edit.ratio} onChange={(v) => set("ratio", v)} />
          )}
        </Section>

        <Section title="Sous-titres">
          <Check label="Sous-titres automatiques incrustés (et fichier SRT)" checked={edit.subtitles} onChange={(v) => set("subtitles", v)} />
          {edit.subtitles && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label" htmlFor="preset">
                  Style
                </label>
                <select id="preset" value={edit.subStyle.preset} onChange={(e) => setStyle({ preset: e.target.value as Edit["subStyle"]["preset"] })} className="input">
                  {PRESETS.map((p) => (
                    <option key={p} value={p}>
                      {PRESET_LABELS[p]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="font">
                  Police
                </label>
                <select id="font" value={edit.subStyle.font} onChange={(e) => setStyle({ font: e.target.value as Edit["subStyle"]["font"] })} className="input">
                  {FONTS.map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="position">
                  Position
                </label>
                <select id="position" value={edit.subStyle.position} onChange={(e) => setStyle({ position: e.target.value as Edit["subStyle"]["position"] })} className="input">
                  {POSITIONS.map((p) => (
                    <option key={p} value={p}>
                      {POSITION_LABELS[p]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="color">
                  Couleur du mot prononcé
                </label>
                <input id="color" type="color" value={edit.subStyle.color} onChange={(e) => setStyle({ color: e.target.value })} className="h-10 w-full rounded bg-transparent" />
              </div>
              <Slider id="size" label={`Taille : ${edit.subStyle.size}`} min={40} max={160} value={edit.subStyle.size} onChange={(size) => setStyle({ size })} />
              <Slider id="outline" label={`Contour : ${edit.subStyle.outline}`} min={0} max={16} value={edit.subStyle.outline} onChange={(outline) => setStyle({ outline })} />
              <p className="col-span-2 text-xs text-zinc-500">
                Pour corriger le texte ou le minutage : fais un premier rendu, puis « Sous-titres » sur le clip.
              </p>
            </div>
          )}
        </Section>

        <Section title="Son">
          <Check label="Voix de synthèse (redit le texte et remplace tout le son d'origine)" checked={edit.voice} onChange={(v) => set("voice", v)} />
          <Check label="Couper les silences" checked={edit.cutSilences} onChange={(v) => set("cutSilences", v)} />
          <Check label="Normaliser le volume (niveau standard des réseaux)" checked={edit.loudnorm} onChange={(v) => set("loudnorm", v)} />
          <div>
            <label className="label" htmlFor="music">
              Musique de fond
            </label>
            <div className="flex flex-wrap gap-2">
              <select id="music" value={edit.music} onChange={(e) => set("music", e.target.value)} className="input min-w-0 flex-1">
                <option value="">Aucune</option>
                {musicList.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <label className="btn-ghost cursor-pointer whitespace-nowrap">
                Ajouter un fichier
                <input
                  type="file"
                  accept={MUSIC_EXT.join(",")}
                  className="sr-only"
                  onChange={(e) => {
                    addMusic(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
              {edit.music && (
                <button type="button" className="btn-ghost" onClick={removeMusic}>
                  Supprimer
                </button>
              )}
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              La musique boucle si elle est plus courte que le clip et baisse quand ça parle. N&apos;ajoute que des
              musiques que tu as le droit d&apos;utiliser.
            </p>
          </div>
          {edit.music && (
            <div className="grid grid-cols-2 items-end gap-4">
              <Slider id="musicVolume" label={`Volume de la musique : ${edit.musicVolume} %`} min={0} max={100} value={edit.musicVolume} onChange={(v) => set("musicVolume", v)} />
              <Check label="Fondu au début et à la fin" checked={edit.musicFade} onChange={(v) => set("musicFade", v)} />
            </div>
          )}
        </Section>

        <Section title="Extras">
          <div>
            <label className="label" htmlFor="hook">
              Accroche (affichée les 3 premières secondes)
            </label>
            <input id="hook" value={edit.hook} onChange={(e) => set("hook", e.target.value)} maxLength={80} placeholder="Il ne s'attendait pas à ça…" className="input" />
          </div>
          <div>
            <label className="label" htmlFor="watermark">
              Filigrane (texte en haut à droite)
            </label>
            <input id="watermark" value={edit.watermark} onChange={(e) => set("watermark", e.target.value)} maxLength={40} placeholder="@tachaine" className="input" />
          </div>
          <Check label="Barre de progression en bas" checked={edit.progressBar} onChange={(v) => set("progressBar", v)} />
          <Check label="Zoom sur les pics sonores (cris, rires)" checked={edit.zoomPunch} onChange={(v) => set("zoomPunch", v)} />
        </Section>

        <Section title="Templates">
          <div className="flex flex-wrap gap-2">
            <select aria-label="Template" value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="input min-w-0 flex-1">
              <option value="">Choisir un template…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn-ghost"
              disabled={!template}
              // Le cadrage propre à ce clip (images clés) n'est pas écrasé par le template.
              onClick={() => template && setEdit({ ...template.edit, keyframes: edit.keyframes })}
            >
              Charger
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={!template}
              onClick={async () => {
                if (!template || !confirm(`Supprimer le template « ${template.name} » ?`)) return;
                await deleteTemplate(template.id);
                setTemplateId("");
                router.refresh();
              }}
            >
              Supprimer
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <input aria-label="Nom du nouveau template" value={templateName} onChange={(e) => setTemplateName(e.target.value)} maxLength={60} placeholder="Nom du template" className="input min-w-0 flex-1" />
            <button
              type="button"
              className="btn-ghost"
              disabled={pending || !templateName.trim()}
              onClick={() =>
                run(async () => {
                  const result = await saveTemplate(templateName, edit);
                  if (result.ok) {
                    setTemplateName("");
                    router.refresh();
                  }
                  return result;
                })
              }
            >
              Enregistrer les réglages actuels
            </button>
          </div>
          <button
            type="button"
            className="btn-ghost"
            disabled={pending || idle.length === 0}
            onClick={() =>
              confirm(`Refaire le rendu de ${idle.length} clip(s) de cette source avec les réglages actuels ?`) &&
              run(() => rerenderClips({ ids: idle.map((c) => c.id), edit }))
            }
          >
            Appliquer les réglages actuels à tous les clips de cette source
          </button>
        </Section>

        <div className="card space-y-3">
          {message.error && (
            <p role="alert" className="text-sm text-red-400">
              {message.error}
            </p>
          )}
          {message.ok && (
            <p role="status" className="text-sm text-emerald-400">
              {message.ok}
            </p>
          )}
          <button className="btn" onClick={() => run(() => createClip({ sourceId, title, start, end, edit }))} disabled={pending || !valid}>
            {pending ? "Envoi…" : "Créer le clip"}
          </button>
          <p className="text-xs text-zinc-500">
            Rendu en 1080x1920. La transcription tourne sur le serveur : compte environ la durée du clip sur un
            processeur classique, plus le téléchargement des modèles au tout premier rendu.
          </p>
        </div>
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Clips</h2>
        {clips.length === 0 && <p className="text-sm text-zinc-500">Aucun clip pour cette source.</p>}
        <ul className="space-y-2">
          {clips.map((c) => (
            <li key={c.id} className="card">
              <div className="flex gap-3">
                {c.status === "rendered" && (
                  // eslint-disable-next-line @next/next/no-img-element -- miniature servie par notre route, pas d'optimisation utile
                  <img src={`/api/clips/${c.id}/thumb`} alt="" className="h-24 w-[3.375rem] rounded bg-black object-cover" />
                )}
                <div className="min-w-0">
                  <p className="truncate font-medium">{c.title}</p>
                  <p className="text-xs text-zinc-500">
                    {clock(c.start)} → {clock(c.end)}
                  </p>
                </div>
              </div>
              {c.status === "rendering" && (
                <>
                  <p className="mt-2 text-sm text-violet-300">Rendu {c.progress} %</p>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={c.progress} aria-valuemin={0} aria-valuemax={100}>
                    <div className="h-full rounded bg-violet-500 transition-all" style={{ width: `${c.progress}%` }} />
                  </div>
                </>
              )}
              {c.status === "error" && <p className="mt-2 text-sm text-red-400">{c.error}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                {c.status === "rendered" && (
                  <>
                    <button className="btn-ghost" onClick={() => setPlaying(playing === c.id ? null : c.id)}>
                      {playing === c.id ? "Fermer" : "Voir"}
                    </button>
                    <a className="btn-ghost" href={`/api/clips/${c.id}/video?dl=1`}>
                      MP4
                    </a>
                    {c.hasSrt && (
                      <a className="btn-ghost" href={`/api/clips/${c.id}/srt`}>
                        SRT
                      </a>
                    )}
                    <a className="btn-ghost" href={`/api/clips/${c.id}/thumb?dl=1`}>
                      Miniature
                    </a>
                    <a className="btn-ghost" href={`/app/clips/${c.id}/publier`}>
                      Publier
                    </a>
                    {c.hasWords && !purged && (
                      <button className="btn-ghost" onClick={() => setEditingWords(editingWords === c.id ? null : c.id)}>
                        Sous-titres
                      </button>
                    )}
                  </>
                )}
                {c.status !== "rendering" && !purged && (
                  <button className="btn-ghost" disabled={pending} onClick={() => run(() => rerenderClips({ ids: [c.id], edit }))}>
                    Refaire avec les réglages actuels
                  </button>
                )}
                <button className="btn-ghost" onClick={() => confirm(`Supprimer le clip « ${c.title} » ?`) && deleteClip(c.id)}>
                  Supprimer
                </button>
              </div>
              {editingWords === c.id && c.status === "rendered" && (
                <WordsEditor
                  clipId={c.id}
                  onDone={(m) => {
                    setMessage(m);
                    setEditingWords(null);
                  }}
                />
              )}
              {playing === c.id && c.status === "rendered" && (
                <video className="mx-auto mt-3 max-h-[28rem] rounded bg-black" src={`/api/clips/${c.id}/video`} controls autoPlay />
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
