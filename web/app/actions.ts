"use server";

import { createHash, randomBytes } from "node:crypto";
import { rm } from "node:fs/promises";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSession, destroySession, requireUser, signupsOpen } from "@/lib/auth";
import { checkKey, generateClipMeta, usesSubscription } from "@/lib/claude";
import { costUsd, estimateAnalysisUsd, monthSpentUsd } from "@/lib/cost";
import { decrypt, encrypt } from "@/lib/crypto";
import { db } from "@/lib/db";
import { abs, listMusic, storageError } from "@/lib/storage";
import { mailConfigured, sendMail } from "@/lib/mail";
import { APP_URL } from "@/lib/oauth";
import { type Edit, MAX_PARTS, MIN_PART_SECONDS, sanitizeEdit, sanitizeWords, splitParts, type Word } from "@/lib/edit";
import { hashPassword, MAX_PASSWORD, MIN_PASSWORD, verifyPassword } from "@/lib/password";
import { type ClipMeta, DAILY_LIMITS, isProvider, PROVIDERS } from "@/lib/publish";
import { MAX_CLIP_SECONDS } from "@/lib/upload";
import { type Category, EVERY_HOURS, isNichePlatform, LANGUAGES, MAX_NICHES, NICHE_PLATFORMS, searchCategories, twitchConfigured } from "@/lib/niches";

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

const NO_KEY = "Ajoute d'abord ta clé API Claude dans Compte.";

export async function signup(_: FormState, form: FormData): Promise<FormState> {
  if (!signupsOpen()) return { error: "Les inscriptions sont fermées pour le moment." };
  if (await tooManyAttempts()) return { error: "Trop de tentatives. Réessaie dans une minute." };
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (email.length > 200 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Adresse email invalide." };
  if (password.length < MIN_PASSWORD) return { error: `Le mot de passe doit faire au moins ${MIN_PASSWORD} caractères.` };
  if (password.length > MAX_PASSWORD) return { error: "Mot de passe trop long." };
  if (password !== String(form.get("confirm") ?? "")) return { error: "Les deux mots de passe ne sont pas identiques." };
  if (await db.user.findUnique({ where: { email } })) return { error: "Un compte existe déjà avec cet email. Connecte-toi." };

  const user = await db.user.create({ data: { email, passwordHash: await hashPassword(password) } });
  await createSession(user.id);
  redirect("/app/compte?bienvenue=1");
}

export async function login(_: FormState, form: FormData): Promise<FormState> {
  if (await tooManyAttempts()) return { error: "Trop de tentatives. Réessaie dans une minute." };
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "").slice(0, MAX_PASSWORD);
  const user = await db.user.findUnique({ where: { email } });
  // Même message et même temps de calcul que le compte existe ou non.
  if (!(await verifyPassword(password, user?.passwordHash)) || !user) return { error: "Email ou mot de passe incorrect." };
  await createSession(user.id);
  redirect("/app");
}

export async function logout() {
  await destroySession();
  redirect("/");
}

/** Enregistre ou remplace la clé API Claude du compte, après vérification auprès d'Anthropic. */
export async function saveKey(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  if (await tooManyAttempts()) return { error: "Trop de tentatives. Réessaie dans une minute." };
  const key = String(form.get("key") ?? "").trim();
  const error = await validateKey(key);
  if (error) return { error };
  await db.user.update({ where: { id: user.id }, data: { keyEncrypted: encrypt(key) } });
  revalidatePath("/app", "layout");
  return { ok: "Clé enregistrée." };
}

export async function removeKey() {
  const user = await requireUser();
  await db.user.update({ where: { id: user.id }, data: { keyEncrypted: null } });
  revalidatePath("/app", "layout");
}

