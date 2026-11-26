import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isProvider, PROVIDERS } from "@/lib/publish";
import { RefreshStats } from "./refresh";

const number = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("fr-FR"));

export default async function DashboardPage() {
  const user = await requireUser();
  const [sources, clips, publications, accounts] = await Promise.all([
    db.source.count({ where: { userId: user.id } }),
    db.clip.count({ where: { userId: user.id, status: "rendered" } }),
    db.publication.findMany({ where: { userId: user.id }, include: { clip: { select: { title: true } }, account: { select: { name: true, provider: true } } } }),
    db.account.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
  ]);
  const count = (status: string[], accountId?: string) => publications.filter((p) => status.includes(p.status) && (!accountId || p.accountId === accountId)).length;
  const sum = (key: "views" | "likes", accountId?: string) => {
    const values = publications.filter((p) => p[key] != null && (!accountId || p.accountId === accountId)).map((p) => p[key] ?? 0);
    return values.length ? values.reduce((a, b) => a + b, 0) : null;
  };
  const tiles: [string, string][] = [
    ["Sources importées", number(sources)],
    ["Clips produits", number(clips)],
    ["Publiés", number(count(["published", "draft_sent"]))],
    ["Planifiés", number(count(["scheduled", "publishing"]))],
    ["En échec", number(count(["failed"]))],
    ["Vues relevées", number(sum("views"))],
  ];
  const lastStats = publications.map((p) => p.statsAt?.getTime() ?? 0).reduce((a, b) => Math.max(a, b), 0);
  const top = publications.filter((p) => p.status === "published").sort((a, b) => (b.views ?? -1) - (a.views ?? -1)).slice(0, 10);

  return (
    <div className="space-y-6">
      <h1 className="page-title">Statistiques</h1>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map(([label, value]) => (
          <div key={label} className="card !p-4">
            <p className="text-xs text-zinc-400">{label}</p>
            <p className={`mt-1 text-3xl font-bold tabular-nums ${label === "En échec" && value !== "0" ? "text-red-400" : ""}`}>{value}</p>
          </div>
        ))}
      </div>

      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-medium">Par compte</h2>
          <RefreshStats />
        </div>
        <p className="mt-1 text-xs text-zinc-500">
          {lastStats ? `Statistiques relevées le ${new Date(lastStats).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} (UTC).` : "Statistiques jamais relevées."}{" "}
          YouTube donne les vues et les « J&apos;aime », Instagram les « J&apos;aime » seulement, TikTok rien par cette connexion.
        </p>
        {accounts.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">Aucun compte connecté.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-zinc-500">
                <tr>
                  <th className="py-1 pr-4 font-normal">Compte</th>
                  <th className="py-1 pr-4 font-normal">Publiés</th>
                  <th className="py-1 pr-4 font-normal">Planifiés</th>
                  <th className="py-1 pr-4 font-normal">Échecs</th>
                  <th className="py-1 pr-4 font-normal">Vues</th>
                  <th className="py-1 font-normal">J&apos;aime</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id} className="border-t border-white/10">
                    <td className="py-2 pr-4">
                      {isProvider(a.provider) ? PROVIDERS[a.provider] : a.provider} · {a.name}
                    </td>
                    <td className="py-2 pr-4">{count(["published", "draft_sent"], a.id)}</td>
                    <td className="py-2 pr-4">{count(["scheduled", "publishing"], a.id)}</td>
                    <td className="py-2 pr-4">{count(["failed"], a.id)}</td>
                    <td className="py-2 pr-4">{number(sum("views", a.id))}</td>
                    <td className="py-2">{number(sum("likes", a.id))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2 className="font-medium">Posts publiés</h2>
        {top.length === 0 && <p className="mt-2 text-sm text-zinc-500">Rien de publié pour l&apos;instant.</p>}
        <ul className="mt-2 divide-y divide-white/10 text-sm">
          {top.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
              <span className="min-w-0 truncate">
                {p.postUrl ? (
                  <a href={p.postUrl} target="_blank" rel="noreferrer" className="underline decoration-zinc-600 underline-offset-2 hover:text-white">
                    {p.clip.title}
                  </a>
                ) : (
                  p.clip.title
                )}
                <span className="text-zinc-500"> · {isProvider(p.account.provider) ? PROVIDERS[p.account.provider] : p.account.provider}</span>
              </span>
              <span className="text-zinc-400">
                {number(p.views)} vues · {number(p.likes)} j&apos;aime
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
