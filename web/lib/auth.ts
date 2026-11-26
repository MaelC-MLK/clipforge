import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "./db";

const COOKIE = "session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 jours

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Inscriptions fermées par défaut ; SIGNUPS_OPEN=1 les ouvre. Les comptes existants se connectent toujours. */
export const signupsOpen = () => process.env.SIGNUPS_OPEN === "1";

/** Propriétaire de l'instance (SUBSCRIPTION_EMAIL) : seul à régler ce qui vaut pour tout le serveur. */
export const isOwner = (user: { email: string }) => {
  const owner = (process.env.SUBSCRIPTION_EMAIL ?? "").trim().toLowerCase();
  return owner !== "" && user.email === owner;
};

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  await db.session.create({
    data: { tokenHash: sha256(token), userId, expiresAt: new Date(Date.now() + MAX_AGE * 1000) },
  });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: sha256(token) } });
  jar.delete(COOKIE);
}

export async function getUser() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!session || session.expiresAt < new Date()) return null;
  return session.user;
}

export async function requireUser() {
  return (await getUser()) ?? redirect("/login");
}
