import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { estimateAnalysisUsd, monthSpentUsd } from "@/lib/cost";
import { sanitizeEdit } from "@/lib/edit";
import { listMusic, listReadySources, listTemplates, sourceState } from "@/lib/storage";
import { Editor } from "./editor";

export default async function SourcePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const source = await db.source.findFirst({ where: { id, userId: user.id, status: { in: ["ready", "purged"] } } });
  if (!source) notFound();

  return (
    <div className="space-y-4">
      <Link href="/app" className="text-sm text-zinc-400 hover:text-zinc-200">
        ← Bibliothèque
      </Link>
      <h1 className="truncate text-xl font-semibold">{source.title}</h1>
      <Editor
        purged={source.status === "purged"}
        sourceId={source.id}
        duration={source.duration ?? 0}
        initial={await sourceState(user.id, source.id)}
        estimateUsd={estimateAnalysisUsd(source.duration ?? 0)}
        budgetLeftUsd={Math.max(user.monthlyBudgetUsd - (await monthSpentUsd(user.id)), 0)}
        musicFiles={await listMusic(user.id)}
        sources={(await listReadySources(user.id)).filter((s) => s.id !== source.id)}
        templates={(await listTemplates(user.id)).map((t) => ({ id: t.id, name: t.name, edit: sanitizeEdit(t.edit) }))}
      />
    </div>
  );
}
