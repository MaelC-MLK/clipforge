"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import type { SourceRow } from "@/lib/storage";
import { CHUNK, VIDEO_EXT } from "@/lib/upload";
import { deleteSource, importUrl } from "../actions";

const STATUS: Record<string, string> = {
  downloading: "Téléchargement",
  analyzing: "Préparation",
  ready: "Prêt",
  error: "Erreur",
  purged: "Vidéo supprimée, clips gardés",
};

function formatDuration(seconds: number | null) {
  if (!seconds) return "";
  const s = Math.round(seconds);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

export function Library({ initial }: { initial: SourceRow[] }) {
  const [sources, setSources] = useState(initial);
  const [playing, setPlaying] = useState<string | null>(null);

  // Progression en temps réel : le serveur pousse la liste à chaque changement.
  useEffect(() => {
    const events = new EventSource("/api/events");
    events.onmessage = (e) => setSources(JSON.parse(e.data));
    return () => events.close();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Bibliothèque</h1>
        <p className="mt-1 text-sm text-zinc-400">Importe une vidéo, puis découpe-la en clips verticaux.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <UrlForm />
        <UploadForm />
      </div>
      <p className="text-xs text-zinc-500">
        Rappel : n&apos;importe que du contenu dont tu détiens les droits ou pour lequel tu as l&apos;autorisation du
        créateur.
      </p>

      <section>
        <h2 className="mb-3 text-lg font-semibold">
          Sources {sources.length > 0 && <span className="text-sm font-normal text-zinc-500">· {sources.length}</span>}
        </h2>
        {sources.length === 0 && (
          <p className="rounded-2xl border border-dashed border-white/15 px-5 py-10 text-center text-sm text-zinc-400">
            Aucune source pour l&apos;instant. Colle un lien ou envoie un fichier ci-dessus pour commencer.
          </p>
        )}
        <ul className="space-y-2">
          {sources.map((s) => (
            <li key={s.id} className="card">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{s.title}</p>
                  <p className="text-xs text-zinc-500">
                    {s.kind} {formatDuration(s.duration) && `· ${formatDuration(s.duration)}`}
                    {s.sizeBytes > 0 && ` · ${(s.sizeBytes / 1024 ** 2).toFixed(0)} Mo`}
                  </p>
                </div>
                <span className={`badge ${s.status === "error" ? "text-red-400" : s.status === "ready" ? "text-emerald-400" : "text-violet-300"}`}>
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  {STATUS[s.status] ?? s.status}
                  {(s.status === "downloading" || s.status === "analyzing") && ` ${s.progress} %`}
                </span>
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
                    <button className="btn-ghost" onClick={() => setPlaying(playing === s.id ? null : s.id)}>
                      {playing === s.id ? "Fermer" : "Voir"}
                    </button>
                  </>
                )}
                <button
                  className="btn-ghost"
                  onClick={() => confirm(`Supprimer « ${s.title} » et ses fichiers ?`) && deleteSource(s.id)}
                >
                  Supprimer
                </button>
              </div>
              {(s.status === "downloading" || s.status === "analyzing") && (
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={s.progress} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-blue-500 transition-all" style={{ width: `${s.progress}%` }} />
                </div>
              )}
              {s.error && <p className="mt-2 text-sm text-red-400">{s.error}</p>}
              {playing === s.id && <video className="mt-3 max-h-96 w-full rounded-xl bg-black" src={`/api/sources/${s.id}/video`} controls autoPlay />}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function UrlForm() {
  const [state, action, pending] = useActionState(importUrl, {});
  return (
    <form action={action} className="card space-y-3">
      <label className="label" htmlFor="url">
        Importer depuis une URL
      </label>
      <input id="url" name="url" type="url" required placeholder="https://www.youtube.com/watch?v=…" className="input" />
      <p className="text-xs text-zinc-500">YouTube, VOD Twitch, VOD Kick ou tout site supporté par yt-dlp.</p>
      {state.error && <p role="alert" className="text-sm text-red-400">{state.error}</p>}
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
    const uploadId = crypto.randomUUID();
    const total = Math.max(1, Math.ceil(file.size / CHUNK));
    for (let index = 0; index < total; index++) {
      const res = await fetch("/api/upload", {
        method: "POST",
        headers: {
          "x-upload-id": uploadId,
          "x-chunk-index": String(index),
          "x-chunk-total": String(total),
          "x-filename": encodeURIComponent(file.name),
        },
        body: file.slice(index * CHUNK, (index + 1) * CHUNK),
      }).catch(() => null);
      if (!res?.ok) {
        setError((await res?.json().catch(() => null))?.error ?? "Connexion interrompue pendant l'envoi.");
        setPercent(null);
        return;
      }
      setPercent(Math.round(((index + 1) / total) * 100));
    }
    setPercent(null);
    if (input.current) input.current.value = "";
  }

  return (
    <div className="card space-y-3">
      <label className="label" htmlFor="file">
        Envoyer un fichier
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
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
