import { appendFile, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { abs, quotaBytes, usedBytes } from "@/lib/storage";
import { CHUNK, VIDEO_EXT } from "@/lib/upload";

const fail = (status: number, error: string) => Response.json({ error }, { status });

// Upload par morceaux : le navigateur envoie les morceaux dans l'ordre, un par requête.
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return fail(401, "Non connecté.");

  const h = req.headers;
  const uploadId = h.get("x-upload-id") ?? "";
  const index = Number(h.get("x-chunk-index"));
  const total = Number(h.get("x-chunk-total"));
  const name = path.basename(decodeURIComponent(h.get("x-filename") ?? ""));
  const ext = path.extname(name).toLowerCase();

  if (!/^[0-9a-f-]{36}$/.test(uploadId) || !Number.isInteger(index) || !Number.isInteger(total) || index < 0 || index >= total)
    return fail(400, "Requête invalide.");
  if (!VIDEO_EXT.includes(ext)) return fail(415, `Format non supporté. Formats acceptés : ${VIDEO_EXT.join(", ")}`);

  const chunk = Buffer.from(await req.arrayBuffer());
  if (chunk.length === 0 || chunk.length > CHUNK) return fail(413, "Morceau trop gros.");

  const dir = abs(`${user.id}/uploads`);
  await mkdir(dir, { recursive: true });
  const part = path.join(dir, `${uploadId}.part`);

  const written = index === 0 ? 0 : ((await stat(part).catch(() => null))?.size ?? -1);
  if (written !== index * CHUNK) return fail(409, "Morceau reçu dans le désordre. Relance l'upload.");
  if ((await usedBytes(user.id)) + written + chunk.length > quotaBytes(user)) {
    await rm(part, { force: true });
    return fail(413, "Quota de stockage dépassé.");
  }

  await (index === 0 ? writeFile : appendFile)(part, chunk);
  if (index < total - 1) return Response.json({ ok: true });

  // Dernier morceau : le fichier devient une source et part en traitement.
  const source = await db.source.create({
    data: { userId: user.id, kind: "upload", title: path.basename(name, ext).slice(0, 200) || "Sans titre", status: "analyzing" },
  });
  const rel = `${user.id}/sources/${source.id}/source${ext}`;
  await mkdir(path.dirname(abs(rel)), { recursive: true });
  await rename(part, abs(rel));
  await db.source.update({ where: { id: source.id }, data: { filePath: rel } });
  await db.job.create({
    data: { userId: user.id, sourceId: source.id, type: "ingest", payload: { sourceId: source.id } },
  });
  return Response.json({ ok: true, sourceId: source.id });
}
