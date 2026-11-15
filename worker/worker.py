"""Worker ClipForge : prend les jobs dans la table "Job" de Postgres et les exécute un par un."""

import os
import shutil
import subprocess
import sys
import time
import traceback
import wave
from pathlib import Path

import psycopg
import yt_dlp
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from render import (build_ass, build_srt, keep_intervals, loud_peaks, remap_words, render_cmd, smooth,
                    speech_segments, thumb_cmd, voice_cmd)

DATA = Path(os.environ.get("DATA_DIR", "/data"))
MAX_HOURS = float(os.environ.get("MAX_SOURCE_HOURS", "8"))
MAX_ATTEMPTS = 3
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "small")

# Prisma stocke les dates en UTC sans fuseau.
NOW = "(now() at time zone 'utc')"

# Un seul job lourd à la fois par utilisateur ; SKIP LOCKED permet de lancer plusieurs workers.
CLAIM = f"""
UPDATE "Job" SET status = 'running', attempts = attempts + 1, "updatedAt" = {NOW}
WHERE id = (
  SELECT j.id FROM "Job" j
  WHERE j.status = 'queued' AND j."runAt" <= {NOW}
    AND NOT EXISTS (SELECT 1 FROM "Job" r WHERE r."userId" = j."userId" AND r.status = 'running')
  ORDER BY j."createdAt"
  FOR UPDATE SKIP LOCKED LIMIT 1
)
RETURNING *
"""


class Fatal(Exception):
    """Erreur définitive : inutile de réessayer. Le message est affiché à l'utilisateur."""


def proxy_cmd(src: Path, dst: Path) -> list[str]:
    """Aperçu 480p léger pour la prévisualisation dans le navigateur."""
    return [
        "ffmpeg", "-y", "-i", str(src),
        "-vf", "scale=-2:480",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "28",
        "-c:a", "aac", "-b:a", "96k",
        "-movflags", "+faststart",
        "-progress", "pipe:1", "-nostats", "-loglevel", "error",
        str(dst),
    ]


def probe_duration(file: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(file)],
        capture_output=True, text=True,
    )
    try:
        return float(out.stdout.strip())
    except ValueError:
        raise Fatal("Fichier vidéo illisible.")


def check_duration(seconds: float):
    if seconds > MAX_HOURS * 3600:
        raise Fatal(f"Vidéo trop longue : {seconds / 3600:.1f} h (maximum {MAX_HOURS:g} h).")


def make_progress(conn, job):
    """Renvoie une fonction qui écrit la progression du job, seulement quand le pourcentage change."""
    last = -1

    def progress(percent: float):
        nonlocal last
        percent = max(0, min(99, int(percent)))
        if percent != last:
            last = percent
            conn.execute('UPDATE "Job" SET progress = %s, "updatedAt" = ' + NOW + " WHERE id = %s", [percent, job["id"]])

    return progress


def run_ffmpeg(cmd: list[str], duration: float, progress, lo: float, hi: float, cwd: Path | None = None):
    """Lance FFmpeg et fait avancer la progression de `lo` à `hi`."""
    process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, cwd=cwd)
    for line in process.stdout:
        if line.startswith("out_time_us=") and duration > 0:
            try:
                progress(lo + int(line.split("=")[1]) / 1e6 / duration * (hi - lo))
            except ValueError:
                pass  # "N/A" en début d'encodage
    if process.wait() != 0:
        raise Fatal("FFmpeg n'a pas pu traiter cette vidéo : " + process.stderr.read()[-300:])


