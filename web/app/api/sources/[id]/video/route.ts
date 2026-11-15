import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { serveFile } from "@/lib/serve";
import { abs } from "@/lib/storage";

// Sert l'aperçu 480p d'une source à son propriétaire.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return new Response(null, { status: 401 });
  const { id } = await params;
  const source = await db.source.findFirst({ where: { id, userId: user.id } });
  if (!source?.proxyPath) return new Response(null, { status: 404 });
  return serveFile(req, abs(source.proxyPath), "video/mp4");
}
