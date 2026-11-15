"use server";

import { rm } from "node:fs/promises";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSession, destroySession, requireUser } from "@/lib/auth";
import { checkKey } from "@/lib/claude";
import { encrypt, hashKey } from "@/lib/crypto";
import { db } from "@/lib/db";
import { abs, listMusic, quotaBytes, usedBytes } from "@/lib/storage";
import { type Edit, sanitizeEdit, sanitizeWords, type Word } from "@/lib/edit";
import { MAX_CLIP_SECONDS } from "@/lib/upload";

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
  const clips = await db.clip.findMany({ where: { sourceId: id, userId: user.id }, select: { id: true } });
  const { count } = await db.source.deleteMany({ where: { id, userId: user.id } }); // supprime aussi ses clips en base
  if (!count) return;
  await rm(abs(`${user.id}/sources/${id}`), { recursive: true, force: true });
  for (const clip of clips) await rm(abs(`${user.id}/clips/${clip.id}`), { recursive: true, force: true });
}

/** Réglages nettoyés, ou un message d'erreur si une musique ou une vidéo secondaire n'est pas à l'utilisateur. */
async function checkedEdit(userId: string, input: unknown): Promise<Edit | string> {
  const edit = sanitizeEdit(input);
  if (edit.music && !(await listMusic(userId)).includes(edit.music)) return "Musique introuvable.";
  if (edit.stackSourceId && !(await db.source.findFirst({ where: { id: edit.stackSourceId, userId, status: "ready" } })))
    return "Vidéo secondaire introuvable.";
  return edit;
}

export async function createClip(input: { sourceId: string; title: string; start: number; end: number; edit: unknown }): Promise<FormState> {
  const user = await requireUser();
  const source = await db.source.findFirst({ where: { id: String(input.sourceId), userId: user.id, status: "ready" } });
  if (!source) return { error: "Source introuvable ou pas encore prête." };

  const start = Number(input.start);
  const end = Number(input.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > (source.duration ?? 0) + 0.5)
    return { error: "Le début et la fin doivent être dans la vidéo." };
  if (end - start < 1) return { error: "Un clip dure au moins 1 seconde." };
  if (end - start > MAX_CLIP_SECONDS) return { error: `Un clip dure au maximum ${MAX_CLIP_SECONDS} secondes.` };
  const edit = await checkedEdit(user.id, { ...Object(input.edit), customWords: false });
  if (typeof edit === "string") return { error: edit };
  if ((await usedBytes(user.id)) >= quotaBytes(user))
    return { error: "Quota de stockage atteint. Supprime des sources ou des clips pour continuer." };

  const clip = await db.clip.create({
    data: {
      userId: user.id,
      sourceId: source.id,
      title: String(input.title).trim().slice(0, 150) || source.title.slice(0, 150),
      start,
      end,
      edit,
    },
  });
  await db.job.create({ data: { userId: user.id, clipId: clip.id, type: "render", payload: { clipId: clip.id } } });
  return { ok: "Rendu lancé." };
}

/** Relance le rendu de clips existants, avec de nouveaux réglages et/ou des sous-titres corrigés. */
export async function rerenderClips(input: { ids: string[]; edit?: unknown; words?: unknown }): Promise<FormState> {
  const user = await requireUser();
  const ids = (Array.isArray(input.ids) ? input.ids : []).slice(0, 100).map(String);
  const edit = input.edit === undefined ? undefined : await checkedEdit(user.id, input.edit);
  if (typeof edit === "string") return { error: edit };

  // Un clip en cours de rendu n'est pas relancé : deux rendus écriraient dans le même dossier.
  const clips = await db.clip.findMany({ where: { id: { in: ids }, userId: user.id, status: { not: "rendering" } } });
  for (const clip of clips) {
    const words = input.words === undefined ? undefined : sanitizeWords(input.words, clip.end - clip.start);
    if (words === null) return { error: "Sous-titres invalides." };
    const previous = sanitizeEdit(clip.edit);
    // Les mots déjà corrigés et le cadrage propre au clip survivent à l'application d'un template.
    const next: Edit = edit
      ? { ...edit, customWords: previous.customWords, keyframes: previous.keyframes, facecam: previous.facecam }
      : previous;
    if (words) next.customWords = true;
    await db.clip.update({
      where: { id: clip.id },
      data: { edit: next, status: "rendering", error: null, ...(words ? { words } : {}) },
    });
    await db.job.create({ data: { userId: user.id, clipId: clip.id, type: "render", payload: { clipId: clip.id } } });
  }
  return clips.length ? { ok: clips.length > 1 ? `${clips.length} rendus relancés.` : "Rendu relancé." } : { error: "Aucun clip à relancer." };
}

export async function getClipWords(id: string): Promise<Word[]> {
  const user = await requireUser();
  const clip = await db.clip.findFirst({ where: { id, userId: user.id }, select: { words: true, start: true, end: true } });
  return clip ? (sanitizeWords(clip.words, clip.end - clip.start) ?? []) : [];
}

export async function saveTemplate(name: string, edit: unknown): Promise<FormState> {
  const user = await requireUser();
  const clean = String(name).trim().slice(0, 60);
  if (!clean) return { error: "Donne un nom au template." };
  if ((await db.template.count({ where: { userId: user.id } })) >= 50) return { error: "50 templates au maximum." };
  // Un template ne transporte pas ce qui est propre à un clip.
  const data = { ...sanitizeEdit(edit), customWords: false, keyframes: [] };
  await db.template.create({ data: { userId: user.id, name: clean, edit: data } });
  return { ok: "Template enregistré." };
}

export async function deleteTemplate(id: string) {
  const user = await requireUser();
  await db.template.deleteMany({ where: { id, userId: user.id } });
}

export async function deleteClip(id: string) {
  const user = await requireUser();
  const { count } = await db.clip.deleteMany({ where: { id, userId: user.id } });
  if (count) await rm(abs(`${user.id}/clips/${id}`), { recursive: true, force: true });
}

export async function deleteMusic(name: string) {
  const user = await requireUser();
  // Seulement un nom présent dans sa bibliothèque : jamais de chemin fourni par le navigateur.
  if ((await listMusic(user.id)).includes(name)) await rm(abs(`${user.id}/music/${name}`), { force: true });
}
