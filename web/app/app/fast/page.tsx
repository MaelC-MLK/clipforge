import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Chooser } from "./chooser";

export default async function FastPage() {
  const user = await requireUser();
  const recos = await db.recommendation.findMany({
    where: { userId: user.id, status: "new", seconds: { lte: 180 } },
    orderBy: { views: "desc" },
    take: 12,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Fast clip</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Une vidéo déjà à la bonne durée : ajoute un titre, deux ou trois réglages, et programme-la. Pas de découpe.
        </p>
      </div>
      <Chooser
        recos={recos.map((r) => ({ id: r.id, title: r.title, channel: r.channel, views: r.views, seconds: r.seconds, thumbnailUrl: r.thumbnailUrl, platform: r.platform }))}
      />
    </div>
  );
}
