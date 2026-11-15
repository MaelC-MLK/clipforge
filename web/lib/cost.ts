import { db } from "./db";

// Dollars par million de tokens (entrée, sortie). Mêmes valeurs et même formule que worker/detect.py.
const PRICES: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
};
const SLICE_MINUTES = 25;

export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const [priceIn, priceOut] = PRICES[model] ?? PRICES["claude-opus-5-5"];
  return (inputTokens * priceIn + outputTokens * priceOut) / 1e6;
}

/** Coût approximatif de l'analyse Claude d'une source de `duration` secondes, affiché avant de la lancer. */
export function estimateAnalysisUsd(duration: number, model = CLAUDE_MODEL): number {
  const [priceIn, priceOut] = PRICES[model] ?? PRICES["claude-opus-5-5"];
  const parts = Math.max(1, Math.ceil(duration / (SLICE_MINUTES * 60)));
  return (Math.round((duration / 60) * 260 + parts * 500) * priceIn + parts * 3000 * priceOut) / 1e6;
}

/** Dépense Claude du mois en cours (UTC), d'après la table Usage. */
export async function monthSpentUsd(userId: string): Promise<number> {
  const now = new Date();
  const month = await db.usage.aggregate({
    where: { userId, createdAt: { gte: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) } },
    _sum: { costUsd: true },
  });
  return month._sum.costUsd ?? 0;
}
