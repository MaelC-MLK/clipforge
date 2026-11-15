import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getUser } from "@/lib/auth";
import { abs, listMusic } from "@/lib/storage";
import { MAX_MUSIC_BYTES, MAX_MUSIC_FILES, MUSIC_EXT } from "@/lib/upload";

const fail = (status: number, error: string) => Response.json({ error }, { status });

// Ajoute une musique à la bibliothèque de l'utilisateur. Répond avec la liste à jour.
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return fail(401, "Non connecté.");

  // Nom réduit à des caractères sûrs : il sert de nom de fichier et d'identifiant.
  const name = path
    .basename(decodeURIComponent(req.headers.get("x-filename") ?? ""))
    .replace(/[^\p{L}\p{N} ._-]/gu, "_")
    .slice(-100);
  if (!MUSIC_EXT.includes(path.extname(name).toLowerCase()) || name.startsWith("."))
    return fail(415, `Format non supporté. Formats acceptés : ${MUSIC_EXT.join(", ")}`);
  if (Number(req.headers.get("content-length")) > MAX_MUSIC_BYTES) return fail(413, "Musique trop lourde (30 Mo au maximum).");

  const existing = await listMusic(user.id);
  if (!existing.includes(name) && existing.length >= MAX_MUSIC_FILES)
    return fail(413, `Bibliothèque pleine (${MAX_MUSIC_FILES} musiques). Supprimes-en une.`);

  const data = Buffer.from(await req.arrayBuffer());
  if (data.length === 0 || data.length > MAX_MUSIC_BYTES) return fail(413, "Musique trop lourde (30 Mo au maximum).");

  // shortcut: les musiques ne comptent pas dans le quota de stockage (au plus 20 x 30 Mo par compte).
  await mkdir(abs(`${user.id}/music`), { recursive: true });
  await writeFile(abs(`${user.id}/music/${name}`), data);
  return Response.json({ music: await listMusic(user.id), added: name });
}
