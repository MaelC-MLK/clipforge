import { createHash, createHmac, randomBytes } from "node:crypto";
import type { Provider } from "./publish";

/** Adresse publique du site, sans barre finale. Sert aux retours OAuth et à l'URL de vidéo donnée à Instagram. */
export const APP_URL = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

/** URL d'une API de réseau. PLATFORM_BASE_URL (tests seulement) redirige tous les appels vers un faux serveur. */
export const api = (host: string, path: string) =>
  (process.env.PLATFORM_BASE_URL ? `${process.env.PLATFORM_BASE_URL}/${host}` : `https://${host}`) + path;

const CONFIG = {
  youtube: {
    id: process.env.GOOGLE_CLIENT_ID,
    secret: process.env.GOOGLE_CLIENT_SECRET,
    idParam: "client_id",
    authorize: ["accounts.google.com", "/o/oauth2/v2/auth"],
    token: ["oauth2.googleapis.com", "/token"],
    scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
    // access_type=offline + prompt=consent : Google ne donne un jeton de renouvellement qu'à ces conditions.
    extra: { access_type: "offline", prompt: "consent" },
  },
  tiktok: {
    id: process.env.TIKTOK_CLIENT_KEY,
    secret: process.env.TIKTOK_CLIENT_SECRET,
    idParam: "client_key",
    authorize: ["www.tiktok.com", "/v2/auth/authorize/"],
    token: ["open.tiktokapis.com", "/v2/oauth/token/"],
    scope: "user.info.basic,video.publish,video.upload",
    extra: {},
  },
  instagram: {
    id: process.env.INSTAGRAM_APP_ID,
    secret: process.env.INSTAGRAM_APP_SECRET,
    idParam: "client_id",
    authorize: ["www.instagram.com", "/oauth/authorize"],
    token: ["api.instagram.com", "/oauth/access_token"],
    scope: "instagram_business_basic,instagram_business_content_publish",
    extra: {},
  },
  x: {
    id: process.env.X_CLIENT_ID,
    secret: process.env.X_CLIENT_SECRET,
    idParam: "client_id",
    authorize: ["x.com", "/i/oauth2/authorize"],
    token: ["api.x.com", "/2/oauth2/token"],
    // offline.access : jeton de renouvellement ; media.write : envoi de la vidéo.
    scope: "tweet.read tweet.write users.read media.write offline.access",
    extra: { code_challenge_method: "S256" },
  },
} as const;

/** PKCE, obligatoire chez X : un secret gardé dans un cookie, et son empreinte envoyée à l'autorisation. */
export const pkceVerifier = () => randomBytes(32).toString("base64url");
const pkceChallenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

export const isConfigured = (p: Provider) => Boolean(CONFIG[p].id && CONFIG[p].secret);
export const redirectUri = (p: Provider) => `${APP_URL}/api/oauth/${p}/callback`;

export function authorizeUrl(p: Provider, state: string, verifier = ""): string {
  const c = CONFIG[p];
  const params = new URLSearchParams({
    [c.idParam]: c.id ?? "",
    redirect_uri: redirectUri(p),
    response_type: "code",
    scope: c.scope,
    state,
    ...c.extra,
    ...(p === "x" ? { code_challenge: pkceChallenge(verifier) } : {}),
  });
  return `${api(c.authorize[0], c.authorize[1])}?${params}`;
}

