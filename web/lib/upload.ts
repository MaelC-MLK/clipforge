// Constantes partagées entre le navigateur et le serveur.
export const CHUNK = 5 * 1024 * 1024; // taille d'un morceau d'upload
export const VIDEO_EXT = [".mp4", ".mov", ".mkv", ".webm"];
export const MAX_CLIP_SECONDS = 180;
export const MIN_PASSWORD = 8;
export const MUSIC_EXT = [".mp3", ".wav", ".m4a", ".ogg", ".flac"];
export const MAX_MUSIC_BYTES = 30 * 1024 * 1024;
export const MAX_MUSIC_FILES = 20;

/** Envoie une vidéo par morceaux à /api/upload (navigateur). Renvoie l'id de la source créée, ou un message d'erreur. */
export async function uploadVideo(file: File, final: boolean, onProgress: (percent: number) => void): Promise<{ sourceId: string } | { error: string }> {
  const uploadId = crypto.randomUUID();
  const total = Math.max(1, Math.ceil(file.size / CHUNK));
  let last: { sourceId?: string } = {};
  for (let index = 0; index < total; index++) {
    const res = await fetch("/api/upload", {
      method: "POST",
      headers: {
        "x-upload-id": uploadId,
        "x-chunk-index": String(index),
        "x-chunk-total": String(total),
        "x-filename": encodeURIComponent(file.name),
        "x-final": final ? "1" : "0",
      },
      body: file.slice(index * CHUNK, (index + 1) * CHUNK),
    }).catch(() => null);
    if (!res?.ok) return { error: (await res?.json().catch(() => null))?.error ?? "Connexion interrompue pendant l'envoi." };
    last = await res.json();
    onProgress(Math.round(((index + 1) / total) * 100));
  }
  return last.sourceId ? { sourceId: last.sourceId } : { error: "Envoi incomplet." };
}
