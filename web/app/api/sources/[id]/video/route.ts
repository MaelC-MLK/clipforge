import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { abs } from "@/lib/storage";

// Sert l'aperçu 480p d'une source à son propriétaire, avec Range pour que <video> puisse se déplacer.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return new Response(null, { status: 401 });
  const { id } = await params;
  const source = await db.source.findFirst({ where: { id, userId: user.id } });
  if (!source?.proxyPath) return new Response(null, { status: 404 });

  const file = abs(source.proxyPath);
  const { size } = await stat(file);
  const range = /bytes=(\d+)-(\d*)/.exec(req.headers.get("range") ?? "");
  const start = range ? Number(range[1]) : 0;
  const end = range?.[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });

  return new Response(Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream, {
    status: range ? 206 : 200,
    headers: {
      "Content-Type": "video/mp4",
      "Accept-Ranges": "bytes",
      "Content-Length": String(end - start + 1),
      ...(range && { "Content-Range": `bytes ${start}-${end}/${size}` }),
    },
  });
}
