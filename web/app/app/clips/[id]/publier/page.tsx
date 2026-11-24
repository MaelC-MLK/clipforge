import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { type ClipMeta, isProvider } from "@/lib/publish";
import { Cover } from "./cover";
import { PublishForm } from "./form";
import { Waiting } from "./waiting";

export default async function PublishPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const clip = await db.clip.findFirst({ where: { id, userId: user.id } });
  if (!clip) notFound();
  // Arrivée depuis « Publier tel quel » : le rendu est encore en cours.
  if (clip.status !== "rendered")
    return (
      <div className="space-y-4">
        <h1 className="page-title truncate">Publier « {clip.title} »</h1>
        {clip.status === "error" ? (
          <p role="alert" className="text-sm text-red-400">
            La préparation de la vidéo a échoué : {clip.error}
          </p>
        ) : (
          <Waiting />
        )}
      </div>
    );
  const accounts = await db.account.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });

  return (
    <div className="space-y-4">
      <Link href={`/app/sources/${clip.sourceId}`} className="text-sm text-zinc-400 hover:text-zinc-200">
        ← Retour au montage
      </Link>
      <h1 className="page-title truncate">Publier « {clip.title} »</h1>
      <div className="grid items-start gap-6 md:grid-cols-[auto_1fr]">
        <Cover clipId={clip.id} />
        <PublishForm
          clipId={clip.id}
          clipTitle={clip.title}
          initialMeta={(clip.meta as ClipMeta | null) ?? null}
          accounts={accounts.flatMap((a) => (isProvider(a.provider) ? [{ id: a.id, provider: a.provider, name: a.name }] : []))}
        />
      </div>
    </div>
  );
}
