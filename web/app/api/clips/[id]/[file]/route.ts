import { access, writeFile } from "node:fs/promises";
import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { serveFile } from "@/lib/serve";
import { abs } from "@/lib/storage";

// /api/clips/{id}/video, /srt et /thumb ; ajouter ?dl=1 pour télécharger.
export async function GET(req: Request, { params }: { params: Promise<{ id: string; file: string }> }) {
  const user = await getUser();
  if (!user) return new Response(null, { status: 401 });
  const { id, file } = await params;
  const clip = await db.clip.findFirst({ where: { id, userId: user.id } });
  if (clip?.outputPath && file === "thumb") {
    // cover.jpg : miniature choisie par l'utilisateur, prioritaire sur celle du rendu.
    const cover = abs(`${user.id}/clips/${clip.id}/cover.jpg`);
    const thumb = (await access(cover).then(() => true, () => false)) ? cover : abs(`${user.id}/clips/${clip.id}/thumb.jpg`);
    return serveFile(req, thumb, "image/jpeg", new URL(req.url).searchParams.has("dl") ? "miniature.jpg" : undefined).catch(
      () => new Response(null, { status: 404 }),
    );
  }
  const path = file === "video" ? clip?.outputPath : file === "srt" ? clip?.srtPath : null;
  if (!clip || !path) return new Response(null, { status: 404 });

  const name = clip.title.replace(/[\\/:*?"<>|]/g, "_");
  const download = new URL(req.url).searchParams.has("dl");
  return file === "video"
    ? serveFile(req, abs(path), "video/mp4", download ? `${name}.mp4` : undefined)
    : serveFile(req, abs(path), "application/x-subrip; charset=utf-8", `${name}.srt`);
}

const MAX_COVER_BYTES = 2 * 1024 * 1024; // limite de YouTube pour une miniature

// POST /api/clips/{id}/thumb : remplace la miniature par un JPEG (le navigateur convertit avant l'envoi).
export async function POST(req: Request, { params }: { params: Promise<{ id: string; file: string }> }) {
  const user = await getUser();
  if (!user) return Response.json({ error: "Non connecté." }, { status: 401 });
  const { id, file } = await params;
  const clip = file === "thumb" ? await db.clip.findFirst({ where: { id, userId: user.id, status: "rendered" } }) : null;
  if (!clip) return Response.json({ error: "Clip introuvable." }, { status: 404 });
  if (Number(req.headers.get("content-length")) > MAX_COVER_BYTES) return Response.json({ error: "Image trop lourde (2 Mo au maximum)." }, { status: 413 });
  const data = Buffer.from(await req.arrayBuffer());
  if (data.length > MAX_COVER_BYTES) return Response.json({ error: "Image trop lourde (2 Mo au maximum)." }, { status: 413 });
  // Signature JPEG : le fichier est servi tel quel en image/jpeg, puis envoyé à YouTube.
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8 || data[2] !== 0xff) return Response.json({ error: "Image illisible." }, { status: 415 });
  await writeFile(abs(`${user.id}/clips/${clip.id}/cover.jpg`), data);
  return Response.json({ ok: true });
}
