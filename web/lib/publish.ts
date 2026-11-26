// Publication sur les réseaux : types et libellés partagés entre le navigateur et le serveur.

export const PROVIDERS = { youtube: "YouTube Shorts", tiktok: "TikTok", instagram: "Instagram Reels", x: "X" } as const;
export type Provider = keyof typeof PROVIDERS;
export const isProvider = (v: string): v is Provider => Object.hasOwn(PROVIDERS, v);

export type PlatformText = { title: string; description: string; hashtags: string[] };

/** Métadonnées proposées par Claude pour un clip (colonne Clip.meta). */
export type ClipMeta = {
  language: string;
  tiktok: PlatformText;
  reels: PlatformText;
  shorts: PlatformText;
  viralScore: number; // 0 à 100, indicatif
  viralReason: string;
};

export const PROVIDER_DOTS: Record<Provider, string> = { youtube: "bg-red-500", tiktok: "bg-cyan-400", instagram: "bg-pink-500", x: "bg-zinc-100" };

export const STATUS_LABELS: Record<string, string> = {
  scheduled: "En attente",
  publishing: "Publication en cours",
  published: "Publié",
  draft_sent: "Brouillon envoyé sur TikTok",
  failed: "Échec",
};

// Plafonds par compte sur 24 heures, d'après les documentations officielles (novembre 2026).
// Le réseau reste juge : s'il refuse quand même, la publication passe en échec avec sa raison.
export const DAILY_LIMITS: Record<Provider, number> = {
  youtube: 100, // appels videos.insert par jour et par projet Google Cloud
  tiktok: 5, // brouillons en attente dans la boîte de réception TikTok
  instagram: 100, // publications par l'API
  x: 100, // POST /2/tweets par utilisateur ; l'offre gratuite de l'API plafonne aussi l'application entière par mois
};

/** Légende finale : texte suivi des hashtags. */
export const caption = (t: PlatformText) =>
  [t.description.trim(), t.hashtags.map((h) => `#${h.replace(/^#+/, "").replace(/\s+/g, "")}`).join(" ")].filter(Boolean).join("\n\n");
