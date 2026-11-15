import { readdir } from "node:fs/promises";
import path from "node:path";
import { db } from "./db";

const DATA_DIR = path.resolve(process.env.DATA_DIR ?? "../data");

/** Chemin absolu d'un chemin relatif stocké en base (toujours avec des `/`). */
export const abs = (rel: string) => path.join(DATA_DIR, rel);

export async function usedBytes(userId: string): Promise<number> {
  const [sources, clips] = await Promise.all([
    db.source.aggregate({ where: { userId }, _sum: { sizeBytes: true } }),
    db.clip.aggregate({ where: { userId }, _sum: { sizeBytes: true } }),
  ]);
  return Number(sources._sum.sizeBytes ?? 0) + Number(clips._sum.sizeBytes ?? 0);
}

export const quotaBytes = (user: { storageQuotaGb: number }) => user.storageQuotaGb * 1024 ** 3;

/** Liste envoyée au front (bibliothèque + SSE). */
export async function listSources(userId: string) {
  const sources = await db.source.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: { jobs: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  return sources.map((s) => ({
    id: s.id,
    title: s.title,
    kind: s.kind,
    status: s.status,
    error: s.error,
    duration: s.duration,
    sizeBytes: Number(s.sizeBytes),
    progress: s.jobs[0]?.progress ?? 0,
  }));
}

export type SourceRow = Awaited<ReturnType<typeof listSources>>[number];

export async function listClips(userId: string, sourceId: string) {
  const clips = await db.clip.findMany({
    where: { userId, sourceId },
    orderBy: { createdAt: "desc" },
    include: { jobs: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  return clips.map((c) => ({
    id: c.id,
    title: c.title,
    start: c.start,
    end: c.end,
    status: c.status,
    error: c.error,
    hasSrt: c.srtPath !== null,
    hasWords: Array.isArray(c.words) && c.words.length > 0,
    progress: c.jobs[0]?.progress ?? 0,
  }));
}

/** Musiques de l'utilisateur : les noms des fichiers de data/{userId}/music. */
export const listMusic = (userId: string) =>
  readdir(abs(`${userId}/music`)).then(
    (names) => names.sort(),
    () => [] as string[], // dossier pas encore créé
  );

/** Sources prêtes, pour choisir une vidéo secondaire. */
export const listReadySources = (userId: string) =>
  db.source.findMany({ where: { userId, status: "ready" }, orderBy: { createdAt: "desc" }, select: { id: true, title: true } });

export const listTemplates = (userId: string) =>
  db.template.findMany({ where: { userId }, orderBy: { name: "asc" }, select: { id: true, name: true, edit: true } });

/** Tout ce que la page d'une source suit en direct : clips, analyse, moments proposés. */
export async function sourceState(userId: string, sourceId: string) {
  const [clips, analysis, job, candidates] = await Promise.all([
    listClips(userId, sourceId),
    db.analysis.findFirst({ where: { sourceId, userId }, select: { scores: true, notes: true } }),
    db.job.findFirst({ where: { userId, sourceId, type: "analyze" }, orderBy: { createdAt: "desc" } }),
    db.candidate.findMany({ where: { userId, sourceId }, orderBy: { score: "desc" } }),
  ]);
  return {
    clips,
    analysis: {
      scores: (analysis?.scores ?? []) as number[],
      notes: (analysis?.notes ?? []) as string[],
      job: job && { status: job.status, progress: job.progress, error: job.error },
    },
    candidates: candidates.map((c) => ({ id: c.id, start: c.start, end: c.end, score: c.score, title: c.title, reason: c.reason, origin: c.origin })),
  };
}

export type SourceState = Awaited<ReturnType<typeof sourceState>>;

export type ClipRow = Awaited<ReturnType<typeof listClips>>[number];