def ingest(conn, job):
    """Télécharge la source si c'est une URL, puis mesure sa durée et crée l'aperçu."""
    src = conn.execute('SELECT * FROM "Source" WHERE id = %s', [job["payload"]["sourceId"]]).fetchone()
    if src is None:  # supprimée entre-temps
        return
    folder = DATA / src["userId"] / "sources" / src["id"]
    folder.mkdir(parents=True, exist_ok=True)

    progress = make_progress(conn, job)

    if src["url"]:
        def hook(d):
            total = d.get("total_bytes") or d.get("total_bytes_estimate")
            if d["status"] == "downloading" and total:
                # shortcut: vidéo et audio téléchargés séparément font repartir la barre de zéro.
                progress(d.get("downloaded_bytes", 0) / total * 70)

        options = {
            "outtmpl": str(folder / "source.%(ext)s"),
            "format": "bv*[height<=1080]+ba/b[height<=1080]/b",
            "merge_output_format": "mp4",
            "noplaylist": True,
            "quiet": True,
            "no_warnings": True,
            "progress_hooks": [hook],
        }
        try:
            with yt_dlp.YoutubeDL(options) as ydl:
                info = ydl.extract_info(src["url"], download=False)
                check_duration(info.get("duration") or 0)
                conn.execute('UPDATE "Source" SET title = %s WHERE id = %s', [(info.get("title") or src["url"])[:200], src["id"]])
                ydl.download([src["url"]])
        except yt_dlp.utils.DownloadError as e:
            # Réessayable : peut être une coupure réseau passagère.
            raise RuntimeError(f"Téléchargement impossible. Vérifie l'URL et que la vidéo est publique. Détail : {e}")
        file = next(p for p in folder.glob("source.*") if p.suffix != ".part")
        conn.execute('UPDATE "Source" SET status = %s WHERE id = %s', ["analyzing", src["id"]])
    else:
        file = DATA / src["filePath"]

    duration = probe_duration(file)
    check_duration(duration)

    proxy = folder / "proxy.mp4"
    run_ffmpeg(proxy_cmd(file, proxy), duration, progress, 70, 100)

    size = file.stat().st_size + proxy.stat().st_size
    row = conn.execute(
        'SELECT COALESCE(SUM(s."sizeBytes"), 0) AS used, MAX(u."storageQuotaGb") AS quota '
        'FROM "User" u LEFT JOIN "Source" s ON s."userId" = u.id AND s.id <> %s WHERE u.id = %s',
        [src["id"], src["userId"]],
    ).fetchone()
    if int(row["used"]) + size > row["quota"] * 1024**3:
        raise Fatal("Quota de stockage dépassé. Supprime des sources pour continuer.")

    updated = conn.execute(
        'UPDATE "Source" SET status = %s, duration = %s, "sizeBytes" = %s, "filePath" = %s, "proxyPath" = %s, error = NULL WHERE id = %s',
        ["ready", duration, size, file.relative_to(DATA).as_posix(), proxy.relative_to(DATA).as_posix(), src["id"]],
    )
    if updated.rowcount == 0:  # source supprimée pendant le traitement
        shutil.rmtree(folder, ignore_errors=True)


_whisper = None


def read_wav(audio: Path):
    """Échantillons (entre -1 et 1) d'un WAV mono 16 kHz produit par FFmpeg."""
    import numpy as np

    with wave.open(str(audio)) as f:
        return np.frombuffer(f.readframes(f.getnframes()), np.int16).astype(np.float32) / 32768


def audio_levels(audio: Path, step: float) -> list[float]:
    """Volume (RMS) par tranche de `step` secondes."""
    import numpy as np

    samples = read_wav(audio)
    size = int(16000 * step)
    return [float(np.sqrt(np.mean(samples[i:i + size] ** 2))) for i in range(0, len(samples) - size + 1, size)]


def transcribe(audio: Path, on_progress) -> tuple[list[dict], str]:
    """Mots horodatés [{w, start, end}] et langue détectée, avec faster-whisper, en local."""
    global _whisper
    if _whisper is None:
        from faster_whisper import WhisperModel  # import lent : seulement au premier rendu

        _whisper = WhisperModel(WHISPER_MODEL, device="auto", compute_type="int8")
    # Lecture directe du WAV : évite le décodeur PyAV de faster-whisper.
    samples = read_wav(audio)
    segments, info = _whisper.transcribe(samples, word_timestamps=True, vad_filter=True)
    words = []
    for segment in segments:  # générateur : la transcription avance à chaque tour
        words += [{"w": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3)} for w in segment.words or []]
        on_progress(segment.end / info.duration if info.duration else 1)
    return words, info.language


# shortcut: deux voix Piper seulement, le français sert de repli. Ajouter ici d'autres
# langues (liste : huggingface.co/rhasspy/piper-voices) quand le besoin arrive.
VOICES = {"fr": "fr_FR-siwis-medium", "en": "en_US-lessac-medium"}
_voices = {}


def speak(text: str, language: str, dst: Path) -> float:
    """Écrit `text` dit par une voix de synthèse Piper (locale) dans un WAV. Renvoie sa durée."""
    name = VOICES.get(language, VOICES["fr"])
    if name not in _voices:
        from piper import PiperVoice

        folder = Path(os.environ.get("HF_HOME", "/models")) / "piper"
        folder.mkdir(parents=True, exist_ok=True)
        if not (folder / f"{name}.onnx.json").exists():  # téléchargée une fois, gardée dans le volume `models`
            subprocess.run([sys.executable, "-m", "piper.download_voices", name, "--data-dir", str(folder)], check=True)
        _voices[name] = PiperVoice.load(str(folder / f"{name}.onnx"))
    with wave.open(str(dst), "wb") as f:
        _voices[name].synthesize_wav(text, f)
    with wave.open(str(dst)) as f:
        return f.getnframes() / f.getframerate()