async function json(res: Response): Promise<Record<string, unknown>> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  // TikTok joint toujours un objet `error` ; il vaut { code: "ok" } quand tout va bien.
  const failed = body.error && (body.error as { code?: string }).code !== "ok";
  if (!res.ok || failed) throw new Error(`Réponse ${res.status} du réseau : ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

export type Connected = { externalId: string; name: string; accessToken: string; refreshToken: string | null; expiresAt: Date | null };

const inSeconds = (s: unknown) => (Number(s) > 0 ? new Date(Date.now() + Number(s) * 1000) : null);

/** Échange le code d'autorisation contre des jetons, puis lit l'identité du compte. */
export async function connect(p: Provider, code: string, verifier = ""): Promise<Connected> {
  const c = CONFIG[p];
  const token = await json(
    await fetch(api(c.token[0], c.token[1]), {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        // X : client confidentiel, identifiants en Basic plutôt que dans le corps.
        ...(p === "x" ? { Authorization: `Basic ${Buffer.from(`${c.id}:${c.secret}`).toString("base64")}` } : {}),
      },
      body: new URLSearchParams({
        [c.idParam]: c.id ?? "",
        ...(p === "x" ? { code_verifier: verifier } : { client_secret: c.secret ?? "" }),
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri(p),
      }),
    }),
  );

  if (p === "x") {
    const access = String(token.access_token);
    const me = await json(await fetch(api("api.x.com", "/2/users/me"), { headers: { Authorization: `Bearer ${access}` } }));
    const data = me.data as { id: string; username: string };
    return {
      externalId: data.id,
      name: `@${data.username}`,
      accessToken: access,
      refreshToken: token.refresh_token ? String(token.refresh_token) : null,
      expiresAt: inSeconds(token.expires_in),
    };
  }

  if (p === "youtube") {
    const access = String(token.access_token);
    const channels = await json(
      await fetch(api("www.googleapis.com", "/youtube/v3/channels?part=snippet&mine=true"), { headers: { Authorization: `Bearer ${access}` } }),
    );
    const channel = (channels.items as { id: string; snippet: { title: string } }[] | undefined)?.[0];
    if (!channel) throw new Error("Ce compte Google n'a pas de chaîne YouTube.");
    return {
      externalId: channel.id,
      name: channel.snippet.title,
      accessToken: access,
      refreshToken: token.refresh_token ? String(token.refresh_token) : null,
      expiresAt: inSeconds(token.expires_in),
    };
  }

  if (p === "tiktok") {
    const access = String(token.access_token);
    // creator_info donne le nom du compte et ne demande que le droit video.publish, déjà nécessaire pour publier.
    const info = await json(
      await fetch(api("open.tiktokapis.com", "/v2/post/publish/creator_info/query/"), {
        method: "POST",
        headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json; charset=UTF-8" },
      }),
    ).catch(() => ({}) as Record<string, unknown>);
    const data = (info.data ?? {}) as { creator_nickname?: string; creator_username?: string };
    return {
      externalId: String(token.open_id),
      name: data.creator_nickname || data.creator_username || "Compte TikTok",
      accessToken: access,
      refreshToken: token.refresh_token ? String(token.refresh_token) : null,
      expiresAt: inSeconds(token.expires_in),
    };
  }

  // Instagram : le premier jeton vit une heure, on l'échange tout de suite contre un jeton de 60 jours.
  const short = ((token.data as Record<string, unknown>[] | undefined)?.[0] ?? token) as { access_token: string; user_id: string | number };
  const long = await json(
    await fetch(
      api("graph.instagram.com", `/access_token?${new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: c.secret ?? "", access_token: short.access_token })}`),
    ),
  );
  const access = String(long.access_token);
  const me = await json(
    await fetch(api("graph.instagram.com", "/v27.0/me?fields=user_id,username"), { headers: { Authorization: `Bearer ${access}` } }),
  ).catch(() => ({}) as Record<string, unknown>);
  return {
    externalId: String(me.user_id ?? short.user_id),
    name: me.username ? `@${me.username}` : "Compte Instagram",
    accessToken: access,
    refreshToken: null, // Instagram renouvelle le jeton d'accès lui-même, sans jeton séparé
    expiresAt: inSeconds(long.expires_in),
  };
}

/** Jeton qui autorise Instagram à télécharger un clip pendant sa publication (même calcul dans worker/publish.py). */
export const publicToken = (publicationId: string) =>
  createHmac("sha256", process.env.SERVER_SALT ?? "").update(`publication:${publicationId}`).digest("hex");
