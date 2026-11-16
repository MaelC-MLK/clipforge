import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_MODEL } from "./cost";
import type { ClipMeta, PlatformText } from "./publish";

/** Teste une clé avec l'appel le moins cher possible : lister un modèle (gratuit, aucun token). */
export async function checkKey(apiKey: string): Promise<"ok" | "invalid" | "error"> {
  try {
    await new Anthropic({ apiKey, maxRetries: 1 }).models.list({ limit: 1 });
    return "ok";
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return "invalid";
    return "error";
  }
}

/** Mode abonnement : seulement le compte du propriétaire de l'instance (SUBSCRIPTION_EMAIL), jamais ceux des autres utilisateurs. */
export function usesSubscription(user: { email: string }): boolean {
  const owner = (process.env.SUBSCRIPTION_EMAIL ?? "").trim().toLowerCase();
  return Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN) && owner !== "" && user.email === owner;
}

type CliAnswer = { data?: unknown; error?: string; inputTokens: number; outputTokens: number };

/** Un appel à Claude par Claude Code (`claude -p`), payé par l'abonnement du jeton CLAUDE_CODE_OAUTH_TOKEN. */
function claudeCli(system: string, prompt: string, schema: object): Promise<CliAnswer> {
  return new Promise((resolve) => {
    // Une clé API dans l'environnement passerait avant le jeton d'abonnement.
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
    const child = spawn(
      "claude",
      ["-p", "--output-format", "json", "--json-schema", JSON.stringify(schema), "--model", CLAUDE_MODEL, "--system-prompt", system, "--tools", "", "--no-session-persistence"],
      { env, cwd: tmpdir(), timeout: 300_000 },
    );
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.on("error", () => resolve({ error: "Claude Code n'est pas installé sur le serveur : le mode abonnement ne peut pas tourner.", inputTokens: 0, outputTokens: 0 }));
    child.on("close", () => {
      try {
        const answer = JSON.parse(out);
        const u = answer.usage ?? {};
        const tokens = { inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0), outputTokens: u.output_tokens ?? 0 };
        if (answer.is_error) resolve({ error: `Claude Code (abonnement) a refusé : ${String(answer.result ?? "erreur sans message").slice(0, 300)}`, ...tokens });
        else resolve({ data: answer.structured_output, ...tokens });
      } catch {
        resolve({ error: "Claude Code n'a pas répondu. Réessaie dans un instant.", inputTokens: 0, outputTokens: 0 });
      }
    });
    child.stdin.on("error", () => {}); // processus déjà mort : l'erreur arrive par "error" ou "close"
    child.stdin.end(prompt);
  });
}

type RawMeta = { tiktok: PlatformText; reels: PlatformText; shorts: PlatformText; viral_score: number; viral_reason: string };

