"use server";

import { rm } from "node:fs/promises";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSession, destroySession, requireUser } from "@/lib/auth";
import { checkKey } from "@/lib/claude";
import { encrypt, hashKey } from "@/lib/crypto";
import { db } from "@/lib/db";
import { abs, quotaBytes, usedBytes } from "@/lib/storage";

export type FormState = { error?: string; ok?: string };

// shortcut: compteur en mémoire, remis à zéro au redémarrage et non partagé entre instances.
// À remplacer par une table Postgres si le web tourne sur plusieurs serveurs.
const attempts = new Map<string, { count: number; reset: number }>();
async function tooManyAttempts(): Promise<boolean> {
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
  const now = Date.now();
  const a = attempts.get(ip);
  if (!a || a.reset < now) {
    attempts.set(ip, { count: 1, reset: now + 60_000 });
    return false;
  }
  return ++a.count > 5;
}

async function validateKey(key: string): Promise<string | null> {
  if (!key.startsWith("sk-ant-")) return "Cette clé ne ressemble pas à une clé API Claude (sk-ant-…).";
  const result = await checkKey(key);
  if (result === "invalid") return "Clé refusée par Anthropic. Vérifie qu'elle est active.";
  if (result === "error") return "Impossible de joindre Anthropic pour vérifier la clé. Réessaie dans un instant.";
  return null;
}

export async function login(_: FormState, form: FormData): Promise<FormState> {
  if (await tooManyAttempts()) return { error: "Trop de tentatives. Réessaie dans une minute." };
  const key = String(form.get("key") ?? "").trim();
  const error = await validateKey(key);
  if (error) return { error };

  const keyHash = hashKey(key);
  const user = await db.user.upsert({
    where: { keyHash },
    update: {},
    create: { keyHash, keyEncrypted: encrypt(key) },
  });
  await createSession(user.id);
  redirect("/app");
}

export async function logout() {
  await destroySession();
  redirect("/");
}

export async function changeKey(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  if (await tooManyAttempts()) return { error: "Trop de tentatives. Réessaie dans une minute." };
  const oldKey = String(form.get("oldKey") ?? "").trim();
  const newKey = String(form.get("newKey") ?? "").trim();
  if (hashKey(oldKey) !== user.keyHash) return { error: "L'ancienne clé ne correspond pas à ce compte." };
  const error = await validateKey(newKey);
  if (error) return { error };

  const keyHash = hashKey(newKey);
  if (await db.user.findFirst({ where: { keyHash, NOT: { id: user.id } } }))
    return { error: "Cette clé est déjà liée à un autre compte." };
  // Les données sont liées à user.id : changer de clé ne touche que ces deux colonnes.
  await db.user.update({ where: { id: user.id }, data: { keyHash, keyEncrypted: encrypt(newKey) } });
  return { ok: "Clé remplacée." };
}

export async function saveAccount(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const email = String(form.get("email") ?? "").trim();
  const budget = Number(form.get("budget"));
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Adresse email invalide." };
  if (!Number.isFinite(budget) || budget < 0 || budget > 10_000) return { error: "Budget invalide." };
  await db.user.update({
    where: { id: user.id },
    data: { recoveryEmail: email || null, monthlyBudgetUsd: budget },
  });
  return { ok: "Enregistré." };
}

function kindOf(host: string): string {
  if (/(^|\.)(youtube\.com|youtu\.be)$/.test(host)) return "youtube";
  if (/(^|\.)twitch\.tv$/.test(host)) return "twitch";
  if (/(^|\.)kick\.com$/.test(host)) return "kick";
  return "other";
}

export async function importUrl(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  let url: URL;
  try {
    url = new URL(String(form.get("url") ?? "").trim());
  } catch {
    return { error: "URL invalide." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { error: "URL invalide." };
  if ((await usedBytes(user.id)) >= quotaBytes(user))
    return { error: "Quota de stockage atteint. Supprime des sources pour continuer." };

  const source = await db.source.create({
    data: { userId: user.id, kind: kindOf(url.hostname), url: url.href, title: url.href, status: "downloading" },
  });
  await db.job.create({
    data: { userId: user.id, sourceId: source.id, type: "ingest", payload: { sourceId: source.id } },
  });
  return { ok: "Import lancé." };
}

export async function deleteSource(id: string) {
  const user = await requireUser();
  const { count } = await db.source.deleteMany({ where: { id, userId: user.id } });
  if (count) await rm(abs(`${user.id}/sources/${id}`), { recursive: true, force: true });
}
