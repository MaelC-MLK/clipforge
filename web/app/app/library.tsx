"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import type { LibraryState } from "@/lib/storage";
import { MAX_CLIP_SECONDS, uploadVideo, VIDEO_EXT } from "@/lib/upload";
import { deleteClip, deleteSource, importUrl, prepareFinal, publishSource } from "../actions";

const STATUS: Record<string, string> = {
  downloading: "Téléchargement",
  analyzing: "Préparation",
  ready: "Prêt",
  error: "Erreur",
  purged: "Vidéo supprimée, clips gardés",
  rendering: "Rendu",
  rendered: "Prêt à publier",
};
const TONE: Record<string, string> = { error: "text-red-400", ready: "text-emerald-400", rendered: "text-emerald-400" };

function formatDuration(seconds: number | null) {
  if (!seconds) return "";
  const s = Math.round(seconds);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

function Badge({ status, progress }: { status: string; progress: number }) {
  const busy = status === "downloading" || status === "analyzing" || status === "rendering";
  return (
    <span className={`badge ${TONE[status] ?? "text-violet-300"}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {STATUS[status] ?? status}
      {busy && ` ${progress} %`}
    </span>
  );
}

const Bar = ({ progress }: { progress: number }) => (
  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
    <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-blue-500 transition-all" style={{ width: `${progress}%` }} />
  </div>
);

/** Deux pages sur les mêmes données, tenues à jour en direct : les sources à découper, ou les vidéos prêtes à publier. */
export function Library({ initial, view }: { initial: LibraryState; view: "sources" | "videos" }) {
  const [{ sources, clips }, setState] = useState(initial);
  const [playing, setPlaying] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const asked = useRef(new Set<string>()); // vidéos finales dont le clip a déjà été demandé

  // Progression en temps réel : le serveur pousse la bibliothèque à chaque changement.
  useEffect(() => {
    const events = new EventSource("/api/events");
    events.onmessage = (e) => setState(JSON.parse(e.data));
    return () => events.close();
  }, []);

  const raw = sources.filter((s) => !s.final);
  // Vidéo finale encore sans clip : en cours d'import, en erreur, ou tout juste prête.
  const pending = sources.filter((s) => s.final && !clips.some((c) => c.sourceId === s.id));

  // Une vidéo finale prête devient un clip entier, sans montage : c'est lui qui se publie.
  useEffect(() => {
    for (const s of sources) {
      if (!s.final || s.status !== "ready" || asked.current.has(s.id) || clips.some((c) => c.sourceId === s.id)) continue;
      asked.current.add(s.id);
      prepareFinal(s.id).then((result) => result.error && setErrors((e) => ({ ...e, [s.id]: result.error ?? "" })));
    }
  }, [sources, clips]);

  const empty = (text: string) => <p className="rounded-2xl border border-dashed border-white/15 px-5 py-10 text-center text-sm text-zinc-400">{text}</p>;

  return (
    <div className="space-y-6">
      {view === "sources" ? (
        <>
          <div>
            <h1 className="page-title">Découper</h1>
            <p className="mt-1 text-sm text-zinc-400">
              Importe une longue vidéo (live, VOD, reportage), puis ouvre-la pour en tirer des clips : à la main, par l&apos;analyse des
              meilleurs moments ou en découpage automatique. Les clips rendus arrivent dans Vidéos prêtes.
            </p>
          </div>
          <section className="space-y-3">
            <div className="grid gap-4 md:grid-cols-2">
              <UrlForm />
              <UploadForm />
            </div>
            <p className="text-xs text-zinc-500">
              Vidéo courte déjà montée ? Passe plutôt par{" "}
              <Link href="/app/fast" className="text-violet-300 hover:underline">
                Fast clip
              </Link>
              . Rappel : n&apos;importe que du contenu dont tu détiens les droits ou l&apos;autorisation du créateur.
            </p>
          </section>
        </>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1">
            <h1 className="page-title">Vidéos prêtes</h1>
            <p className="mt-1 text-sm text-zinc-400">Tous tes clips rendus, à publier, programmer ou télécharger.</p>
          </div>
          <Link href="/app/fast" className="btn">
            Nouveau fast clip
          </Link>
          <Link href="/app/sources" className="btn-ghost">
            Découper une vidéo
          </Link>
        </div>
      )}

      <section>
        {view === "sources" && (
          <>
            <h2 className="mb-3 text-lg font-semibold">
              Mes sources <span className="text-sm font-normal text-zinc-500">· {raw.length}</span>
            </h2>
            {raw.length === 0 && empty("Aucune source pour l'instant. Importe une longue vidéo ci-dessus.")}
            <ul className="space-y-2">
              {raw.map((s) => (
                <li key={s.id} className="card">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{s.title}</p>
                      <p className="text-xs text-zinc-500">
                        {s.kind} {formatDuration(s.duration) && `· ${formatDuration(s.duration)}`}
                        {s.sizeBytes > 0 && ` · ${(s.sizeBytes / 1024 ** 2).toFixed(0)} Mo`}
                      </p>
                    </div>
                    <Badge status={s.status} progress={s.progress} />
                    {s.status === "purged" && (
                      <Link href={`/app/sources/${s.id}`} className="btn-ghost">
                        Voir les clips
                      </Link>
                    )}
                    {s.status === "ready" && (
                      <>
                        <Link href={`/app/sources/${s.id}`} className="btn">
                          Créer des clips
                        </Link>
                        {(s.duration ?? Infinity) <= MAX_CLIP_SECONDS && (
                          <button
                            className="btn-ghost"
                            title="Publie la vidéo entière, sans montage. Une vidéo horizontale est recadrée au centre."
                            onClick={async () => {
                              const result = await publishSource(s.id);
                              if (result?.error) alert(result.error);
                            }}
                          >
                            Publier tel quel
                          </button>
                        )}
                        <button className="btn-ghost" onClick={() => setPlaying(playing === s.id ? null : s.id)}>
                          {playing === s.id ? "Fermer" : "Voir"}
                        </button>
                      </>
                    )}
                    <button className="btn-ghost" onClick={() => confirm(`Supprimer « ${s.title} », ses clips et ses fichiers ?`) && deleteSource(s.id)}>
                      Supprimer
                    </button>
                  </div>
                  {(s.status === "downloading" || s.status === "analyzing") && <Bar progress={s.progress} />}
                  {s.error && <p className="mt-2 text-sm text-red-400">{s.error}</p>}
                  {playing === s.id && <video className="mt-3 max-h-96 w-full rounded-xl bg-black" src={`/api/sources/${s.id}/video`} controls autoPlay />}
                </li>
              ))}
            </ul>
          </>
        )}

        {view === "videos" && (
          <>
            {clips.length + pending.length === 0 && empty("Aucune vidéo prête. Crée un fast clip, ou tire des clips d'une longue vidéo dans Découper.")}
            <ul className="grid gap-3 sm:grid-cols-2">
              {pending.map((s) => (
                <li key={s.id} className="card">
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="min-w-0 flex-1 truncate font-medium">{s.title}</p>
                    <Badge status={s.status === "ready" ? "analyzing" : s.status} progress={s.progress} />
                  </div>
                  {(s.status === "downloading" || s.status === "analyzing") && <Bar progress={s.progress} />}
                  {(s.error || errors[s.id]) && <p className="mt-2 text-sm text-red-400">{s.error || errors[s.id]}</p>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {errors[s.id] && (
                      <Link href={`/app/sources/${s.id}`} className="btn-ghost">
                        La découper
                      </Link>
                    )}
                    <button className="btn-ghost" onClick={() => confirm(`Supprimer « ${s.title} » et ses fichiers ?`) && deleteSource(s.id)}>
                      Supprimer
                    </button>
                  </div>
                </li>
              ))}
              {clips.map((c) => (
                <li key={c.id} className="card">
                  <div className="flex gap-3">
                    {c.status === "rendered" ? (
                      // eslint-disable-next-line @next/next/no-img-element -- miniature servie par notre route, pas d'optimisation utile
                      <img src={`/api/clips/${c.id}/thumb`} alt="" className="h-28 w-[3.9375rem] shrink-0 rounded-lg bg-black object-cover" />
                    ) : (
                      <div className="h-28 w-[3.9375rem] shrink-0 rounded-lg bg-white/5" />
                    )}
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <p className="truncate font-medium">{c.title}</p>
                      <p className="truncate text-xs text-zinc-500">
                        {formatDuration(c.seconds)} · {c.fromFinal ? "vidéo importée" : `clip de « ${c.sourceTitle} »`}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge status={c.status} progress={c.progress} />
                        {c.posts > 0 && (
                          <span className="badge text-zinc-300">
                            {c.posts} publication{c.posts > 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  {c.status === "rendering" && <Bar progress={c.progress} />}
                  {c.error && <p className="mt-2 text-sm text-red-400">{c.error}</p>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {c.status === "rendered" && (
                      <>
                        <Link href={`/app/clips/${c.id}/publier`} className="btn">
                          Publier
                        </Link>
                        <button className="btn-ghost" onClick={() => setPlaying(playing === c.id ? null : c.id)}>
                          {playing === c.id ? "Fermer" : "Voir"}
                        </button>
                        <a className="btn-ghost" href={`/api/clips/${c.id}/video?dl=1`}>
                          MP4
                        </a>
                      </>
                    )}
                    <Link href={`/app/sources/${c.sourceId}`} className="btn-ghost">
                      Monter
                    </Link>
                    <button
                      className="btn-ghost"
                      onClick={() => {
                        if (!confirm(`Supprimer « ${c.title} » ? Ses publications planifiées et son historique disparaissent aussi.`)) return;
                        // Une vidéo importée déjà montée part avec sa source, sinon elle serait recréée.
                        if (c.fromFinal) deleteSource(c.sourceId);
                        else deleteClip(c.id);
                      }}
                    >
                      Supprimer
                    </button>
                  </div>
                  {playing === c.id && <video className="mx-auto mt-3 max-h-96 rounded-xl bg-black" src={`/api/clips/${c.id}/video`} controls autoPlay />}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

function UrlForm() {
  const [state, action, pending] = useActionState(importUrl, {});
  return (
    <form action={action} className="card space-y-3">
      <label className="label" htmlFor="url">
        Depuis une URL
      </label>
      <input id="url" name="url" type="url" required placeholder="https://www.youtube.com/watch?v=…" className="input" />
      <p className="text-xs text-zinc-500">YouTube, VOD Twitch, VOD Kick ou tout site supporté par yt-dlp. La vidéo est téléchargée et gardée dans ton espace.</p>
      {state.error && (
        <p role="alert" className="text-sm text-red-400">
          {state.error}
        </p>
      )}
      <button className="btn" disabled={pending}>
        {pending ? "Envoi…" : "Importer"}
      </button>
    </form>
  );
}

function UploadForm() {
  const input = useRef<HTMLInputElement>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const [error, setError] = useState("");

  async function upload(file: File) {
    setError("");
    setPercent(0);
    const result = await uploadVideo(file, false, setPercent);
    setPercent(null);
    if ("error" in result) return setError(result.error);
    if (input.current) input.current.value = "";
  }

  return (
    <div className="card space-y-3">
      <label className="label" htmlFor="file">
        Depuis un fichier
      </label>
      <input
        id="file"
        ref={input}
        type="file"
        accept={VIDEO_EXT.join(",")}
        disabled={percent !== null}
        onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
        className="block w-full text-sm text-zinc-300 file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-zinc-100 hover:file:bg-white/15"
      />
      <p className="text-xs text-zinc-500">Formats : {VIDEO_EXT.join(", ")}. Les gros fichiers sont envoyés par morceaux.</p>
      {percent !== null && <p className="text-sm text-violet-300">Envoi… {percent} %</p>}
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
