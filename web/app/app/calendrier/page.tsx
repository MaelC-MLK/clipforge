import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isProvider } from "@/lib/publish";
import { Calendar } from "./calendar";

export default async function CalendarPage() {
  const user = await requireUser();
  const rows = await db.publication.findMany({
    where: { userId: user.id },
    orderBy: { scheduledAt: "desc" },
    take: 500,
    include: { clip: { select: { title: true } }, account: { select: { name: true, provider: true } } },
  });

  return (
    <div className="space-y-4">
      <h1 className="page-title">Calendrier des publications</h1>
      <Calendar
        items={rows.flatMap((p) =>
          isProvider(p.account.provider)
            ? [
                {
                  id: p.id,
                  clipId: p.clipId,
                  clipTitle: p.clip.title,
                  provider: p.account.provider,
                  account: p.account.name,
                  at: p.scheduledAt.toISOString(),
                  status: p.status,
                  postUrl: p.postUrl,
                  error: p.error,
                  note: p.note,
                  sound: p.tiktokSound,
                  title: p.title,
                  description: p.description,
                },
              ]
            : [],
        )}
      />
    </div>
  );
}