export async function changePassword(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  if (await tooManyAttempts()) return { error: "Trop de tentatives. Réessaie dans une minute." };
  const next = String(form.get("next") ?? "");
  if (!(await verifyPassword(String(form.get("current") ?? "").slice(0, MAX_PASSWORD), user.passwordHash))) return { error: "Mot de passe actuel incorrect." };
  if (next.length < MIN_PASSWORD) return { error: `Le nouveau mot de passe doit faire au moins ${MIN_PASSWORD} caractères.` };
  if (next.length > MAX_PASSWORD) return { error: "Mot de passe trop long." };
  await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next) } });
  // Les autres appareils sont déconnectés : un mot de passe changé parce qu'il a fuité ne doit plus rien ouvrir.
  await db.session.deleteMany({ where: { userId: user.id } });
  await createSession(user.id);
  return { ok: "Mot de passe changé. Tes autres appareils sont déconnectés." };
}

export async function saveAccount(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const budget = Number(form.get("budget"));
  if (!Number.isFinite(budget) || budget < 0 || budget > 10_000) return { error: "Budget invalide." };
  const purge = String(form.get("purge") ?? "").trim();
  const purgeDays = purge === "" ? null : Number(purge);
  if (purgeDays !== null && (!Number.isInteger(purgeDays) || purgeDays < 1 || purgeDays > 3650))
    return { error: "Délai de suppression invalide : un nombre de jours entre 1 et 3650, ou vide pour ne jamais supprimer." };
  await db.user.update({ where: { id: user.id }, data: { monthlyBudgetUsd: budget, purgeDays } });
  revalidatePath("/app", "layout"); // sinon le formulaire se vide et réaffiche l'ancienne valeur
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
  const full = await storageError(user);
  if (full) return { error: full };

  const source = await db.source.create({
    data: { userId: user.id, kind: kindOf(url.hostname), url: url.href, title: url.href, status: "downloading", final: form.get("final") === "1" },
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

async function newClip(input: { sourceId: string; title: string; start: number; end: number; edit: unknown }): Promise<{ error: string } | { id: string }> {
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
  const full = await storageError(user);
  if (full) return { error: full };

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
  return { id: clip.id };
}

export async function createClip(input: { sourceId: string; title: string; start: number; end: number; edit: unknown }): Promise<FormState> {
  const result = await newClip(input);
  return "error" in result ? result : { ok: "Rendu lancé." };
}

/** Publier une vidéo déjà montée : un clip de toute la source, sans sous-titres ni retouche du son, puis la page de publication. */
export async function publishSource(sourceId: string): Promise<FormState> {
  const result = await fullClip(sourceId);
  if ("error" in result) return result;
  redirect(`/app/clips/${result.id}/publier`);
}

/** Vidéo importée déjà montée : crée son clip entier dès qu'elle est prête (appelé par la bibliothèque). */
export async function prepareFinal(sourceId: string): Promise<FormState> {
  const result = await fullClip(sourceId);
  return "error" in result ? result : {};
}

/** Le clip qui couvre toute une source, sans montage. Réutilise celui qui existe déjà. */
async function fullClip(sourceId: string): Promise<{ error: string } | { id: string }> {
  const user = await requireUser();
  const source = await db.source.findFirst({ where: { id: String(sourceId), userId: user.id, status: "ready" } });
  if (!source?.duration) return { error: "Source introuvable ou pas encore prête." };
  const existing = await db.clip.findFirst({
    where: { userId: user.id, sourceId: source.id, start: 0, end: { gte: source.duration - 0.05 }, status: { not: "error" } },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return { id: existing.id };
  if (source.duration > MAX_CLIP_SECONDS)
    return { error: `Cette vidéo dépasse ${MAX_CLIP_SECONDS / 60} minutes : elle ne peut pas être publiée telle quelle. Découpe-la en clips.` };
  return newClip({ sourceId: source.id, title: source.title, start: 0, end: source.duration, edit: { crop: "center", subtitles: false, loudnorm: false } });
}

/** Relance le rendu de clips existants, avec de nouveaux réglages et/ou des sous-titres corrigés. */
export async function rerenderClips(input: { ids: string[]; edit?: unknown; words?: unknown }): Promise<FormState> {
  const user = await requireUser();
  const ids = (Array.isArray(input.ids) ? input.ids : []).slice(0, 100).map(String);
  const edit = input.edit === undefined ? undefined : await checkedEdit(user.id, input.edit);
  if (typeof edit === "string") return { error: edit };

  // Un clip en cours de rendu n'est pas relancé : deux rendus écriraient dans le même dossier.
  const clips = await db.clip.findMany({ where: { id: { in: ids }, userId: user.id, status: { not: "rendering" }, source: { status: "ready" } } });
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

/** Lance la détection des meilleurs moments. Avec Claude : vérifie d'abord que le coût estimé tient dans le budget du mois. */
export async function analyzeSource(sourceId: string, claude: boolean): Promise<FormState> {
  const user = await requireUser();
  const source = await db.source.findFirst({ where: { id: String(sourceId), userId: user.id, status: "ready" } });
  if (!source) return { error: "Source introuvable ou pas encore prête." };
  if (await db.job.findFirst({ where: { userId: user.id, sourceId: source.id, type: "analyze", status: { in: ["queued", "running"] } } }))
    return { error: "Une analyse est déjà en cours pour cette vidéo." };
  if (claude && !usesSubscription(user)) {
    if (!user.keyEncrypted) return { error: NO_KEY };
    const estimate = estimateAnalysisUsd(source.duration ?? 0);
    const left = user.monthlyBudgetUsd - (await monthSpentUsd(user.id));
    if (estimate > left)
      return { error: `Coût estimé ${estimate.toFixed(2)} $, budget restant ${Math.max(left, 0).toFixed(2)} $. Augmente ton budget dans Compte.` };
  }
  await db.job.create({
    data: { userId: user.id, sourceId: source.id, type: "analyze", payload: { sourceId: source.id, claude: Boolean(claude) } },
  });
  return { ok: "Analyse lancée." };
}

export async function deleteCandidate(id: string) {
  const user = await requireUser();
  await db.candidate.deleteMany({ where: { id, userId: user.id } });
}

/** Titres, descriptions, hashtags et score proposés par Claude pour un clip rendu. Compté dans Usage. */
export async function generateMeta(clipId: string, language: string): Promise<FormState & { meta?: ClipMeta }> {
  const user = await requireUser();
  const clip = await db.clip.findFirst({ where: { id: String(clipId), userId: user.id, status: "rendered" } });
  if (!clip) return { error: "Clip introuvable ou pas encore rendu." };
  const subscription = usesSubscription(user);
  if (!subscription && !user.keyEncrypted) return { error: NO_KEY };
  if (!subscription && (await monthSpentUsd(user.id)) >= user.monthlyBudgetUsd) return { error: "Budget Claude du mois atteint. Augmente-le dans Compte." };

  const words = sanitizeWords(clip.words, clip.end - clip.start) ?? [];
  const result = await generateClipMeta(
    subscription ? null : decrypt(user.keyEncrypted!),
    { title: clip.title, seconds: clip.end - clip.start, transcript: words.map((w) => w.w).join(" ") },
    String(language).slice(0, 30) || "français",
  );
  if (result.model)
    await db.usage.create({
      data: {
        userId: user.id,
        model: result.model,
        inputTokens: result.inputTokens ?? 0,
        outputTokens: result.outputTokens ?? 0,
        costUsd: subscription ? 0 : costUsd(result.model, result.inputTokens ?? 0, result.outputTokens ?? 0),
      },
    });
  if ("error" in result) return { error: result.error };
  await db.clip.update({ where: { id: clip.id }, data: { meta: result.meta } });
  return { ok: "Textes proposés par Claude.", meta: result.meta };
}

/** Planifie la publication d'un clip sur un ou plusieurs comptes. Une date passée publie tout de suite. */
export async function schedulePublications(input: {
  clipId: string;
  accountIds: string[];
  when: string;
  texts: { tiktok: string; instagram: string; youtubeTitle: string; youtubeDescription: string };
  tiktokSound: string;
  madeForKids?: boolean;
}): Promise<FormState> {
  const user = await requireUser();
  const clip = await db.clip.findFirst({ where: { id: String(input.clipId), userId: user.id, status: "rendered" } });
  if (!clip) return { error: "Clip introuvable ou pas encore rendu." };
  const ids = (Array.isArray(input.accountIds) ? input.accountIds : []).slice(0, 20).map(String);
  const accounts = await db.account.findMany({ where: { id: { in: ids }, userId: user.id } });
  if (accounts.length === 0) return { error: "Choisis au moins un compte." };

  const asked = new Date(input.when);
  if (Number.isNaN(asked.getTime())) return { error: "Date invalide." };
  if (asked.getTime() > Date.now() + 366 * 24 * 3600 * 1000) return { error: "La date est trop lointaine (un an au plus)." };
  const scheduledAt = asked.getTime() < Date.now() ? new Date() : asked;
  const text = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
  const sound = text(input.tiktokSound, 100);

  for (const account of accounts) {
    if (!isProvider(account.provider)) continue;
    // TikTok : seul le plafond des brouillons est connu, donc seuls les brouillons sont comptés.
    if (account.provider !== "tiktok" || sound) {
      const sameDay = await db.publication.count({
        where: {
          accountId: account.id,
          status: { not: "failed" },
          scheduledAt: { gt: new Date(scheduledAt.getTime() - 24 * 3600 * 1000), lt: new Date(scheduledAt.getTime() + 24 * 3600 * 1000) },
          ...(account.provider === "tiktok" ? { tiktokSound: { not: "" } } : {}),
        },
      });
      if (sameDay >= DAILY_LIMITS[account.provider])
        return { error: `${PROVIDERS[account.provider]} (${account.name}) : plafond de ${DAILY_LIMITS[account.provider]} par 24 heures atteint autour de cette date.` };
    }
  }

  for (const account of accounts) {
    const publication = await db.publication.create({
      data: {
        userId: user.id,
        clipId: clip.id,
        accountId: account.id,
        scheduledAt,
        title: account.provider === "youtube" ? text(input.texts?.youtubeTitle, 100) || clip.title.slice(0, 100) : "",
        description:
          account.provider === "youtube" ? text(input.texts?.youtubeDescription, 4000) : text(account.provider === "tiktok" ? input.texts?.tiktok : input.texts?.instagram, 2200),
        tiktokSound: account.provider === "tiktok" ? sound : "",
        madeForKids: account.provider === "youtube" && input.madeForKids === true,
      },
    });
    // Le job attend dans la file jusqu'à `runAt` : c'est lui, la planification.
    await db.job.create({ data: { userId: user.id, clipId: clip.id, type: "publish", payload: { publicationId: publication.id }, runAt: scheduledAt } });
  }
  return { ok: accounts.length > 1 ? `${accounts.length} publications planifiées.` : "Publication planifiée." };
}

export async function cancelPublication(id: string) {
  const user = await requireUser();
  // En attente : le worker ne trouve plus la ligne et abandonne le job. Déjà publiée : seule la ligne de Hooklip
  // disparaît, le post reste en ligne sur le réseau. Une publication en cours d'envoi ne se supprime pas.
  await db.publication.deleteMany({ where: { id, userId: user.id, status: { not: "publishing" } } });
}

/** Modifie une publication encore en attente : date et textes. Le job de la file est décalé à la nouvelle date. */
export async function updatePublication(input: { id: string; when: string; title: string; description: string }): Promise<FormState> {
  const user = await requireUser();
  const id = String(input.id);
  const publication = await db.publication.findFirst({ where: { id, userId: user.id }, include: { account: { select: { provider: true } } } });
  if (!publication) return { error: "Publication introuvable." };

  const asked = new Date(input.when);
  if (Number.isNaN(asked.getTime())) return { error: "Date invalide." };
  if (asked.getTime() > Date.now() + 366 * 24 * 3600 * 1000) return { error: "La date est trop lointaine (un an au plus)." };
  const scheduledAt = asked.getTime() < Date.now() ? new Date() : asked;
  const youtube = publication.account.provider === "youtube";
  const text = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

  // shortcut: le plafond par 24 heures n'est pas revérifié à la nouvelle date ; à ajouter si des comptes s'en approchent.
  // Le filtre sur le statut évite de toucher une publication que le worker vient de prendre.
  const { count } = await db.publication.updateMany({
    where: { id, userId: user.id, status: "scheduled" },
    data: {
      scheduledAt,
      title: youtube ? text(input.title, 100) || publication.title : "",
      description: text(input.description, youtube ? 4000 : 2200),
    },
  });
  if (!count) return { error: "Cette publication n'est plus en attente : elle ne peut plus être modifiée." };
  await db.job.updateMany({
    where: { userId: user.id, type: "publish", status: "queued", payload: { path: ["publicationId"], equals: id } },
    data: { runAt: scheduledAt },
  });
  return { ok: "Publication modifiée." };
}

export async function retryPublication(id: string): Promise<FormState> {
  const user = await requireUser();
  const { count } = await db.publication.updateMany({ where: { id, userId: user.id, status: "failed" }, data: { status: "scheduled", error: null, scheduledAt: new Date() } });
  if (!count) return { error: "Publication introuvable." };
  const publication = await db.publication.findUniqueOrThrow({ where: { id } });
  await db.job.create({ data: { userId: user.id, clipId: publication.clipId, type: "publish", payload: { publicationId: id } } });
  return { ok: "Nouvelle tentative lancée." };
}

/** Déconnecte un compte. Ses publications (passées et à venir) disparaissent avec lui. */
export async function deleteAccount(id: string) {
  const user = await requireUser();
  await db.account.deleteMany({ where: { id, userId: user.id } });
}

/** Crée d'un coup un clip par moment proposé, avec les mêmes réglages. */
/** Découpe toute la source en parties de même durée, avec les réglages de l'éditeur (sous-titres, accroche, vidéo empilée…). */
export async function splitSource(input: { sourceId: string; seconds: number; numbered: boolean; edit: unknown }): Promise<FormState> {
  const user = await requireUser();
  const source = await db.source.findFirst({ where: { id: String(input.sourceId), userId: user.id, status: "ready" } });
  if (!source?.duration) return { error: "Source introuvable ou pas encore prête." };
  const seconds = Number(input.seconds);
  if (!Number.isFinite(seconds) || seconds < MIN_PART_SECONDS || seconds > MAX_CLIP_SECONDS)
    return { error: `Une partie dure entre ${MIN_PART_SECONDS} et ${MAX_CLIP_SECONDS} secondes.` };
  const parts = splitParts(source.duration, seconds, MAX_CLIP_SECONDS);
  if (parts.length > MAX_PARTS) return { error: `Cela ferait ${parts.length} parties (${MAX_PARTS} au plus). Choisis une durée plus longue.` };
  // Images clés du cadrage manuel : propres à un extrait, elles n'ont pas de sens sur toutes les parties.
  const edit = await checkedEdit(user.id, { ...Object(input.edit), customWords: false, keyframes: [] });
  if (typeof edit === "string") return { error: edit };
  const full = await storageError(user);
  if (full) return { error: full };

  const numbered = input.numbered !== false && parts.length > 1;
  for (const [i, part] of parts.entries()) {
    const label = `Partie ${i + 1}`;
    const hook = numbered ? [edit.hook.trim(), label].filter(Boolean).join(" · ").slice(0, 120) : edit.hook;
    const clip = await db.clip.create({
      data: {
        userId: user.id,
        sourceId: source.id,
        title: (parts.length > 1 ? `${source.title.slice(0, 120)} – ${label.toLowerCase()}/${parts.length}` : source.title).slice(0, 150),
        start: part.start,
        end: part.end,
        edit: { ...edit, hook },
      },
    });
    await db.job.create({ data: { userId: user.id, clipId: clip.id, type: "render", payload: { clipId: clip.id } } });
  }
  return { ok: `${parts.length} partie${parts.length > 1 ? "s" : ""} en cours de rendu, l'une après l'autre. Elles arrivent dans Vidéos finales.` };
}

export async function createClipsBatch(input: { sourceId: string; candidateIds: string[]; edit: unknown }): Promise<FormState> {
  const user = await requireUser();
  const source = await db.source.findFirst({ where: { id: String(input.sourceId), userId: user.id, status: "ready" } });
  if (!source) return { error: "Source introuvable ou pas encore prête." };
  const ids = (Array.isArray(input.candidateIds) ? input.candidateIds : []).slice(0, 20).map(String);
  const candidates = await db.candidate.findMany({ where: { id: { in: ids }, userId: user.id, sourceId: source.id }, orderBy: { score: "desc" } });
  if (candidates.length === 0) return { error: "Aucun moment à transformer en clip." };
  const edit = await checkedEdit(user.id, { ...Object(input.edit), customWords: false, keyframes: [] });
  if (typeof edit === "string") return { error: edit };
  const full = await storageError(user);
  if (full) return { error: full };

  for (const c of candidates) {
    const clip = await db.clip.create({
      data: { userId: user.id, sourceId: source.id, title: c.title.slice(0, 150), start: c.start, end: Math.min(c.end, c.start + MAX_CLIP_SECONDS), edit },
    });
    await db.job.create({ data: { userId: user.id, clipId: clip.id, type: "render", payload: { clipId: clip.id } } });
  }
  return { ok: `${candidates.length} rendus lancés. Ils passent l'un après l'autre.` };
}

/** Demande au worker de relire les vues et les « J'aime » des posts publiés. */
export async function refreshStats(): Promise<FormState> {
  const user = await requireUser();
  if (await db.job.findFirst({ where: { userId: user.id, type: "stats", status: { in: ["queued", "running"] } } })) return { ok: "Relevé déjà en cours." };
  await db.job.create({ data: { userId: user.id, type: "stats", payload: {} } });
  return { ok: "Relevé lancé." };
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Envoie un lien de réinitialisation. La réponse est la même que le compte existe ou non. */
export async function requestReset(_: FormState, form: FormData): Promise<FormState> {
  if (await tooManyAttempts()) return { error: "Trop de tentatives. Réessaie dans une minute." };
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const user = await db.user.findUnique({ where: { email } });
  if (user) {
    const token = randomBytes(32).toString("hex");
    await db.passwordReset.deleteMany({ where: { userId: user.id } }); // un seul lien valable à la fois
    await db.passwordReset.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 3600 * 1000) } });
    const link = `${APP_URL}/reinitialiser/${token}`;
    const sent = await sendMail(
      email,
      "Hooklip : choisir un nouveau mot de passe",
      `Bonjour,\n\nPour choisir un nouveau mot de passe, ouvre ce lien (valable une heure, utilisable une fois) :\n\n${link}\n\nSi tu n'as rien demandé, ignore ce message : ton mot de passe ne change pas.\n`,
    ).catch((e) => {
      console.error(e);
      return false;
    });
    // Sans serveur d'email, l'administrateur retrouve le lien dans le journal du serveur.
    if (!sent) console.log(`[Hooklip] Lien de réinitialisation pour ${email} : ${link}`);
  }
  return {
    ok: mailConfigured()
      ? "Si un compte existe avec cet email, un lien vient d'être envoyé. Il est valable une heure."
      : "Si un compte existe avec cet email, un lien a été créé. L'envoi d'emails n'est pas configuré sur ce serveur : demande le lien à l'administrateur.",
  };
}

export async function resetPassword(_: FormState, form: FormData): Promise<FormState> {
  if (await tooManyAttempts()) return { error: "Trop de tentatives. Réessaie dans une minute." };
  const password = String(form.get("password") ?? "");
  if (password.length < MIN_PASSWORD) return { error: `Le mot de passe doit faire au moins ${MIN_PASSWORD} caractères.` };
  if (password.length > MAX_PASSWORD) return { error: "Mot de passe trop long." };
  if (password !== String(form.get("confirm") ?? "")) return { error: "Les deux mots de passe ne sont pas identiques." };
  const reset = await db.passwordReset.findUnique({ where: { tokenHash: sha256(String(form.get("token") ?? "")) } });
  if (!reset || reset.expiresAt < new Date()) return { error: "Ce lien a expiré ou a déjà servi. Refais une demande." };

  await db.user.update({ where: { id: reset.userId }, data: { passwordHash: await hashPassword(password) } });
  await db.passwordReset.deleteMany({ where: { userId: reset.userId } });
  await db.session.deleteMany({ where: { userId: reset.userId } }); // quiconque était connecté avec l'ancien mot de passe est déconnecté
  await createSession(reset.userId);
  redirect("/app");
}

// --- Clips recommandés : niches Twitch / Kick relevées par le worker ---

export async function findCategories(platform: string, query: string): Promise<{ error: string } | { categories: Category[] }> {
  await requireUser();
  if (!isNichePlatform(platform)) return { error: "Plateforme inconnue." };
  if (platform === "twitch" && !twitchConfigured()) return { error: "Twitch n'est pas encore configuré sur Hooklip." };
  const q = String(query).trim().slice(0, 80);
  if (q.length < 2) return { categories: [] };
  try {
    return { categories: await searchCategories(platform, q) };
  } catch {
    return { error: `${NICHE_PLATFORMS[platform]} ne répond pas pour le moment. Réessaie.` };
  }
}

function nicheSettings(input: { language?: unknown; period?: unknown; everyHours?: unknown }) {
  return {
    language: typeof input.language === "string" && input.language in LANGUAGES ? input.language : "",
    period: input.period === "week" ? "week" : "day",
    everyHours: EVERY_HOURS.includes(Number(input.everyHours)) ? Number(input.everyHours) : 6,
  };
}

export async function addNiche(input: { platform: string; categoryId: string; name: string; language?: string; period?: string; everyHours?: number }): Promise<FormState> {
  const user = await requireUser();
  if (!isNichePlatform(input.platform)) return { error: "Plateforme inconnue." };
  const categoryId = String(input.categoryId).slice(0, 100);
  const name = String(input.name).trim().slice(0, 100);
  if (!categoryId || !name) return { error: "Choisis une catégorie." };
  if ((await db.niche.count({ where: { userId: user.id } })) >= MAX_NICHES) return { error: `${MAX_NICHES} niches au plus.` };
  const settings = nicheSettings(input);
  // Kick ne donne pas la langue des clips.
  if (input.platform === "kick") settings.language = "";
  await db.niche.upsert({
    where: { userId_platform_categoryId: { userId: user.id, platform: input.platform, categoryId } },
    create: { userId: user.id, platform: input.platform, categoryId, name, ...settings },
    update: { ...settings, fetchedAt: null },
  });
  revalidatePath("/app/recommandes");
  return { ok: `${name} ajoutée. Les premiers clips arrivent d'ici une minute.` };
}

export async function updateNiche(input: { id: string; language?: string; period?: string; everyHours?: number }) {
  const user = await requireUser();
  const niche = await db.niche.findFirst({ where: { id: String(input.id), userId: user.id } });
  if (!niche) return;
  const settings = nicheSettings(input);
  if (niche.platform === "kick") settings.language = "";
  // Langue ou période changée : les clips déjà relevés ne correspondent plus.
  const changed = settings.language !== niche.language || settings.period !== niche.period;
  if (changed) await db.recommendation.deleteMany({ where: { nicheId: niche.id, status: { not: "imported" } } });
  await db.niche.update({ where: { id: niche.id }, data: { ...settings, ...(changed ? { fetchedAt: null } : {}) } });
  revalidatePath("/app/recommandes");
}

export async function refreshNiches() {
  const user = await requireUser();
  await db.niche.updateMany({ where: { userId: user.id }, data: { fetchedAt: null } });
  revalidatePath("/app/recommandes");
}

export async function deleteNiche(id: string) {
  const user = await requireUser();
  await db.niche.deleteMany({ where: { id: String(id), userId: user.id } }); // supprime ses clips recommandés ; les sources déjà importées restent
  revalidatePath("/app/recommandes");
}

/** Importe un clip recommandé comme source à découper : il est horizontal, il faut le recadrer. */
export async function importRecommendation(id: string): Promise<FormState> {
  const user = await requireUser();
  const reco = await db.recommendation.findFirst({ where: { id: String(id), userId: user.id } });
  if (!reco) return { error: "Clip introuvable." };
  const full = await storageError(user);
  if (full) return { error: full };
  const source = await db.source.create({
    data: { userId: user.id, kind: reco.platform, url: reco.url, title: reco.title || reco.url, status: "downloading" },
  });
  await db.job.create({ data: { userId: user.id, sourceId: source.id, type: "ingest", payload: { sourceId: source.id } } });
  await db.recommendation.update({ where: { id: reco.id }, data: { status: "imported" } });
  revalidatePath("/app/recommandes");
  return { ok: "Import lancé : le clip arrive dans tes sources." };
}

export async function dismissRecommendation(id: string) {
  const user = await requireUser();
  await db.recommendation.updateMany({ where: { id: String(id), userId: user.id }, data: { status: "dismissed" } });
  revalidatePath("/app/recommandes");
}

// --- Fast clip : une vidéo déjà à la bonne durée, deux ou trois réglages, puis la programmation ---

/** Source d'un fast clip à partir d'un lien ou d'un clip recommandé. Renvoie l'id de la source créée. */
export async function fastSource(input: { url?: string; recoId?: string }): Promise<{ error: string } | { id: string }> {
  const user = await requireUser();
  let url: URL;
  let title: string;
  let kind: string;
  const reco = input.recoId ? await db.recommendation.findFirst({ where: { id: String(input.recoId), userId: user.id } }) : null;
  try {
    url = new URL(reco ? reco.url : String(input.url ?? "").trim());
  } catch {
    return { error: input.recoId ? "Clip introuvable." : "URL invalide." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { error: "URL invalide." };
  if (reco) {
    title = reco.title || url.href;
    kind = reco.platform;
  } else {
    title = url.href;
    kind = kindOf(url.hostname);
  }
  const full = await storageError(user);
  if (full) return { error: full };
  const source = await db.source.create({ data: { userId: user.id, kind, url: url.href, title, status: "downloading" } });
  await db.job.create({ data: { userId: user.id, sourceId: source.id, type: "ingest", payload: { sourceId: source.id } } });
  if (reco) await db.recommendation.update({ where: { id: reco.id }, data: { status: "imported" } });
  return { id: source.id };
}

/** Rend toute la source avec les réglages rapides, puis ouvre la page de publication (qui attend la fin du rendu). */
export async function fastClip(input: { sourceId: string; title: string; edit: unknown }): Promise<FormState> {
  const user = await requireUser();
  const source = await db.source.findFirst({ where: { id: String(input.sourceId), userId: user.id, status: "ready" } });
  if (!source?.duration) return { error: "Vidéo pas encore prête." };
  if (source.duration > MAX_CLIP_SECONDS)
    return { error: `Cette vidéo dure plus de ${MAX_CLIP_SECONDS / 60} minutes : découpe-la dans l'éditeur.` };
  const title = String(input.title ?? "").trim().slice(0, 150) || source.title;
  const result = await newClip({ sourceId: source.id, title, start: 0, end: source.duration, edit: input.edit });
  if ("error" in result) return result;
  redirect(`/app/clips/${result.id}/publier`);
}
