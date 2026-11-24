"use client";

import { useState, useTransition } from "react";
import { DEFAULT_EDIT, type Edit } from "@/lib/edit";
import { fastClip } from "../../../actions";

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-violet-500" />
      {label}
    </label>
  );
}

function Choice<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-2">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`flex-1 rounded-lg border px-3 py-1.5 text-sm transition ${
            value === v ? "border-violet-400/50 bg-violet-500/20 text-white" : "border-white/10 text-zinc-400 hover:text-white"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Étape 2 : quelques réglages sur toute la vidéo, puis rendu et page de publication. */
export function FastForm({ sourceId, title: initialTitle, duration, music }: { sourceId: string; title: string; duration: number; music: string[] }) {
  const [title, setTitle] = useState(initialTitle);
  const [edit, setEdit] = useState<Edit>({ ...DEFAULT_EDIT, crop: "center", subtitles: false });
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const set = <K extends keyof Edit>(key: K, value: Edit[K]) => setEdit((e) => ({ ...e, [key]: value }));

  const submit = () =>
    start(async () => {
      setError("");
      const r = await fastClip({ sourceId, title, edit });
      if (r?.error) setError(r.error);
    });

  return (
    <div className="grid items-start gap-6 md:grid-cols-[auto_1fr]">
      {/* Aperçu approximatif : recadrage centré et position du texte, le rendu final se fait sur le serveur. */}
      <div className="relative mx-auto aspect-[9/16] w-56 overflow-hidden rounded-2xl bg-black shadow-xl shadow-violet-950/50 sm:w-64">
        <video src={`/api/sources/${sourceId}/video`} className="h-full w-full object-cover" muted autoPlay loop playsInline />
        {edit.hook.trim() && (
          <span className="absolute inset-x-4 top-[10%] mx-auto w-fit rounded-md bg-white px-2.5 py-1 text-center text-sm font-bold leading-tight text-black">
            {edit.hook}
          </span>
        )}
        {edit.subtitles && (
          <span className="absolute inset-x-0 bottom-[22%] text-center text-lg font-black text-white [text-shadow:0_2px_0_#000,0_0_8px_#000]">
            SOUS-<span style={{ color: edit.subStyle.color }}>TITRES</span>
          </span>
        )}
        {edit.progressBar && <span className="absolute bottom-0 left-0 h-1.5 w-2/5 bg-yellow-300" />}
        <span className="absolute right-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px]">{Math.round(duration)} s</span>
      </div>

      <div className="card space-y-5">
        <div>
          <label className="label" htmlFor="fastTitle">
            Nom du clip
          </label>
          <input id="fastTitle" className="input" maxLength={150} value={title} onChange={(e) => setTitle(e.target.value)} />
          <p className="mt-1 text-xs text-zinc-500">Repris comme titre YouTube ; tu le modifies encore à l&apos;étape suivante.</p>
        </div>

        <div className="space-y-2">
          <label className="label" htmlFor="fastHook">
            Titre ou message à l&apos;écran
          </label>
          <input
            id="fastHook"
            className="input"
            maxLength={80}
            placeholder="Il ne s'attendait pas à ça…"
            value={edit.hook}
            onChange={(e) => set("hook", e.target.value)}
          />
          <Choice
            value={edit.hookFull ? "full" : "start"}
            options={[
              ["start", "3 premières secondes"],
              ["full", "Toute la vidéo"],
            ]}
            onChange={(v) => set("hookFull", v === "full")}
          />
        </div>

        <div className="space-y-2">
          <span className="label">Cadrage vertical</span>
          <Choice
            value={edit.crop === "face" ? "face" : "center"}
            options={[
              ["center", "Centré"],
              ["face", "Suivre le visage"],
            ]}
            onChange={(v) => set("crop", v)}
          />
          <p className="text-xs text-zinc-500">Une vidéo déjà verticale reste telle quelle.</p>
        </div>

        <div className="space-y-2">
          <Toggle label="Sous-titres automatiques" checked={edit.subtitles} onChange={(v) => set("subtitles", v)} />
          {edit.subtitles && (
            <Choice
              value={edit.subStyle.preset}
              options={[
                ["karaoke", "Karaoké"],
                ["big", "Un mot à la fois"],
              ]}
              onChange={(v) => set("subStyle", { ...edit.subStyle, preset: v })}
            />
          )}
          <Toggle label="Barre de progression" checked={edit.progressBar} onChange={(v) => set("progressBar", v)} />
          <Toggle label="Volume normalisé" checked={edit.loudnorm} onChange={(v) => set("loudnorm", v)} />
          <Toggle label="Garder seulement la voix (retire la musique du stream)" checked={edit.voiceOnly} onChange={(v) => set("voiceOnly", v)} />
          <Toggle label="Réduire le bruit de fond" checked={edit.denoise} onChange={(v) => set("denoise", v)} />
        </div>

        {music.length > 0 && (
          <div>
            <label className="label" htmlFor="fastMusic">
              Musique de fond
            </label>
            <select id="fastMusic" className="input" value={edit.music} onChange={(e) => set("music", e.target.value)}>
              <option value="">Aucune</option>
              {music.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}
        <button className="btn w-full" disabled={pending} onClick={submit}>
          {pending ? "Envoi…" : "Rendre et programmer →"}
        </button>
      </div>
    </div>
  );
}