function tidyMeta(raw: RawMeta, language: string): ClipMeta {
  const tidy = (t: PlatformText): PlatformText => ({
    title: String(t.title).slice(0, 150),
    description: String(t.description).slice(0, 2000),
    hashtags: (Array.isArray(t.hashtags) ? t.hashtags : []).slice(0, 10).map((h) => String(h).replace(/^#+/, "").slice(0, 50)),
  });
  return {
    language,
    tiktok: tidy(raw.tiktok),
    reels: tidy(raw.reels),
    shorts: tidy(raw.shorts),
    viralScore: Math.min(100, Math.max(0, Math.round(Number(raw.viral_score) || 0))),
    viralReason: String(raw.viral_reason).slice(0, 500),
  };
}

const META_PROMPT = `Tu écris les textes de publication d'un clip vidéo court, pour trois plateformes : TikTok, Instagram Reels et YouTube Shorts.

Tu reçois le titre de travail du clip, sa durée et ce qui y est dit. Écris dans la langue demandée, quelle que soit la langue du clip.

Pour chaque plateforme :
- title : une accroche courte qui donne envie de regarder, sans majuscules abusives ni promesse que le clip ne tient pas. 100 caractères au plus pour Shorts.
- description : une ou deux phrases dans le ton de la plateforme. TikTok : direct et familier. Reels : un peu plus soigné. Shorts : descriptif, avec les mots qu'on taperait pour chercher cette vidéo.
- hashtags : 3 à 6 mots-clés sans le signe #, du plus précis au plus général. Pas de hashtags génériques sans rapport avec le contenu.

Puis évalue le potentiel du clip :
- viral_score : de 0 à 100. C'est une estimation indicative, pas une prédiction : sois honnête et plutôt sévère.
- viral_reason : deux phrases au plus, qui disent ce qui joue pour le clip et ce qui joue contre.`;

const platform = {
  type: "object",
  properties: { title: { type: "string" }, description: { type: "string" }, hashtags: { type: "array", items: { type: "string" } } },
  required: ["title", "description", "hashtags"],
  additionalProperties: false,
} as const;

const META_SCHEMA = {
  type: "object",
  properties: { tiktok: platform, reels: platform, shorts: platform, viral_score: { type: "integer" }, viral_reason: { type: "string" } },
  required: ["tiktok", "reels", "shorts", "viral_score", "viral_reason"],
  additionalProperties: false,
};

export type MetaResult =
  | { meta: ClipMeta; model: string; inputTokens: number; outputTokens: number }
  | { error: string; model?: string; inputTokens?: number; outputTokens?: number };

/** Demande à Claude les titres, descriptions, hashtags et le score d'un clip, avec la clé de l'utilisateur ou, sans clé (null), l'abonnement du propriétaire. */
export async function generateClipMeta(apiKey: string | null, clip: { title: string; seconds: number; transcript: string }, language: string): Promise<MetaResult> {
  const prompt = `Langue demandée : ${language}\nTitre de travail : ${clip.title}\nDurée : ${Math.round(clip.seconds)} secondes\n\nCe qui est dit dans le clip :\n${clip.transcript || "(aucune parole détectée)"}`;
  if (apiKey === null) {
    const answer = await claudeCli(META_PROMPT, prompt, META_SCHEMA);
    const usage = { model: CLAUDE_MODEL, inputTokens: answer.inputTokens, outputTokens: answer.outputTokens };
    if (answer.error) return { error: answer.error, ...usage };
    try {
      return { meta: tidyMeta(answer.data as RawMeta, language), ...usage };
    } catch {
      return { error: "Claude n'a pas pu écrire les textes de ce clip.", ...usage };
    }
  }
  let response;
  try {
    response = await new Anthropic({ apiKey }).beta.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default", // si le modèle décline, l'API bascule seule sur un autre
      system: META_PROMPT,
      messages: [{ role: "user", content: prompt }],
      output_config: { effort: "medium", format: { type: "json_schema", schema: META_SCHEMA } },
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { error: "Clé Claude refusée par Anthropic. Remplace-la dans Compte." };
    if (e instanceof Anthropic.RateLimitError) return { error: "Anthropic limite le débit de ta clé. Réessaie dans une minute." };
    if (e instanceof Anthropic.APIError) return { error: `Anthropic a refusé la requête : ${e.message}`.slice(0, 300) };
    return { error: "Impossible de joindre Anthropic. Réessaie dans un instant." };
  }

  const usage = {
    model: response.model,
    inputTokens: response.usage.input_tokens + (response.usage.cache_creation_input_tokens ?? 0) + (response.usage.cache_read_input_tokens ?? 0),
    outputTokens: response.usage.output_tokens,
  };
  const text = response.content.find((b) => b.type === "text");
  if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens" || !text || text.type !== "text")
    return { error: "Claude n'a pas pu écrire les textes de ce clip.", ...usage };
  try {
    return { meta: tidyMeta(JSON.parse(text.text) as RawMeta, language), ...usage };
  } catch {
    return { error: "Réponse de Claude illisible. Réessaie.", ...usage };
  }
}
