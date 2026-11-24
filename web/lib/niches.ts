// Niches : catégories Twitch ou Kick dont le worker relève les clips les plus vus (voir recommend dans worker/worker.py).

export const NICHE_PLATFORMS = { twitch: "Twitch", kick: "Kick" } as const;
export type NichePlatform = keyof typeof NICHE_PLATFORMS;
export const isNichePlatform = (p: unknown): p is NichePlatform => typeof p === "string" && p in NICHE_PLATFORMS;
export const NICHE_DOTS: Record<NichePlatform, string> = { twitch: "bg-purple-500", kick: "bg-lime-400" };

export const EVERY_HOURS = [6, 12, 24];
export const PERIODS = { day: "24 dernières heures", week: "7 derniers jours" } as const;
export const LANGUAGES = { "": "Toutes les langues", fr: "Français", en: "Anglais", es: "Espagnol", de: "Allemand", pt: "Portugais" } as const;
export const MAX_NICHES = 10;

export type Category = { id: string; name: string };

export const twitchConfigured = () => Boolean(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET);

let twitchToken = { value: "", expires: 0 };

async function helix(path: string, params: Record<string, string>) {
  const clientId = process.env.TWITCH_CLIENT_ID!;
  if (Date.now() > twitchToken.expires) {
    const res = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      body: new URLSearchParams({ client_id: clientId, client_secret: process.env.TWITCH_CLIENT_SECRET!, grant_type: "client_credentials" }),
    });
    if (!res.ok) throw new Error(`Twitch ${res.status}`);
    const token = await res.json();
    twitchToken = { value: token.access_token, expires: Date.now() + (token.expires_in - 300) * 1000 };
  }
  const res = await fetch(`https://api.twitch.tv/helix/${path}?${new URLSearchParams(params)}`, {
    headers: { "Client-Id": clientId, Authorization: `Bearer ${twitchToken.value}` },
  });
  if (!res.ok) throw new Error(`Twitch ${res.status}`);
  return (await res.json()).data as Record<string, string>[];
}

/** Catégories correspondant à `query` : nom exact d'abord, puis ceux qui commencent ou contiennent la recherche. */
export async function searchCategories(platform: NichePlatform, query: string): Promise<Category[]> {
  const q = query.toLowerCase();
  const rank = (c: Category) => {
    const name = c.name.toLowerCase();
    return name === q || c.id === q ? 0 : name.startsWith(q) ? 1 : name.includes(q) ? 2 : 3;
  };
  return (await platformSearch(platform, query)).sort((a, b) => rank(a) - rank(b));
}

async function platformSearch(platform: NichePlatform, query: string): Promise<Category[]> {
  if (platform === "twitch") {
    const rows = await helix("search/categories", { query, first: "10" });
    return rows.map((r) => ({ id: r.id, name: r.name }));
  }
  // shortcut: recherche non documentée du site Kick, comme le relevé des clips côté worker.
  const res = await fetch(`https://kick.com/api/search?${new URLSearchParams({ searched_word: query })}`, {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Kick ${res.status}`);
  const data = (await res.json()) as { categories?: { slug: string; name: string }[] };
  return (data.categories ?? []).slice(0, 10).map((c) => ({ id: c.slug, name: c.name }));
}