def voice_track(words: list[dict], language: str, duration: float, folder: Path) -> str:
    """Redit la transcription avec la voix de synthèse, chaque phrase calée sur son instant d'origine."""
    segments = speech_segments(words)
    parts = []
    for i, (t, text) in enumerate(segments):
        length = speak(text, language, folder / f"tts{i}.wav")
        slot = (segments[i + 1][0] if i + 1 < len(segments) else duration) - t
        parts.append((f"tts{i}.wav", t, length / max(slot, 0.1)))
    done = subprocess.run(voice_cmd(parts, duration, "voice.wav"), cwd=folder, capture_output=True, text=True)
    for wav, _, _ in parts:
        (folder / wav).unlink(missing_ok=True)
    if done.returncode != 0:
        raise Fatal("Impossible d'assembler la voix de synthèse : " + done.stderr[-300:])
    return "voice.wav"


def track_face(video: Path, start: float, duration: float, on_progress) -> list[tuple[float, float | None]]:
    """Centre horizontal du plus grand visage (0 à 1), une mesure par seconde."""
    import cv2

    # shortcut: détecteur Haar fourni avec OpenCV (visages de face). Passer à YuNet ou
    # mediapipe si le suivi décroche sur des visages de profil ou très petits.
    detector = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    capture = cv2.VideoCapture(str(video))
    points = []
    t = 0.0
    while t <= duration:
        capture.set(cv2.CAP_PROP_POS_MSEC, (start + t) * 1000)
        ok, frame = capture.read()
        center = None
        if ok:
            faces = detector.detectMultiScale(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), 1.1, 5, minSize=(40, 40))
            if len(faces):
                x, _, w, _ = max(faces, key=lambda f: f[2] * f[3])
                center = float(x + w / 2) / frame.shape[1]
        points.append((t, center))
        on_progress(t / duration)
        t += 1.0
    capture.release()
    return points


