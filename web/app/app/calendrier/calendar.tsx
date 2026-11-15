"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { PROVIDERS, type Provider, STATUS_LABELS } from "@/lib/publish";
import { cancelPublication, retryPublication } from "../../actions";

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

  useEffect(() => {
    // Les statuts changent côté worker : on relit la page régulièrement.
    const timer = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(timer);
  }, [router]);

  const time = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

  const row = (p: Item) => (
    <li key={p.id} className="card space-y-1">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="min-w-0 truncate font-medium">{p.clipTitle}</p>
        <span className={`text-sm ${COLORS[p.status] ?? ""}`}>{STATUS_LABELS[p.status] ?? p.status}</span>
      </div>
      <p className="text-xs text-zinc-500">
        {PROVIDERS[p.provider]} · {p.account} · {new Date(p.at).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}
      </p>
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
        {(p.status === "scheduled" || p.status === "failed") && (
          <button
            className="btn-ghost"
            onClick={async () => {
              if (!confirm("Supprimer cette publication ?")) return;
              await cancelPublication(p.id);
              router.refresh();
            }}
          >
            {p.status === "scheduled" ? "Annuler" : "Supprimer"}
          </button>
        )}
      </div>
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
          <div className="grid grid-cols-7 gap-px overflow-hidden rounded border border-zinc-800 bg-zinc-800 text-xs">
            {DAYS.map((d) => (
              <div key={d} className="bg-zinc-950 p-1 text-center text-zinc-500">
                {d}
              </div>
            ))}
            {cells.map((day) => (
              <div key={day.toISOString()} className={`min-h-20 bg-zinc-950 p-1 ${day.getMonth() === month.getMonth() ? "" : "opacity-40"}`}>
                <div className={sameDay(day, new Date()) ? "font-bold text-violet-400" : "text-zinc-500"}>{day.getDate()}</div>
                {items
                  .filter((p) => sameDay(new Date(p.at), day))
                  .sort((a, b) => a.at.localeCompare(b.at))
                  .map((p) => (
                    <div key={p.id} className={`truncate ${COLORS[p.status] ?? ""}`} title={`${PROVIDERS[p.provider]} · ${p.account} · ${STATUS_LABELS[p.status] ?? p.status}`}>
                      {time(p.at)} {p.clipTitle}
                    </div>
                  ))}
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-zinc-500">Gris : en attente. Vert : publié. Jaune : brouillon TikTok à finir. Rouge : échec. Détails dans la vue Liste.</p>
        </div>
      )}

      {view === "list" && mounted && <ul className="space-y-2">{items.map(row)}</ul>}
      {view === "calendar" && mounted && items.some((p) => p.status === "failed" || p.status === "draft_sent") && (
        <div>
          <h2 className="mb-2 font-medium">À traiter</h2>
          <ul className="space-y-2">{items.filter((p) => p.status === "failed" || p.status === "draft_sent").map(row)}</ul>
        </div>
      )}
    </div>
  );
}
