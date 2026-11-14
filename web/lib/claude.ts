import Anthropic from "@anthropic-ai/sdk";

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
