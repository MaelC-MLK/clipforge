import { getUser } from "@/lib/auth";
import { listSources, sourceState } from "@/lib/storage";

// SSE : renvoie la bibliothèque de l'utilisateur (ou l'état d'une source avec ?source=ID : clips, analyse, moments)
// à chaque changement. La base est relue toutes les secondes.
export async function GET(req: Request) {
  const user = await getUser();
  if (!user) return new Response(null, { status: 401 });

  const sourceId = new URL(req.url).searchParams.get("source");
  const load = () => (sourceId ? sourceState(user.id, sourceId) : listSources(user.id));

  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval>;
  const stream = new ReadableStream({
    async start(controller) {
      let last = "";
      const tick = async () => {
        try {
          const data = JSON.stringify(await load());
          if (data === last) return;
          last = data;
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          clearInterval(timer); // flux fermé ou base injoignable : le navigateur se reconnecte seul
        }
      };
      await tick();
      timer = setInterval(tick, 1000);
      req.signal.addEventListener("abort", () => {
        clearInterval(timer);
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      clearInterval(timer);
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
