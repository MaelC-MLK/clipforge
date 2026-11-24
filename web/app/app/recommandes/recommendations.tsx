"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { addNiche, deleteNiche, dismissRecommendation, fastSource, findCategories, importRecommendation, refreshNiches, updateNiche } from "../../actions";
import { type Category, EVERY_HOURS, LANGUAGES, MAX_NICHES, NICHE_DOTS, NICHE_PLATFORMS, type NichePlatform, PERIODS } from "@/lib/niches";

type Niche = { id: string; platform: string; name: string; language: string; period: string; everyHours: number; fetchedAt: string | null; error: string | null };
type Clip = {
  id: string;
  nicheId: string;
  platform: string;
  url: string;
  title: string;
  channel: string;
  views: number;
  seconds: number;
  thumbnailUrl: string;
  createdAt: string;
  imported: boolean;
};

const views = new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 });
const dot = (p: string) => NICHE_DOTS[p as NichePlatform] ?? "bg-zinc-500";

function ago(iso: string) {
  const minutes = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 60) return `il y a ${minutes} min`;
  if (minutes < 48 * 60) return `il y a ${Math.round(minutes / 60)} h`;
  return `il y a ${Math.round(minutes / 1440)} j`;
}

export function Recommendations({ twitch, niches, clips }: { twitch: boolean; niches: Niche[]; clips: Clip[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<string>("");
  const [message, setMessage] = useState<{ ok?: string; error?: string }>({});
  const [pending, start] = useTransition();
  const waiting = niches.some((n) => !n.fetchedAt);

  // Un relevé est en attente côté worker : on recharge jusqu'à ce qu'il arrive.
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => router.refresh(), 8000);
    return () => clearInterval(timer);
  }, [waiting, router]);

  const shown = clips.filter((c) => !filter || c.nicheId === filter);
  const run = (action: () => Promise<{ ok?: string; error?: string } | void>) =>
    start(async () => {
      const result = await action();
      if (result) setMessage(result);
    });

  return (
    <div className="space-y-6">
      {(message.ok || message.error) && (
        <p
          role={message.error ? "alert" : "status"}
          className={`rounded-xl border px-4 py-2 text-sm ${message.error ? "border-red-400/20 bg-red-500/10 text-red-300" : "border-emerald-400/20 bg-emerald-500/10 text-emerald-300"}`}
        >
          {message.error ?? message.ok}
        </p>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[1fr_22rem]">
        <section className="card space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-semibold">Mes niches</h2>
            <span className="text-xs text-zinc-500">
              {niches.length} / {MAX_NICHES}
            </span>
            {niches.length > 0 && (
              <button className="btn-ghost ml-auto !py-1.5 text-xs" disabled={pending || waiting} onClick={() => run(refreshNiches)}>
                {waiting ? "Relevé en cours…" : "Actualiser maintenant"}
              </button>
            )}
          </div>
          {niches.length === 0 && <p className="text-sm text-zinc-400">Aucune niche pour l&apos;instant. Ajoute une catégorie, par exemple GTA VI ou Just Chatting.</p>}
          <ul className="divide-y divide-white/5">
            {niches.map((n) => (
              <NicheRow key={n.id} niche={n} disabled={pending} onChange={(data) => run(() => updateNiche({ id: n.id, ...data }))} onDelete={() => run(() => deleteNiche(n.id))} />
            ))}
          </ul>
        </section>
        <AddNiche twitch={twitch} full={niches.length >= MAX_NICHES} onAdded={setMessage} />
      </div>

      <section className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Chip active={!filter} onClick={() => setFilter("")}>
            Toutes ({clips.length})
          </Chip>
          {niches.map((n) => (
            <Chip key={n.id} active={filter === n.id} onClick={() => setFilter(n.id)}>
              <span className={`h-2 w-2 rounded-full ${dot(n.platform)}`} />
              {n.name} ({clips.filter((c) => c.nicheId === n.id).length})
            </Chip>
          ))}
        </div>

        {shown.length === 0 ? (
          <p className="card text-sm text-zinc-400">{waiting ? "Recherche des clips les plus vus…" : "Pas encore de clip ici."}</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {shown.map((c) => (
              <article key={c.id} className="card flex flex-col gap-3 !p-3">
                <a href={c.url} target="_blank" rel="noreferrer" className="relative block aspect-video overflow-hidden rounded-lg bg-black">
                  {c.thumbnailUrl && (
                    // eslint-disable-next-line @next/next/no-img-element -- miniature hébergée par Twitch ou Kick
                    <img src={c.thumbnailUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                  )}
                  <span className="absolute bottom-1.5 right-1.5 rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-medium">{Math.round(c.seconds)} s</span>
                  <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-semibold">
                    <span className={`h-1.5 w-1.5 rounded-full ${dot(c.platform)}`} />
                    {views.format(c.views)} vues
                  </span>
                </a>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm font-medium" title={c.title}>
                    {c.title || "Sans titre"}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {c.channel} · {ago(c.createdAt)}
                  </p>
                </div>
                <div className="flex gap-2">
                  {c.imported ? (
                    <span className="badge">Importé</span>
                  ) : (
                    <>
                      <button
                        className="btn flex-1 !py-1.5 text-xs"
                        disabled={pending}
                        title="Titre, réglages rapides et programmation, sans passer par l'éditeur"
                        onClick={() =>
                          start(async () => {
                            const r = await fastSource({ recoId: c.id });
                            if ("error" in r) setMessage(r);
                            else router.push(`/app/fast/${r.id}`);
                          })
                        }
                      >
                        Fast clip
                      </button>
                      <button className="btn-ghost !py-1.5 text-xs" disabled={pending} onClick={() => run(() => importRecommendation(c.id))}>
                        Importer
                      </button>
                    </>
                  )}
                  <button className="btn-ghost !py-1.5 text-xs" disabled={pending} onClick={() => run(() => dismissRecommendation(c.id))}>
                    {c.imported ? "Masquer" : "Ignorer"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
        <p className="text-xs text-zinc-500">
          N&apos;importe et ne republie que des clips dont tu as l&apos;autorisation du créateur. Les clips qui ne remontent plus depuis une semaine
          disparaissent.
        </p>
      </section>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition ${
        active ? "border-violet-400/50 bg-violet-500/20 text-white" : "border-white/10 text-zinc-400 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function Settings({
  platform,
  value,
  onChange,
  disabled,
}: {
  platform: string;
  value: { language: string; period: string; everyHours: number };
  onChange: (v: { language: string; period: string; everyHours: number }) => void;
  disabled?: boolean;
}) {
  const select = "input !w-auto !py-1.5 text-xs";
  return (
    <div className="flex flex-wrap gap-2">
      {platform === "twitch" && (
        <select aria-label="Langue" className={select} disabled={disabled} value={value.language} onChange={(e) => onChange({ ...value, language: e.target.value })}>
          {Object.entries(LANGUAGES).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      )}
      <select aria-label="Période" className={select} disabled={disabled} value={value.period} onChange={(e) => onChange({ ...value, period: e.target.value })}>
        {Object.entries(PERIODS).map(([k, label]) => (
          <option key={k} value={k}>
            {label}
          </option>
        ))}
      </select>
      <select
        aria-label="Fréquence"
        className={select}
        disabled={disabled}
        value={value.everyHours}
        onChange={(e) => onChange({ ...value, everyHours: Number(e.target.value) })}
      >
        {EVERY_HOURS.map((h) => (
          <option key={h} value={h}>
            Toutes les {h} h
          </option>
        ))}
      </select>
    </div>
  );
}

function NicheRow({
  niche,
  disabled,
  onChange,
  onDelete,
}: {
  niche: Niche;
  disabled: boolean;
  onChange: (v: { language: string; period: string; everyHours: number }) => void;
  onDelete: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
      <div className="min-w-40 flex-1">
        <p className="flex items-center gap-2 font-medium">
          <span className={`h-2 w-2 rounded-full ${dot(niche.platform)}`} />
          {niche.name}
          <span className="text-xs font-normal text-zinc-500">{NICHE_PLATFORMS[niche.platform as NichePlatform]}</span>
        </p>
        <p className={`mt-0.5 text-xs ${niche.error ? "text-red-400" : "text-zinc-500"}`}>
          {niche.error ?? (niche.fetchedAt ? `Relevé ${ago(niche.fetchedAt)}` : "Relevé en attente…")}
        </p>
      </div>
      <Settings platform={niche.platform} value={niche} onChange={onChange} disabled={disabled} />
      <button className="text-xs text-zinc-500 hover:text-red-400" disabled={disabled} onClick={onDelete}>
        Retirer
      </button>
    </li>
  );
}

function AddNiche({ twitch, full, onAdded }: { twitch: boolean; full: boolean; onAdded: (m: { ok?: string; error?: string }) => void }) {
  const [platform, setPlatform] = useState<NichePlatform>(twitch ? "twitch" : "kick");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Category[]>([]);
  const [error, setError] = useState("");
  const [settings, setSettings] = useState({ language: "fr", period: "day", everyHours: 6 });
  const [pending, start] = useTransition();

  // Recherche au fil de la frappe, une demi-seconde après la dernière touche.
  useEffect(() => {
    if (query.trim().length < 2) return;
    const timer = setTimeout(async () => {
      const r = await findCategories(platform, query);
      if ("error" in r) {
        setError(r.error);
        setResults([]);
      } else {
        setError("");
        setResults(r.categories);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [platform, query]);

  const add = (c: Category) =>
    start(async () => {
      const r = await addNiche({ platform, categoryId: c.id, name: c.name, ...settings });
      onAdded(r);
      if (r.ok) {
        setQuery("");
        setResults([]);
      }
    });

  return (
    <section className="card space-y-3">
      <h2 className="font-semibold">Ajouter une niche</h2>
      <div className="flex gap-2">
        {(Object.keys(NICHE_PLATFORMS) as NichePlatform[]).map((p) => (
          <button
            key={p}
            onClick={() => {
              setPlatform(p);
              setResults([]);
              setError("");
            }}
            className={`inline-flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition ${
              platform === p ? "border-violet-400/50 bg-violet-500/20 text-white" : "border-white/10 text-zinc-400 hover:text-white"
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${NICHE_DOTS[p]}`} />
            {NICHE_PLATFORMS[p]}
          </button>
        ))}
      </div>
      {platform === "twitch" && !twitch ? (
        <p className="text-sm text-zinc-400">Twitch n&apos;est pas encore disponible sur Hooklip.</p>
      ) : (
        <>
          <input
            className="input"
            placeholder="Catégorie : GTA, Just Chatting, IRL…"
            value={query}
            disabled={full}
            onChange={(e) => {
              setQuery(e.target.value);
              if (e.target.value.trim().length < 2) setResults([]);
            }}
          />
          <Settings platform={platform} value={settings} onChange={setSettings} />
          {full && <p className="text-sm text-zinc-400">{MAX_NICHES} niches au plus : retires-en une pour en ajouter.</p>}
          {error && <p className="text-sm text-red-400">{error}</p>}
          {results.length > 0 && (
            <ul className="max-h-64 space-y-1 overflow-y-auto">
              {results.map((c) => (
                <li key={c.id}>
                  <button
                    className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-white/5 disabled:opacity-50"
                    disabled={pending}
                    onClick={() => add(c)}
                  >
                    {c.name}
                    <span className="text-xs text-violet-300">Ajouter</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
