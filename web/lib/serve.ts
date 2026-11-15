import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

/** Sert un fichier avec Range (pour que <video> puisse se déplacer). `download` force le téléchargement sous ce nom. */
export async function serveFile(req: Request, file: string, contentType: string, download?: string) {
  const info = await stat(file).catch(() => null);
  if (!info) return new Response(null, { status: 404 });
  const size = info.size;
  const range = /bytes=(\d+)-(\d*)/.exec(req.headers.get("range") ?? "");
  const start = range ? Number(range[1]) : 0;
  const end = range?.[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });

  return new Response(Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream, {
    status: range ? 206 : 200,
    headers: {
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
      "Content-Length": String(end - start + 1),
      ...(range && { "Content-Range": `bytes ${start}-${end}/${size}` }),
      ...(download && { "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(download)}` }),
    },
  });
}
