"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { PROVIDER_DOTS, PROVIDERS, type Provider, STATUS_LABELS } from "@/lib/publish";
import { cancelPublication, retryPublication, updatePublication } from "../../actions";
import { localInput } from "../clips/[id]/publier/form";

type Item = {
  id: string;
  clipId: string;
  clipTitle: string;
  provider: Provider;
  account: string;
  at: string;
  status: string;
  postUrl: string | null;
  error: string | null;
  note: string | null;
  sound: string;
  title: string;
  description: string;
};

const COLORS: Record<string, string> = {
  scheduled: "text-zinc-300",
  publishing: "text-violet-300",
  published: "text-emerald-400",
  draft_sent: "text-amber-300",
  failed: "text-red-400",
};
const DAYS = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function Calendar({ items }: { items: Item[] }) {
  const router = useRouter();
  const [view, setView] = useState<"calendar" | "list">("calendar");
  // Dates et heures dépendent du fuseau du navigateur, inconnu du serveur : rien n'est affiché avant le montage.
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const [offset, setOffset] = useState(0); // mois affiché, par rapport au mois en cours
  const today = new Date();
  const month = mounted ? new Date(today.getFullYear(), today.getMonth() + offset, 1) : null;
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null); // publication ouverte depuis la grille
  const [editing, setEditing] = useState<{ id: string; when: string; title: string; description: string } | null>(null);
  const selectedItem = items.find((p) => p.id === selected);

  useEffect(() => {
    // Les statuts changent côté worker : on relit la page régulièrement.
    const timer = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(timer);
  }, [router]);

  const time = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

  const row = (p: Item) => (
    <li key={p.id} className="card space-y-1">
      <div className="flex gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- miniature servie par notre route, pas d'optimisation utile */}
        <img src={`/api/clips/${p.clipId}/thumb`} alt="" className="h-20 w-[2.8125rem] shrink-0 rounded-lg bg-black object-cover" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="min-w-0 truncate font-medium">{p.clipTitle}</p>
            <span className={`badge ${COLORS[p.status] ?? ""}`}>{STATUS_LABELS[p.status] ?? p.status}</span>
          </div>
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-400">
            <span className={`h-2 w-2 rounded-full ${PROVIDER_DOTS[p.provider]}`} />
            {PROVIDERS[p.provider]} · {p.account}
          </p>
          <p className="text-xs text-zinc-500">{new Date(p.at).toLocaleString("fr-FR", { dateStyle: "full", timeStyle: "short" })}</p>
        </div>
      </div>
      {p.status === "failed" && (
        <p role="alert" className="text-sm text-red-400">
          {p.error} Tu peux télécharger le clip et le publier à la main.
        </p>
      )}
      {p.status === "draft_sent" && (
        <p className="text-sm text-amber-300">
          À finir dans l&apos;appli TikTok : ouvre la notification, {p.sound ? `ajoute le son « ${p.sound} »` : "vérifie la vidéo"} et publie.
        </p>
      )}
      {p.status === "scheduled" && p.sound && <p className="text-xs text-zinc-500">Partira en brouillon TikTok, son à ajouter : « {p.sound} ».</p>}
      {p.note && <p className="text-xs text-zinc-500">{p.note}</p>}
      <div className="flex flex-wrap gap-2 pt-1">
        {p.postUrl && (
          <a className="btn-ghost" href={p.postUrl} target="_blank" rel="noreferrer">
            Voir le post
          </a>
        )}
        {p.status === "failed" && (
          <>
            <button className="btn-ghost" onClick={async () => { setMessage((await retryPublication(p.id)).ok ?? ""); router.refresh(); }}>
              Réessayer
            </button>
            <a className="btn-ghost" href={`/api/clips/${p.clipId}/video?dl=1`}>
              Télécharger le clip
            </a>
          </>
        )}
        {p.status === "scheduled" && (
          <button
            className="btn-ghost"
            onClick={() => setEditing(editing?.id === p.id ? null : { id: p.id, when: localInput(new Date(p.at)), title: p.title, description: p.description })}
          >
            {editing?.id === p.id ? "Fermer" : "Modifier"}
          </button>
        )}
        {p.status !== "publishing" && (
          <button
            className="btn-ghost"
            onClick={async () => {
              const online = p.status === "published" || p.status === "draft_sent";
              const question = online
                ? `Retirer ce post de Hooklip ? Il reste en ligne sur ${PROVIDERS[p.provider]} : supprime-le aussi là-bas si tu ne veux plus qu'il soit visible.`
                : "Supprimer cette publication ?";
              if (!confirm(question)) return;
              await cancelPublication(p.id);
              router.refresh();
            }}
          >
            {p.status === "scheduled" ? "Annuler" : p.status === "failed" ? "Supprimer" : "Retirer de Hooklip"}
          </button>
        )}
      </div>
      {editing?.id === p.id && (
        <div className="mt-2 space-y-3 border-t border-white/10 pt-3">
          <div>
            <label className="label" htmlFor={`when-${p.id}`}>
              Date et heure de publication (ton fuseau horaire)
            </label>
            <input id={`when-${p.id}`} type="datetime-local" value={editing.when} onChange={(e) => setEditing({ ...editing, when: e.target.value })} className="input" />
            <p className="mt-1 text-xs text-zinc-500">Une date passée publie tout de suite.</p>
          </div>
          {p.provider === "youtube" && (
            <div>
              <label className="label" htmlFor={`title-${p.id}`}>
                Titre (100 caractères au plus)
              </label>
              <input id={`title-${p.id}`} maxLength={100} value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} className="input" />
            </div>
          )}
          <div>
            <label className="label" htmlFor={`description-${p.id}`}>
              {p.provider === "youtube" ? "Description" : "Légende"}
            </label>
            <textarea
              id={`description-${p.id}`}
              rows={4}
              maxLength={p.provider === "youtube" ? 4000 : 2200}
              value={editing.description}
              onChange={(e) => setEditing({ ...editing, description: e.target.value })}
              className="input"
            />
          </div>
          <button
            className="btn"
            disabled={!editing.when}
            onClick={async () => {
              const result = await updatePublication({ ...editing, when: new Date(editing.when).toISOString() });
              setError(result.error ?? "");
              setMessage(result.ok ?? "");
              if (result.ok) setEditing(null);
              router.refresh();
            }}
          >
            Enregistrer
          </button>
        </div>
      )}
    </li>
  );

  // Grille du mois : commence un lundi, six semaines au plus.
  const cells: Date[] = [];
  if (month) {
    const first = new Date(month);
    first.setDate(1 - ((month.getDay() + 6) % 7));
    for (let i = 0; i < 42; i++) cells.push(new Date(first.getFullYear(), first.getMonth(), first.getDate() + i));
    while (cells.length > 35 && cells[cells.length - 7].getMonth() !== month.getMonth()) cells.splice(-7);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button className={view === "calendar" ? "btn" : "btn-ghost"} onClick={() => setView("calendar")}>
          Calendrier
        </button>
        <button className={view === "list" ? "btn" : "btn-ghost"} onClick={() => setView("list")}>
          Liste
        </button>
        {message && (
          <span role="status" className="text-sm text-emerald-400">
            {message}
          </span>
        )}
        {error && (
          <span role="alert" className="text-sm text-red-400">
            {error}
          </span>
        )}
      </div>
      {items.length === 0 && <p className="text-sm text-zinc-500">Aucune publication. Ouvre un clip rendu et clique sur « Publier ».</p>}

      {view === "calendar" && month && (
        <div>
          <div className="mb-2 flex items-center gap-3">
            <button className="btn-ghost" aria-label="Mois précédent" onClick={() => setOffset(offset - 1)}>
              ←
            </button>
            <h2 className="w-40 text-center font-medium capitalize">{month.toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}</h2>
            <button className="btn-ghost" aria-label="Mois suivant" onClick={() => setOffset(offset + 1)}>
              →
            </button>
          </div>
          <div className="grid grid-cols-7 gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 text-xs">
            {DAYS.map((d) => (
              <div key={d} className="bg-[#0b0a14] p-2 text-center text-zinc-500">
                {d}
              </div>
            ))}
            {cells.map((day) => (
              <div key={day.toISOString()} className={`min-h-24 bg-[#0b0a14] p-1.5 ${day.getMonth() === month.getMonth() ? "" : "opacity-40"}`}>
                <div className={sameDay(day, new Date()) ? "font-bold text-violet-400" : "text-zinc-500"}>{day.getDate()}</div>
                {items
                  .filter((p) => sameDay(new Date(p.at), day))
                  .sort((a, b) => a.at.localeCompare(b.at))
                  .map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={`mt-1 flex w-full items-center gap-1.5 rounded-md p-0.5 text-left hover:bg-white/10 ${selected === p.id ? "bg-white/10 ring-1 ring-violet-400/60" : ""}`}
                      title={`${p.clipTitle} · ${PROVIDERS[p.provider]} · ${p.account} · ${STATUS_LABELS[p.status] ?? p.status}`}
                      onClick={() => setSelected(selected === p.id ? null : p.id)}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- miniature servie par notre route, pas d'optimisation utile */}
                      <img src={`/api/clips/${p.clipId}/thumb`} alt="" className="hidden h-9 w-5 shrink-0 rounded-sm bg-black object-cover sm:block" />
                      <span className="min-w-0 flex-1">
                        <span className={`flex items-center gap-1 font-medium ${COLORS[p.status] ?? ""}`}>
                          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${PROVIDER_DOTS[p.provider]}`} />
                          {time(p.at)}
                        </span>
                        <span className="block truncate text-zinc-400">{p.clipTitle}</span>
                      </span>
                    </button>
                  ))}
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-zinc-500">Heure en gris : en attente. Vert : publié. Jaune : brouillon TikTok à finir. Rouge : échec. Pastille : rouge YouTube, bleue TikTok, rose Instagram. Clique sur une publication pour la modifier ou l&apos;annuler.</p>
        </div>
      )}

      {view === "calendar" && mounted && selectedItem && (
        <div>
          <h2 className="mb-2 font-medium">Publication sélectionnée</h2>
          <ul className="space-y-2">{row(selectedItem)}</ul>
        </div>
      )}
      {view === "list" && mounted && <ul className="space-y-2">{items.map(row)}</ul>}
      {view === "calendar" && mounted && items.some((p) => p.status === "failed" || p.status === "draft_sent") && (
        <div>
          <h2 className="mb-2 font-medium">À traiter</h2>
          <ul className="space-y-2">{items.filter((p) => p.id !== selected && (p.status === "failed" || p.status === "draft_sent")).map(row)}</ul>
        </div>
      )}
    </div>
  );
}