def render(conn, job):
    """Produit un clip vertical à partir des réglages de Clip.edit (voir web/lib/edit.ts)."""
    clip = conn.execute(
        'SELECT c.*, s."filePath", s."proxyPath" FROM "Clip" c JOIN "Source" s ON s.id = c."sourceId" WHERE c.id = %s',
        [job["payload"]["clipId"]],
    ).fetchone()
    if clip is None:  # supprimé entre-temps
        return
    progress = make_progress(conn, job)
    source = DATA / clip["filePath"]
    start, duration = clip["start"], clip["end"] - clip["start"]
    folder = DATA / clip["userId"] / "clips" / clip["id"]
    folder.mkdir(parents=True, exist_ok=True)
    edit = clip["edit"]

    # Mots : ceux corrigés par l'utilisateur, sinon une transcription si un réglage en a besoin.
    custom = bool(edit.get("customWords")) and clip["words"] is not None
    words, language, zooms = (clip["words"], clip["language"] or "fr", []) if custom else ([], "fr", [])
    need_words = not custom and (edit.get("subtitles") or edit.get("voice") or edit.get("cutSilences"))
    if need_words or edit.get("zoomPunch"):
        audio = folder / "audio.wav"
        extracted = subprocess.run(
            ["ffmpeg", "-y", "-ss", f"{start:.3f}", "-t", f"{duration:.3f}", "-i", str(source),
             "-vn", "-ac", "1", "-ar", "16000", "-loglevel", "error", str(audio)],
            capture_output=True,
        )
        if extracted.returncode == 0:  # sinon : pas de piste audio
            if need_words:
                words, language = transcribe(audio, lambda f: progress(f * 40))
            if edit.get("zoomPunch"):
                zooms = loud_peaks(audio_levels(audio, 0.25), 0.25, max(1, int(duration // 10)))
        audio.unlink(missing_ok=True)
    progress(40)

    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate", "-of", "csv=p=0", str(source)],
        capture_output=True, text=True,
    ).stdout.strip().split(",")
    try:
        w, h = int(probe[0]), int(probe[1])
        num, den = probe[2].split("/")
        fps = probe[2] if 1 <= int(num) / int(den) <= 60 else "30"  # cadence aberrante (flux variable) : 30
    except (ValueError, IndexError, ZeroDivisionError):
        raise Fatal("Cette source n'a pas de piste vidéo.")

    points = [(0.0, 0.5)]
    if edit.get("crop") == "face":
        points = smooth(track_face(DATA / clip["proxyPath"], start, duration, lambda f: progress(40 + f * 15)))
    elif edit.get("crop") == "manual" and edit.get("keyframes"):
        points = sorted((k["t"], k["x"]) for k in edit["keyframes"])
    progress(55)

    # Sans parole détectée, rien à couper et rien à dire : le son d'origine reste.
    keep = keep_intervals(words, duration) if edit.get("cutSilences") and words else None
    out_duration = sum(b - a for a, b in keep) if keep else duration
    timed = remap_words(words, keep) if keep else words
    subtitles = bool(words) and bool(edit.get("subtitles"))
    hook, watermark = edit.get("hook") or "", edit.get("watermark") or ""
    has_ass = subtitles or bool(hook.strip()) or bool(watermark.strip())
    if has_ass:
        (folder / "subs.ass").write_text(
            build_ass(timed if subtitles else [], edit.get("subStyle"), hook, watermark, out_duration), encoding="utf-8")
    if subtitles:
        (folder / "clip.srt").write_text(build_srt(timed), encoding="utf-8")

    voice = voice_track(timed, language, out_duration, folder) if edit.get("voice") and words else None
    music = DATA / clip["userId"] / "music" / Path(edit.get("music") or "-").name
    stack = None
    if edit.get("stackSourceId") and edit.get("crop") != "split":
        row = conn.execute('SELECT "filePath" FROM "Source" WHERE id = %s AND "userId" = %s AND status = %s',
                           [edit["stackSourceId"], clip["userId"], "ready"]).fetchone()
        if row is None:
            raise Fatal("La vidéo secondaire n'existe plus. Choisis-en une autre.")
        stack = str(DATA / row["filePath"])
    has_audio = bool(subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", str(source)],
        capture_output=True, text=True,
    ).stdout.strip())

    output = folder / "clip.mp4"
    cmd = render_cmd(source, output, start, duration, (w, h), fps, edit, points,
                     ass="subs.ass" if has_ass else None, keep=keep, zooms=zooms, voice=voice,
                     music=str(music) if music.is_file() else None, stack=stack, source_audio=has_audio)
    # cwd = dossier du clip : le filtre `ass` reçoit un simple nom de fichier, sans caractères à échapper.
    run_ffmpeg(cmd, out_duration, progress, 55, 100, cwd=folder)
    (folder / "voice.wav").unlink(missing_ok=True)
    subprocess.run(thumb_cmd("clip.mp4", "thumb.jpg", out_duration / 3), cwd=folder, capture_output=True)

    updated = conn.execute(
        'UPDATE "Clip" SET status = %s, words = %s, language = %s, "outputPath" = %s, "srtPath" = %s, "sizeBytes" = %s, error = NULL WHERE id = %s',
        ["rendered", Jsonb(words), language, output.relative_to(DATA).as_posix(),
         (folder / "clip.srt").relative_to(DATA).as_posix() if subtitles else None, output.stat().st_size, clip["id"]],
    )
    if updated.rowcount == 0:  # clip supprimé pendant le rendu
        shutil.rmtree(folder, ignore_errors=True)


HANDLERS = {"ingest": ingest, "render": render}


def run(conn, job):
    try:
        HANDLERS[job["type"]](conn, job)
        conn.execute(f'UPDATE "Job" SET status = %s, progress = 100, error = NULL, "updatedAt" = {NOW} WHERE id = %s', ["done", job["id"]])
    except Exception as e:
        traceback.print_exc()
        message = str(e)[:500] or type(e).__name__
        if not isinstance(e, Fatal) and job["attempts"] < MAX_ATTEMPTS:
            # Nouvelle tentative, de plus en plus espacée.
            conn.execute(
                f'UPDATE "Job" SET status = %s, error = %s, "runAt" = {NOW} + %s * interval \'30 seconds\', "updatedAt" = {NOW} WHERE id = %s',
                ["queued", message, job["attempts"], job["id"]],
            )
            return
        conn.execute(f'UPDATE "Job" SET status = %s, error = %s, "updatedAt" = {NOW} WHERE id = %s', ["failed", message, job["id"]])
        if job["sourceId"]:
            conn.execute('UPDATE "Source" SET status = %s, error = %s WHERE id = %s', ["error", message, job["sourceId"]])
            # Pas de fichiers orphelins qui occupent le disque sans compter dans le quota.
            src = conn.execute('SELECT "userId" FROM "Source" WHERE id = %s', [job["sourceId"]]).fetchone()
            if src:
                shutil.rmtree(DATA / src["userId"] / "sources" / job["sourceId"], ignore_errors=True)
        if job["clipId"]:
            conn.execute('UPDATE "Clip" SET status = %s, error = %s WHERE id = %s', ["error", message, job["clipId"]])


def main():
    with psycopg.connect(os.environ["DATABASE_URL"], autocommit=True, row_factory=dict_row) as conn:
        # shortcut: suppose un seul worker. Avec plusieurs, ne relancer que les jobs
        # dont "updatedAt" est vieux (worker mort), pas tous les jobs en cours.
        conn.execute("UPDATE \"Job\" SET status = 'queued' WHERE status = 'running'")
        print("Worker prêt.", flush=True)
        while True:
            job = conn.execute(CLAIM).fetchone()
            if job:
                print(f"Job {job['id']} ({job['type']}), tentative {job['attempts']}", flush=True)
                run(conn, job)
            else:
                time.sleep(1)


if __name__ == "__main__":
    main()
