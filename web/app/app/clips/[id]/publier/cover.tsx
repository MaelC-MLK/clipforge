"use client";

import { useRef, useState } from "react";

/** Aperçu du clip et choix de sa miniature : une image de la vidéo ou un fichier, convertis en JPEG dans le navigateur. */
export function Cover({ clipId }: { clipId: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [version, setVersion] = useState(0); // change l'adresse de l'image pour contourner le cache
  const [message, setMessage] = useState<{ error?: string; ok?: string }>({});

  async function send(source: CanvasImageSource, width: number, height: number) {
    if (!width || !height) return setMessage({ error: "Image illisible." });
    const scale = Math.min(1, 1920 / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    canvas.getContext("2d")?.drawImage(source, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
    const res = blob && (await fetch(`/api/clips/${clipId}/thumb`, { method: "POST", body: blob }).catch(() => null));
    if (!res?.ok) return setMessage({ error: (await res?.json().catch(() => null))?.error ?? "Envoi de la miniature impossible." });
    setVersion(Date.now());
    setMessage({ ok: "Miniature enregistrée." });
  }

  return (
    <div className="mx-auto w-full max-w-64 space-y-3">
      <video ref={video} className="max-h-[28rem] w-full rounded-xl bg-black" src={`/api/clips/${clipId}/video`} controls />
      <div className="card space-y-2 !p-3">
        <p className="text-sm font-medium">Miniature</p>
        {/* eslint-disable-next-line @next/next/no-img-element -- miniature servie par notre route, pas d'optimisation utile */}
        <img src={`/api/clips/${clipId}/thumb?v=${version}`} alt="Miniature actuelle" className="mx-auto h-40 rounded-lg bg-black object-contain" />
        <button className="btn-ghost w-full" onClick={() => video.current && send(video.current, video.current.videoWidth, video.current.videoHeight)}>
          Prendre l&apos;image affichée
        </button>
        <label className="btn-ghost w-full cursor-pointer focus-within:ring-2 focus-within:ring-violet-500/50">
          Importer une image
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              const image = file && (await createImageBitmap(file).catch(() => null));
              if (image) await send(image, image.width, image.height);
              else if (file) setMessage({ error: "Image illisible." });
            }}
          />
        </label>
        <p className="text-xs text-zinc-500">Mets la vidéo en pause sur l&apos;image voulue, ou importe un fichier. Envoyée à YouTube avec la vidéo.</p>
        {message.error && (
          <p role="alert" className="text-xs text-red-400">
            {message.error}
          </p>
        )}
        {message.ok && (
          <p role="status" className="text-xs text-emerald-400">
            {message.ok}
          </p>
        )}
      </div>
    </div>
  );
}
