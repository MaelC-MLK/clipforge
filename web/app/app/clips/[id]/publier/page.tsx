import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { type ClipMeta, isProvider } from "@/lib/publish";
import { PublishForm } from "./form";

export default async function PublishPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const clip = await db.clip.findFirst({ where: { id, userId: user.id, status: "rendered" } });
  if (!clip) notFound();
  const accounts = await db.account.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });

  return (
    <div className="space-y-4">
      <Link href={`/app/sources/${clip.sourceId}`} className="text-sm text-zinc-400 hover:text-zinc-200">
        ← Retour au montage
      </Link>
      <h1 className="truncate text-xl font-semibold">Publier « {clip.title} »</h1>
      <div className="grid items-start gap-6 md:grid-cols-[auto_1fr]">
        <video className="mx-auto max-h-[28rem] rounded bg-black" src={`/api/clips/${clip.id}/video`} controls />
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
