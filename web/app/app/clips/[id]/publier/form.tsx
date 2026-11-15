"use client";

import Link from "next/link";
import { useState } from "react";
import { caption, type ClipMeta, PROVIDERS, type Provider } from "@/lib/publish";
import { generateMeta, schedulePublications } from "../../../../actions";

const LANGUAGES = ["français", "English", "español", "Deutsch", "italiano", "português"];

/** Valeur d'un champ datetime-local pour une date, dans le fuseau du navigateur. */
function localInput(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function PublishForm(props: {
  clipId: string;
  clipTitle: string;
  initialMeta: ClipMeta | null;
  accounts: { id: string; provider: Provider; name: string }[];
}) {
  const [meta, setMeta] = useState(props.initialMeta);
  const [language, setLanguage] = useState(props.initialMeta?.language ?? LANGUAGES[0]);
  const fromMeta = (m: ClipMeta | null) => ({
    tiktok: m ? caption({ ...m.tiktok, description: `${m.tiktok.title}\n${m.tiktok.description}` }) : props.clipTitle,
    instagram: m ? caption({ ...m.reels, description: `${m.reels.title}\n${m.reels.description}` }) : props.clipTitle,
    youtubeTitle: m ? m.shorts.title.slice(0, 100) : props.clipTitle.slice(0, 100),
    youtubeDescription: m ? caption(m.shorts) : "",
  });
  const [texts, setTexts] = useState(() => fromMeta(props.initialMeta));
  const [selected, setSelected] = useState<string[]>([]);
  const [sound, setSound] = useState("");
  // Calculée au montage seulement : pas d'heure différente entre le serveur et le navigateur.
  const [when, setWhen] = useState(() => localInput(new Date(Date.now() + 3600 * 1000)));
  const [message, setMessage] = useState<{ error?: string; ok?: string }>({});
  const [pending, setPending] = useState("");

  const chosen = (p: Provider) => props.accounts.some((a) => a.provider === p && selected.includes(a.id));
  const field = (key: keyof typeof texts, label: string, rows: number, max: number) => (
    <div>
      <label className="label" htmlFor={key}>
        {label}
      </label>
      <textarea id={key} rows={rows} maxLength={max} value={texts[key]} onChange={(e) => setTexts({ ...texts, [key]: e.target.value })} className="input" />
    </div>
  );

  return (
    <div className="space-y-4">
      <section className="card space-y-3">
        <h2 className="font-medium">Textes</h2>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="label" htmlFor="language">
              Langue des textes
            </label>
            <select id="language" value={language} onChange={(e) => setLanguage(e.target.value)} className="input">
              {LANGUAGES.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </div>
          <button
            className="btn-ghost"
            disabled={pending !== ""}
            onClick={async () => {
              setPending("meta");
              const result = await generateMeta(props.clipId, language);
              setMessage(result);
              if (result.meta) {
                setMeta(result.meta);
                setTexts(fromMeta(result.meta));
              }
              setPending("");
            }}
          >
            {pending === "meta" ? "Claude écrit…" : meta ? "Réécrire avec Claude" : "Proposer avec Claude"}
          </button>
        </div>
        <p className="text-xs text-zinc-500">Un appel à Claude avec ta clé, de l&apos;ordre d&apos;un centime. Tout reste modifiable.</p>
        {meta && (
          <p className="rounded border border-zinc-800 p-3 text-sm">
            <span className="font-medium text-violet-300">Potentiel estimé : {meta.viralScore} / 100.</span> {meta.viralReason}{" "}
            <span className="text-zinc-500">Estimation indicative, pas une prédiction.</span>
          </p>
        )}
        {field("tiktok", "TikTok : légende", 4, 2200)}
        {field("instagram", "Instagram Reels : légende", 4, 2200)}
        {field("youtubeTitle", "YouTube Shorts : titre (100 caractères au plus)", 1, 100)}
        {field("youtubeDescription", "YouTube Shorts : description", 4, 4000)}
      </section>

      <section className="card space-y-3">
        <h2 className="font-medium">Comptes</h2>
        {props.accounts.length === 0 && (
          <p className="text-sm text-zinc-500">
            Aucun compte connecté.{" "}
            <Link href="/app/reseaux" className="text-violet-400 underline">
              Connecter un réseau
            </Link>
          </p>
        )}
        {props.accounts.map((a) => (
          <label key={a.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={selected.includes(a.id)}
              onChange={(e) => setSelected(e.target.checked ? [...selected, a.id] : selected.filter((id) => id !== a.id))}
            />
            {PROVIDERS[a.provider]} · {a.name}
          </label>
        ))}
        {chosen("tiktok") && (
          <div>
            <label className="label" htmlFor="sound">
              Son TikTok à ajouter (facultatif)
            </label>
            <input id="sound" value={sound} onChange={(e) => setSound(e.target.value)} maxLength={100} placeholder="Nom du son dans TikTok" className="input" />
            <p className="mt-1 text-xs text-zinc-500">
              TikTok ne laisse aucune application choisir un son de sa bibliothèque. Si tu remplis ce champ, la vidéo part en brouillon dans
              ta boîte de réception TikTok : tu l&apos;ouvres dans l&apos;appli, tu ajoutes ce son et tu publies. Pense à faire le rendu du clip
              sans musique pour ne pas doubler le son. 5 brouillons en attente au plus.
            </p>
          </div>
        )}
      </section>

      <section className="card space-y-3">
        <h2 className="font-medium">Date</h2>
        <div>
          <label className="label" htmlFor="when">
            Date et heure de publication (ton fuseau horaire)
          </label>
          <input id="when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="input" />
          <p className="mt-1 text-xs text-zinc-500">Une date passée publie tout de suite.</p>
        </div>
        {message.error && (
          <p role="alert" className="text-sm text-red-400">
            {message.error}
          </p>
        )}
        {message.ok && (
          <p role="status" className="text-sm text-emerald-400">
            {message.ok}{" "}
            {message.ok.includes("planifiée") && (
              <Link href="/app/calendrier" className="underline">
                Voir le calendrier
              </Link>
            )}
          </p>
        )}
        <button
          className="btn"
          disabled={pending !== "" || selected.length === 0 || !when}
          onClick={async () => {
            setPending("schedule");
            setMessage(
              await schedulePublications({ clipId: props.clipId, accountIds: selected, when: new Date(when).toISOString(), texts, tiktokSound: sound }),
            );
            setPending("");
          }}
        >
          {pending === "schedule" ? "Envoi…" : "Planifier"}
        </button>
      </section>
    </div>
  );
}
