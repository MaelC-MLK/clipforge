import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { publicToken } from "@/lib/oauth";
import { serveFile } from "@/lib/serve";
import { abs } from "@/lib/storage";

// Instagram ne reçoit pas le fichier : il le télécharge lui-même. Cette route lui sert le clip, sans session,
// contre un jeton signé, et seulement pendant que la publication est en cours.
export async function GET(req: Request, { params }: { params: Promise<{ publication: string; token: string }> }) {
  const { publication, token } = await params;
  const expected = Buffer.from(publicToken(publication));
  const given = Buffer.from(token);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return new Response(null, { status: 404 });

  const row = await db.publication.findFirst({ where: { id: publication, status: "publishing" }, include: { clip: true } });
  if (!row?.clip.outputPath) return new Response(null, { status: 404 });
  return serveFile(req, abs(row.clip.outputPath), "video/mp4");
}
