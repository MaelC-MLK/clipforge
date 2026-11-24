import { readdir, stat, statfs } from "node:fs/promises";
import path from "node:path";
import { db } from "./db";

const DATA_DIR = path.resolve(process.env.DATA_DIR ?? "../data");

/** Chemin absolu d'un chemin relatif stocké en base (toujours avec des `/`). */
export const abs = (rel: string) => path.join(DATA_DIR, rel);

/** Espace occupé : sources et clips en base, plus les envois en cours (fichiers .part). */
export async function usedBytes(userId: string): Promise<number> {
  const dir = abs(`${userId}/uploads`);
  const [sources, clips, parts] = await Promise.all([
    db.source.aggregate({ where: { userId }, _sum: { sizeBytes: true } }),
    db.clip.aggregate({ where: { userId }, _sum: { sizeBytes: true } }),
    readdir(dir).then(
      (names) => Promise.all(names.map((n) => stat(path.join(dir, n)).then((s) => s.size, () => 0))),
      () => [] as number[], // dossier pas encore créé
    ),
  ]);
  return Number(sources._sum.sizeBytes ?? 0) + Number(clips._sum.sizeBytes ?? 0) + parts.reduce((a, b) => a + b, 0);
}

export const quotaBytes = (user: { storageQuotaGb: number }) => user.storageQuotaGb * 1024 ** 3;

// Espace minimum à laisser libre sur le serveur, tous comptes confondus (même réglage dans worker/worker.py).
const MIN_FREE_BYTES = Number(process.env.MIN_FREE_GB || 20) * 1024 ** 3;

/** Message d'erreur si l'utilisateur ne peut plus rien ajouter (quota ou disque du serveur), sinon null. */
export async function storageError(user: { id: string; storageQuotaGb: number }, adding = 0): Promise<string | null> {
  const disk = await statfs(DATA_DIR).catch(() => null);
  if (disk && disk.bavail * disk.bsize - adding < MIN_FREE_BYTES) return "Le serveur est presque plein : les imports et les rendus sont suspendus pour le moment.";
  if ((await usedBytes(user.id)) + adding > quotaBytes(user))
    return `Quota de stockage atteint (${user.storageQuotaGb} Go). Supprime des sources ou des clips pour continuer.`;
  return null;
}

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
    final: s.final,
    status: s.status,
    error: s.error,
    duration: s.duration,
    sizeBytes: Number(s.sizeBytes),
    progress: s.jobs[0]?.progress ?? 0,
  }));
}

export type SourceRow = Awaited<ReturnType<typeof listSources>>[number];

/** Bibliothèque envoyée au front (page + SSE) : les sources et tous les clips de l'utilisateur. */
export async function listLibrary(userId: string) {
  const [sources, clips] = await Promise.all([
    listSources(userId),
    db.clip.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: { jobs: { orderBy: { createdAt: "desc" }, take: 1 }, source: { select: { title: true, final: true } }, _count: { select: { publications: true } } },
    }),
  ]);
  return {
    sources,
    clips: clips.map((c) => ({
      id: c.id,
      title: c.title,
      sourceId: c.sourceId,
      sourceTitle: c.source.title,
      fromFinal: c.source.final,
      seconds: c.end - c.start,
      status: c.status,
      error: c.error,
      progress: c.jobs[0]?.progress ?? 0,
      posts: c._count.publications,
    })),
  };
}

export type LibraryState = Awaited<ReturnType<typeof listLibrary>>;

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
