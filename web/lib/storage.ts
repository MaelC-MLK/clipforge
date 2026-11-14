import path from "node:path";
import { db } from "./db";

const DATA_DIR = path.resolve(process.env.DATA_DIR ?? "../data");

/** Chemin absolu d'un chemin relatif stocké en base (toujours avec des `/`). */
export const abs = (rel: string) => path.join(DATA_DIR, rel);

export async function usedBytes(userId: string): Promise<number> {
  const r = await db.source.aggregate({ where: { userId }, _sum: { sizeBytes: true } });
  return Number(r._sum.sizeBytes ?? 0);
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
