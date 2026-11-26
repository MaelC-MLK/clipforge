import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { PROVIDER_DOTS, isProvider } from "@/lib/publish";

const PATHS = [
  {
    href: "/app/fast",
    title: "Fast clip",
    text: "Tu as déjà une vidéo courte ou un clip recommandé : titre, deux ou trois réglages, programmation.",
    action: "Publier une vidéo courte",
    icon: "M13 2 4 14h7l-1 8 9-12h-7z",
  },
  {
    href: "/app/sources",
    title: "Découper",
    text: "Un live, une VOD ou un reportage : repère les meilleurs moments ou coupe tout en parties de 1:01.",
    action: "Tirer des clips d'une longue vidéo",
    icon: "M6 9a3 3 0 100-6 3 3 0 000 6zM6 21a3 3 0 100-6 3 3 0 000 6zM20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12",
  },
  {
    href: "/app/recommandes",
    title: "Recommandés",
    text: "Les clips les plus vus de tes niches Twitch et Kick, relevés automatiquement.",
    action: "Trouver des clips",
    icon: "M12 3c.5 3.5 5 5.5 5 10.5a5 5 0 01-10 0c0-2.5 1.5-4 2.5-5 .5 1.5 1.5 2.5 2.5 2.5 0-3-.5-5.5 0-8z",
  },
];

export default async function HomePage() {
  const user = await requireUser();
  const [ready, working, failed, next, accounts] = await Promise.all([
    db.clip.count({ where: { userId: user.id, status: "rendered", publications: { none: {} } } }),
    Promise.all([
      db.source.count({ where: { userId: user.id, status: { in: ["downloading", "analyzing"] } } }),
      db.clip.count({ where: { userId: user.id, status: "rendering" } }),
    ]).then(([a, b]) => a + b),
    db.publication.count({ where: { userId: user.id, status: "failed" } }),
    db.publication.findMany({
      where: { userId: user.id, status: "scheduled" },
      orderBy: { scheduledAt: "asc" },
      take: 4,
      include: { clip: { select: { title: true } }, account: { select: { provider: true, name: true } } },
    }),
    db.account.count({ where: { userId: user.id } }),
  ]);

  const todo = [
    working > 0 && { href: "/app/videos", text: `${working} import${working > 1 ? "s" : ""} ou rendu${working > 1 ? "s" : ""} en cours`, tone: "text-violet-300" },
    ready > 0 && { href: "/app/videos", text: `${ready} vidéo${ready > 1 ? "s" : ""} prête${ready > 1 ? "s" : ""}, jamais publiée${ready > 1 ? "s" : ""}`, tone: "text-emerald-300" },
    failed > 0 && { href: "/app/calendrier", text: `${failed} publication${failed > 1 ? "s" : ""} en échec`, tone: "text-red-400" },
    accounts === 0 && { href: "/app/reseaux", text: "Aucun réseau connecté : connecte YouTube, TikTok ou Instagram", tone: "text-amber-300" },
  ].filter((x): x is { href: string; text: string; tone: string } => Boolean(x));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">Que veux-tu faire ?</h1>
        <p className="mt-1 text-sm text-zinc-400">Trois façons de créer. Tout ce qui est rendu arrive dans Vidéos prêtes, puis part sur le Calendrier.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {PATHS.map((p) => (
          <Link key={p.href} href={p.href} className="card group flex flex-col gap-3 transition hover:-translate-y-0.5 hover:border-violet-400/40">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-blue-600 shadow-lg shadow-violet-950/50">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={p.icon} />
              </svg>
            </span>
            <h2 className="text-lg font-semibold">{p.title}</h2>
            <p className="flex-1 text-sm text-zinc-400">{p.text}</p>
            <span className="text-sm font-medium text-violet-300 group-hover:text-violet-200">{p.action} →</span>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card space-y-3">
          <h2 className="font-semibold">À faire</h2>
          {todo.length === 0 ? (
            <p className="text-sm text-zinc-400">Rien en attente.</p>
          ) : (
            <ul className="space-y-2">
              {todo.map((t) => (
                <li key={t.text}>
                  <Link href={t.href} className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm hover:bg-white/5 ${t.tone}`}>
                    {t.text}
                    <span className="text-zinc-500">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Prochaines publications</h2>
            <Link href="/app/calendrier" className="text-xs text-violet-300 hover:text-violet-200">
              Calendrier →
            </Link>
          </div>
          {next.length === 0 ? (
            <p className="text-sm text-zinc-400">Aucune publication programmée.</p>
          ) : (
            <ul className="space-y-2">
              {next.map((p) => (
                <li key={p.id} className="flex items-center gap-3 text-sm">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${isProvider(p.account.provider) ? PROVIDER_DOTS[p.account.provider] : "bg-zinc-500"}`} />
                  <span className="min-w-0 flex-1 truncate">{p.clip.title}</span>
                  <span className="shrink-0 text-xs text-zinc-500">
                    {p.scheduledAt.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
