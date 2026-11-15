import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { sanitizeEdit } from "@/lib/edit";
import { listClips, listMusic, listReadySources, listTemplates } from "@/lib/storage";
import { Editor } from "./editor";

export default async function SourcePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const source = await db.source.findFirst({ where: { id, userId: user.id, status: "ready" } });
  if (!source) notFound();

  return (
    <div className="space-y-4">
      <Link href="/app" className="text-sm text-zinc-400 hover:text-zinc-200">
        ← Bibliothèque
      </Link>
      <h1 className="truncate text-xl font-semibold">{source.title}</h1>
      <Editor
        sourceId={source.id}
        duration={source.duration ?? 0}
        initial={await listClips(user.id, source.id)}
        musicFiles={await listMusic(user.id)}
        sources={(await listReadySources(user.id)).filter((s) => s.id !== source.id)}
        templates={(await listTemplates(user.id)).map((t) => ({ id: t.id, name: t.name, edit: sanitizeEdit(t.edit) }))}
      />
    </div>
  );
}
