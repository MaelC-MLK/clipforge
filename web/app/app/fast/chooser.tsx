"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { NICHE_DOTS, type NichePlatform } from "@/lib/niches";
import { uploadVideo, VIDEO_EXT } from "@/lib/upload";
import { fastSource } from "../../actions";

type Reco = { id: string; title: string; channel: string; views: number; seconds: number; thumbnailUrl: string; platform: string };

const views = new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 });

/** Étape 1 : d'où vient la vidéo. Chaque choix crée une source puis ouvre ses réglages. */
export function Chooser({ recos }: { recos: Reco[] }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [percent, setPercent] = useState<number | null>(null);
  const [url, setUrl] = useState("");
  const [pending, start] = useTransition();
  const busy = pending || percent !== null;

  const go = (action: () => Promise<{ error: string } | { id: string }>) =>
    start(async () => {
      setError("");
      const r = await action();
      if ("error" in r) setError(r.error);
      else router.push(`/app/fast/${r.id}`);
    });

  async function upload(file: File) {
    setError("");
    setPercent(0);
    const r = await uploadVideo(file, false, setPercent);
    setPercent(null);
    if ("error" in r) setError(r.error);
    else router.push(`/app/fast/${r.sourceId}`);
  }

  return (
    <div className="space-y-6">
      {error && (
        <p role="alert" className="rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <section className="card space-y-3">
          <h2 className="font-semibold">Envoyer un clip</h2>
          <label
            className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 px-4 py-8 text-center text-sm text-zinc-400 transition hover:border-violet-400/50 hover:bg-white/5 ${busy ? "pointer-events-none opacity-60" : ""}`}
          >
            <svg viewBox="0 0 24 24" className="h-7 w-7 text-violet-300" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 16V4m0 0-4 4m4-4 4 4M4 20h16" />
            </svg>
            {percent !== null ? <span className="text-violet-300">Envoi… {percent} %</span> : "Choisis un fichier (3 minutes au plus)"}
            <span className="text-xs text-zinc-500">{VIDEO_EXT.join(", ")}</span>
            <input type="file" accept={VIDEO_EXT.join(",")} className="sr-only" disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
        </section>
        <section className="card space-y-3">
          <h2 className="font-semibold">Ou coller un lien</h2>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              go(() => fastSource({ url }));
            }}
          >
            <input className="input" type="url" required placeholder="https://www.twitch.tv/…/clip/…" value={url} onChange={(e) => setUrl(e.target.value)} />
            <button className="btn w-full" disabled={busy || !url}>
              {pending ? "Import…" : "Continuer"}
            </button>
          </form>
          <p className="text-xs text-zinc-500">Clip Twitch ou Kick, Short YouTube, ou toute vidéo de moins de 3 minutes.</p>
        </section>
      </div>

      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <h2 className="font-semibold">Ou partir d&apos;un clip recommandé</h2>
          <Link href="/app/recommandes" className="ml-auto text-xs text-violet-300 hover:text-violet-200">
            Tous les recommandés →
          </Link>
        </div>
        {recos.length === 0 ? (
          <p className="card text-sm text-zinc-400">
            Aucun clip recommandé pour l&apos;instant. Ajoute des niches dans{" "}
            <Link href="/app/recommandes" className="text-violet-300 hover:underline">
              Recommandés
            </Link>
            .
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {recos.map((r) => (
              <button
                key={r.id}
                disabled={busy}
                onClick={() => go(() => fastSource({ recoId: r.id }))}
                className="card group flex flex-col gap-2 !p-3 text-left transition hover:border-violet-400/40 disabled:opacity-60"
              >
                <span className="relative block aspect-video w-full overflow-hidden rounded-lg bg-black">
                  {r.thumbnailUrl && (
                    // eslint-disable-next-line @next/next/no-img-element -- miniature hébergée par Twitch ou Kick
                    <img src={r.thumbnailUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                  )}
                  <span className="absolute bottom-1.5 right-1.5 rounded bg-black/75 px-1.5 py-0.5 text-[11px]">{Math.round(r.seconds)} s</span>
                  <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-semibold">
                    <span className={`h-1.5 w-1.5 rounded-full ${NICHE_DOTS[r.platform as NichePlatform] ?? "bg-zinc-500"}`} />
                    {views.format(r.views)} vues
                  </span>
                  <span className="absolute inset-0 flex items-center justify-center bg-violet-600/60 text-sm font-semibold opacity-0 transition group-hover:opacity-100">
                    Fast clip →
                  </span>
                </span>
                <span className="line-clamp-2 text-sm font-medium">{r.title || "Sans titre"}</span>
                <span className="text-xs text-zinc-500">{r.channel}</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
