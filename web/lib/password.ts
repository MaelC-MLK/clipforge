import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { MIN_PASSWORD } from "./upload.ts";

const derive = promisify(scrypt) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;

export { MIN_PASSWORD };
export const MAX_PASSWORD = 200; // borne le coût du hachage sur une entrée géante

/** Hache un mot de passe avec scrypt et un sel aléatoire. Format : scrypt:sel:hash (hexadécimal). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt:${salt.toString("hex")}:${(await derive(password, salt, 64)).toString("hex")}`;
}

/** Vrai si le mot de passe correspond. Un hash absent ou illisible donne faux, après le même temps de calcul. */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  const [scheme, salt, hash] = (stored ?? "").split(":");
  const expected = Buffer.from(hash ?? "", "hex");
  const valid = scheme === "scrypt" && expected.length === 64;
  // Compte inconnu : on calcule quand même, pour que le temps de réponse ne révèle pas quels emails existent.
  const actual = await derive(password, valid ? Buffer.from(salt, "hex") : Buffer.alloc(16), 64);
  return valid && timingSafeEqual(actual, expected);
}
