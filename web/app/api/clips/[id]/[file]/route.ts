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
    const thumb = abs(`${user.id}/clips/${clip.id}/thumb.jpg`);
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
