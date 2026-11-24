import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { listMusic } from "@/lib/storage";
import { MAX_CLIP_SECONDS } from "@/lib/upload";
import { FastForm } from "./form";
import { Refresh } from "./refresh";

export default async function FastSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const source = await db.source.findFirst({ where: { id, userId: user.id } });
  if (!source) notFound();

  const back = (
    <Link href="/app/fast" className="text-sm text-zinc-400 hover:text-zinc-200">
      ← Fast clip
    </Link>
  );

  if (source.status === "error")
    return (
      <div className="space-y-4">
        {back}
        <h1 className="page-title">Fast clip</h1>
        <p role="alert" className="card text-sm text-red-400">
          L&apos;import a échoué : {source.error}
        </p>
      </div>
    );

  if (source.status !== "ready") {
    const job = await db.job.findFirst({ where: { sourceId: source.id, type: "ingest" }, orderBy: { createdAt: "desc" } });
    return (
      <div className="space-y-4">
        {back}
        <h1 className="page-title">Fast clip</h1>
        <div className="card space-y-3" role="status">
          <p className="text-sm text-violet-200">Récupération de la vidéo… {job?.progress ?? 0} %</p>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-blue-500 transition-all" style={{ width: `${job?.progress ?? 0}%` }} />
          </div>
          <p className="text-xs text-zinc-500">Les réglages s&apos;affichent dès qu&apos;elle est prête.</p>
        </div>
        <Refresh />
      </div>
    );
  }

  if ((source.duration ?? 0) > MAX_CLIP_SECONDS)
    return (
      <div className="space-y-4">
        {back}
        <h1 className="page-title">Fast clip</h1>
        <p className="card text-sm text-zinc-300">
          Cette vidéo dure plus de {MAX_CLIP_SECONDS / 60} minutes : elle est trop longue pour un fast clip.{" "}
          <Link href={`/app/sources/${source.id}`} className="text-violet-300 hover:underline">
            Découpe-la dans l&apos;éditeur
          </Link>
          .
        </p>
      </div>
    );

  return (
    <div className="space-y-4">
      {back}
      <h1 className="page-title">Fast clip</h1>
      <FastForm sourceId={source.id} title={source.title} duration={source.duration ?? 0} music={await listMusic(user.id)} />
    </div>
  );
}
