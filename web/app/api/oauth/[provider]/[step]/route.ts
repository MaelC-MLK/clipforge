import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { getUser } from "@/lib/auth";
import { encrypt } from "@/lib/crypto";
import { db } from "@/lib/db";
import { APP_URL, authorizeUrl, connect, isConfigured } from "@/lib/oauth";
import { isProvider, PROVIDERS } from "@/lib/publish";

const back = (params: Record<string, string>) => Response.redirect(`${APP_URL}/app/reseaux?${new URLSearchParams(params)}`);

// /api/oauth/{réseau}/start : envoie l'utilisateur chez le réseau.
// /api/oauth/{réseau}/callback : le réseau le renvoie ici avec un code, échangé contre des jetons.
export async function GET(req: Request, { params }: { params: Promise<{ provider: string; step: string }> }) {
  const user = await getUser();
  if (!user) return Response.redirect(`${APP_URL}/login`);
  const { provider, step } = await params;
  if (!isProvider(provider) || !isConfigured(provider)) return back({ error: "Ce réseau n'est pas configuré sur le serveur." });
  const jar = await cookies();
  const cookie = `oauth_${provider}`;

  if (step === "start") {
    // Le `state` lie le retour à ce navigateur : sans lui, un tiers pourrait faire connecter son propre compte.
    const state = randomBytes(16).toString("hex");
    jar.set(cookie, state, { httpOnly: true, sameSite: "lax", secure: APP_URL.startsWith("https"), path: "/", maxAge: 600 });
    return Response.redirect(authorizeUrl(provider, state));
  }

  const query = new URL(req.url).searchParams;
  const expected = jar.get(cookie)?.value;
  jar.delete(cookie);
  if (!expected || query.get("state") !== expected) return back({ error: "Connexion expirée ou invalide. Recommence." });
  const code = query.get("code");
  if (!code) return back({ error: `Connexion refusée par ${PROVIDERS[provider]}.` });

  try {
    const account = await connect(provider, code);
    const tokens = {
      name: account.name,
      accessToken: encrypt(account.accessToken),
      refreshToken: account.refreshToken && encrypt(account.refreshToken),
      expiresAt: account.expiresAt,
    };
    await db.account.upsert({
      where: { userId_provider_externalId: { userId: user.id, provider, externalId: account.externalId } },
      update: tokens,
      create: { userId: user.id, provider, externalId: account.externalId, ...tokens },
    });
    return back({ ok: `${PROVIDERS[provider]} : ${account.name} connecté.` });
  } catch (e) {
    console.error(e);
    return back({ error: `Impossible de connecter ${PROVIDERS[provider]}. ${e instanceof Error ? e.message : ""}`.slice(0, 300) });
  }
}
