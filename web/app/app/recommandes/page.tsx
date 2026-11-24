import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { twitchConfigured } from "@/lib/niches";
import { Recommendations } from "./recommendations";

export default async function RecommendedPage() {
  const user = await requireUser();
  const [niches, clips] = await Promise.all([
    db.niche.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
    db.recommendation.findMany({ where: { userId: user.id, status: { not: "dismissed" } }, orderBy: { views: "desc" }, take: 300 }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Clips recommandés</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Les clips les plus vus de tes niches Twitch et Kick, relevés automatiquement. Importe ceux qui te plaisent pour les monter.
        </p>
      </div>
      <Recommendations
        twitch={twitchConfigured()}
        niches={niches.map((n) => ({
          id: n.id,
          platform: n.platform,
          name: n.name,
          language: n.language,
          period: n.period,
          everyHours: n.everyHours,
          fetchedAt: n.fetchedAt?.toISOString() ?? null,
          error: n.error,
        }))}
        clips={clips.map((c) => ({
          id: c.id,
          nicheId: c.nicheId,
          platform: c.platform,
          url: c.url,
          title: c.title,
          channel: c.channel,
          views: c.views,
          seconds: c.seconds,
          thumbnailUrl: c.thumbnailUrl,
          createdAt: c.clipCreatedAt.toISOString(),
          imported: c.status === "imported",
        }))}
      />
    </div>
  );
}
