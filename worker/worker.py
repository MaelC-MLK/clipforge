"""Worker Hooklip : prend les jobs dans la table "Job" de Postgres et les exécute un par un."""

import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import traceback
import urllib.parse
import urllib.request
import uuid
import wave
from datetime import datetime, timedelta, timezone
from pathlib import Path

import psycopg
import yt_dlp
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

import publish as networks
from crypto import decrypt, encrypt
from detect import (BUCKET, bucket_mean, build_candidates, clean_moments, cli_answer, combine, cost_usd, format_slice,
                    normalize, slices, spread)
from render import (build_ass, build_srt, keep_intervals, loud_peaks, remap_words, render_cmd, smooth,
                    speech_segments, thumb_cmd, voice_cmd)

DATA = Path(os.environ.get("DATA_DIR", "/data"))
MAX_HOURS = float(os.environ.get("MAX_SOURCE_HOURS", "8"))
# Espace minimum à laisser libre sur le serveur, tous comptes confondus (même réglage dans web/lib/storage.ts).
MIN_FREE_BYTES = float(os.environ.get("MIN_FREE_GB") or 20) * 1024**3
MAX_ATTEMPTS = 3
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "small")
CLAUDE_MODEL = os.environ.get("CLAUDE_MODEL") or "claude-opus-5-5"

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


def check_disk():
    if shutil.disk_usage(DATA).free < MIN_FREE_BYTES:
        raise Fatal("Le serveur est presque plein : réessaie plus tard.")


def free_quota(conn, user_id: str, source_id: str = "") -> int:
    """Octets encore disponibles dans le quota de l'utilisateur (sources et clips, sans compter `source_id`)."""
    row = conn.execute(
        'SELECT u."storageQuotaGb" * 1024.0 ^ 3 '
        '- COALESCE((SELECT SUM("sizeBytes") FROM "Source" WHERE "userId" = u.id AND id <> %s), 0) '
        '- COALESCE((SELECT SUM("sizeBytes") FROM "Clip" WHERE "userId" = u.id), 0) AS free FROM "User" u WHERE u.id = %s',
        [source_id, user_id],
    ).fetchone()
    return int(row["free"]) if row else 0


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
    check_disk()
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
            # 1440p quand il existe : un cadre vertical pris dans du 16:9 garde plus de détails une fois agrandi en 1080x1920.
            "format": "bv*[height<=1440]+ba/b[height<=1440]/b",
            "merge_output_format": "mp4",
            "noplaylist": True,
            "quiet": True,
            "no_warnings": True,
            "progress_hooks": [hook],
            # shortcut: yt-dlp ne respecte la limite que si le site annonce la taille ; la vérification après coup reste.
            "max_filesize": max(1, free_quota(conn, src["userId"], src["id"])),
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
        file = next((p for p in folder.glob("source.*") if p.suffix != ".part"), None)
        if file is None:  # yt-dlp a refusé le fichier, trop lourd pour le quota restant
            raise Fatal("Vidéo trop lourde pour l'espace qu'il te reste. Supprime des sources ou des clips, puis réessaie.")
        conn.execute('UPDATE "Source" SET status = %s WHERE id = %s', ["analyzing", src["id"]])
    else:
        file = DATA / src["filePath"]

    duration = probe_duration(file)
    check_duration(duration)

    proxy = folder / "proxy.mp4"
    run_ffmpeg(proxy_cmd(file, proxy), duration, progress, 70, 100)

    size = file.stat().st_size + proxy.stat().st_size
    if size > free_quota(conn, src["userId"], src["id"]):
        raise Fatal("Quota de stockage dépassé. Supprime des sources ou des clips pour continuer.")

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


def separate_voice(source: Path, start: float, duration: float, dst: Path) -> bool:
    """Garde seulement la voix du passage (Demucs htdemucs) : musique et sons du jeu retirés. False si pas de son.

    Sur le processeur, compter environ deux minutes de calcul par minute de clip.
    """
    import numpy as np
    import torch
    from demucs.apply import apply_model
    from demucs.pretrained import get_model

    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-ss", f"{start:.3f}", "-t", f"{duration:.3f}", "-i", str(source),
         "-vn", "-f", "f32le", "-ac", "2", "-ar", "44100", "-"],
        capture_output=True,
    ).stdout
    if len(raw) < 44100 * 8:  # moins de 0,1 s de son : pas de piste audio
        return False
    torch.hub.set_dir(str(Path(os.environ.get("HF_HOME", "/models")) / "torch"))  # poids gardés entre deux rendus
    torch.set_num_threads(max(1, (os.cpu_count() or 2) - 1))
    model = get_model("htdemucs")
    model.eval()
    wav = torch.from_numpy(np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).T.copy())
    ref = wav.mean(0)
    mean, std = ref.mean(), ref.std() + 1e-8
    with torch.no_grad():
        stems = apply_model(model, ((wav - mean) / std)[None], device="cpu", progress=False)[0]
    vocals = stems[model.sources.index("vocals")] * std + mean
    pcm = (vocals.clamp(-1, 1).T.numpy() * 32767).astype(np.int16)
    with wave.open(str(dst), "wb") as f:
        f.setnchannels(2)
        f.setsampwidth(2)
        f.setframerate(44100)
        f.writeframes(pcm.tobytes())
    return True


YUNET = Path(os.environ.get("YUNET_MODEL", "/opt/models/yunet.onnx"))


def scene_cuts(video: Path, start: float, duration: float) -> list[float]:
    """Changements de plan dans le clip (PySceneDetect), en secondes depuis son début."""
    from scenedetect import ContentDetector, detect

    scenes = detect(str(video), ContentDetector(), start_time=start, end_time=start + duration)
    return [round(s.get_seconds() - start, 2) for s, _ in scenes[1:]]


def track_face(video: Path, start: float, duration: float, on_progress, cuts: list[float] = ()) -> list[tuple[float, float | None]]:
    """Centre horizontal du plus grand visage (0 à 1) : une mesure par seconde, plus une juste après chaque changement de plan."""
    import cv2

    # YuNet (OpenCV) : trouve aussi les petits visages et ceux de trois quarts, comme une facecam dans un coin.
    # Haar en secours, si le modèle n'est pas installé (tests hors Docker).
    yunet = cv2.FaceDetectorYN.create(str(YUNET), "", (320, 320), 0.6) if YUNET.is_file() else None
    haar = None if yunet else cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    capture = cv2.VideoCapture(str(video))
    times = sorted({*(float(t) for t in range(int(duration) + 1)), *(c + 0.1 for c in cuts if c + 0.1 < duration)})
    points = []
    for t in times:
        capture.set(cv2.CAP_PROP_POS_MSEC, (start + t) * 1000)
        ok, frame = capture.read()
        center = None
        if ok:
            width = frame.shape[1]
            if yunet:
                yunet.setInputSize((width, frame.shape[0]))
                _, faces = yunet.detect(frame)
                faces = [] if faces is None else [f[:4] for f in faces]
            else:
                faces = haar.detectMultiScale(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), 1.1, 5, minSize=(40, 40))
            if len(faces):
                x, _, w, _ = max(faces, key=lambda f: f[2] * f[3])
                center = float(x + w / 2) / width
        points.append((t, center))
        on_progress(t / max(duration, 1))
    capture.release()
    return points


def render(conn, job):
    """Produit un clip vertical à partir des réglages de Clip.edit (voir web/lib/edit.ts)."""
    check_disk()
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

    # Voix isolée : sert au son du clip et à la transcription (plus juste sans la musique du jeu).
    voice_only = None
    if edit.get("voiceOnly"):
        progress(2)
        if separate_voice(source, start, duration, folder / "voice_only.wav"):
            voice_only = folder / "voice_only.wav"
        progress(20)
    base = 20 if voice_only else 0

    # Mots : ceux corrigés par l'utilisateur, sinon une transcription si un réglage en a besoin.
    custom = bool(edit.get("customWords")) and clip["words"] is not None
    words, language, zooms = (clip["words"], clip["language"] or "fr", []) if custom else ([], "fr", [])
    need_words = not custom and (edit.get("subtitles") or edit.get("voice") or edit.get("cutSilences"))
    if need_words or edit.get("zoomPunch"):
        audio = folder / "audio.wav"
        cut = ["-i", str(voice_only)] if voice_only else ["-ss", f"{start:.3f}", "-t", f"{duration:.3f}", "-i", str(source)]
        extracted = subprocess.run(
            ["ffmpeg", "-y", *cut, "-vn", "-ac", "1", "-ar", "16000", "-loglevel", "error", str(audio)],
            capture_output=True,
        )
        if extracted.returncode == 0:  # sinon : pas de piste audio
            if need_words:
                words, language = transcribe(audio, lambda f: progress(base + f * (40 - base)))
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
        proxy = DATA / clip["proxyPath"]
        try:
            cuts = scene_cuts(proxy, start, duration)
        except Exception:  # le suivi marche aussi sans : le cadre glisse au lieu de sauter
            traceback.print_exc()
            cuts = []
        points = smooth(track_face(proxy, start, duration, lambda f: progress(40 + f * 15), cuts), cuts=cuts)
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
            build_ass(timed if subtitles else [], edit.get("subStyle"), hook, watermark, out_duration,
                      hook_full=bool(edit.get("hookFull"))), encoding="utf-8")
    if subtitles:
        (folder / "clip.srt").write_text(build_srt(timed), encoding="utf-8")

    voice = voice_track(timed, language, out_duration, folder) if edit.get("voice") and words else None
    music = DATA / clip["userId"] / "music" / Path(edit.get("music") or "-").name
    stack, stack_start = None, 0.0
    if edit.get("stackSourceId") and edit.get("crop") != "split":
        row = conn.execute('SELECT "filePath", duration FROM "Source" WHERE id = %s AND "userId" = %s AND status = %s',
                           [edit["stackSourceId"], clip["userId"], "ready"]).fetchone()
        if row is None:
            raise Fatal("La vidéo secondaire n'existe plus. Choisis-en une autre.")
        stack = str(DATA / row["filePath"])
        # Parties d'une même vidéo : chacune reprend la vidéo secondaire là où le temps de la source l'amène.
        stack_start = clip["start"] % row["duration"] if row["duration"] else 0
    has_audio = bool(subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", str(source)],
        capture_output=True, text=True,
    ).stdout.strip())

    output = folder / "clip.mp4"
    cmd = render_cmd(source, output, start, duration, (w, h), fps, edit, points,
                     ass="subs.ass" if has_ass else None, keep=keep, zooms=zooms, voice=voice,
                     music=str(music) if music.is_file() else None, stack=stack, stack_start=stack_start,
                     source_audio=has_audio, audio=voice_only.name if voice_only else None)
    # cwd = dossier du clip : le filtre `ass` reçoit un simple nom de fichier, sans caractères à échapper.
    run_ffmpeg(cmd, out_duration, progress, 55, 100, cwd=folder)
    (folder / "voice.wav").unlink(missing_ok=True)
    (folder / "voice_only.wav").unlink(missing_ok=True)
    subprocess.run(thumb_cmd("clip.mp4", "thumb.jpg", out_duration / 3), cwd=folder, capture_output=True)

    updated = conn.execute(
        'UPDATE "Clip" SET status = %s, words = %s, language = %s, "outputPath" = %s, "srtPath" = %s, "sizeBytes" = %s, error = NULL WHERE id = %s',
        ["rendered", Jsonb(words), language, output.relative_to(DATA).as_posix(),
         (folder / "clip.srt").relative_to(DATA).as_posix() if subtitles else None, output.stat().st_size, clip["id"]],
    )
    if updated.rowcount == 0:  # clip supprimé pendant le rendu
        shutil.rmtree(folder, ignore_errors=True)


def audio_per_second(file: Path, duration: float, on_progress) -> list[float]:
    """Volume (RMS) de chaque seconde de la source, lu au fil de l'eau : rien n'est écrit sur le disque."""
    import numpy as np

    process = subprocess.Popen(
        ["ffmpeg", "-loglevel", "error", "-i", str(file), "-vn", "-ac", "1", "-ar", "8000", "-f", "s16le", "-"],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
    )
    out = []
    while chunk := process.stdout.read(16000):  # une seconde : 8000 échantillons de 2 octets
        samples = np.frombuffer(chunk[:len(chunk) // 2 * 2], np.int16).astype(np.float32) / 32768
        out.append(float(np.sqrt(np.mean(samples ** 2))) if len(samples) else 0.0)
        if len(out) % 60 == 0 and duration:
            on_progress(len(out) / duration)
    process.wait()
    return out


def youtube_heatmap(url: str) -> list[tuple[float, float, float]]:
    """Courbe « Most replayed » de YouTube : (début, fin, valeur). Vide si YouTube n'en fournit pas."""
    with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True, "noplaylist": True}) as ydl:
        info = ydl.extract_info(url, download=False)
    return [(h["start_time"], h["end_time"], h["value"]) for h in info.get("heatmap") or []]


def http_json(url: str, params: dict | None = None, headers: dict | None = None, post: bool = False) -> dict:
    query = urllib.parse.urlencode(params or {})
    target = url if post or not query else f"{url}?{query}"
    request = urllib.request.Request(target, data=query.encode() if post else None, headers=headers or {})
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.load(response)


def twitch_configured() -> bool:
    return bool(os.environ.get("TWITCH_CLIENT_ID") and os.environ.get("TWITCH_CLIENT_SECRET"))


_twitch_token = {"value": "", "expires": 0.0}


def helix(path: str, params: dict) -> list[dict]:
    """Appel à l'API Twitch Helix avec un jeton d'application, gardé jusqu'à son expiration."""
    client_id = os.environ["TWITCH_CLIENT_ID"]
    if time.time() > _twitch_token["expires"]:
        token = http_json("https://id.twitch.tv/oauth2/token", {
            "client_id": client_id, "client_secret": os.environ["TWITCH_CLIENT_SECRET"], "grant_type": "client_credentials",
        }, post=True)
        _twitch_token.update(value=token["access_token"], expires=time.time() + token["expires_in"] - 300)
    return http_json(f"https://api.twitch.tv/helix/{path}", params, {"Client-Id": client_id, "Authorization": f"Bearer {_twitch_token['value']}"})["data"]


def twitch_clips(url: str) -> list[tuple[float, float, float]] | None:
    """Clips créés par les viewers sur une VOD Twitch, via l'API officielle Helix : (début, fin, poids).

    None si TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET ne sont pas configurés ou si l'URL n'est pas une VOD.
    """
    vod = re.search(r"/videos/(\d+)", url)
    if not twitch_configured() or not vod:
        return None
    videos = helix("videos", {"id": vod.group(1)})
    if not videos:
        return []
    created = datetime.fromisoformat(videos[0]["created_at"].replace("Z", "+00:00"))
    # Les clips sont filtrés par date de création : on prend la semaine qui suit le début du live.
    clips = helix("clips", {
        "broadcaster_id": videos[0]["user_id"], "first": 100,
        "started_at": created.strftime("%Y-%m-%dT%H:%M:%SZ"), "ended_at": (created + timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ"),
    })
    return [
        (c["vod_offset"], c["vod_offset"] + c["duration"], math.log1p(c["view_count"]))
        for c in clips if c.get("video_id") == vod.group(1) and c.get("vod_offset") is not None
    ]


def transcribe_source(file: Path, duration: float, folder: Path, on_progress) -> list[tuple[float, str]]:
    """Transcrit toute la source par morceaux de 10 minutes : [(instant, phrase)]. Mémoire constante, même sur 8 h."""
    lines, step, wav = [], 600, folder / "analyse.wav"
    for start in range(0, math.ceil(duration), step):
        extracted = subprocess.run(
            ["ffmpeg", "-y", "-ss", str(start), "-t", str(step), "-i", str(file), "-vn", "-ac", "1", "-ar", "16000", "-loglevel", "error", str(wav)],
            capture_output=True,
        )
        if extracted.returncode != 0:  # pas de piste audio
            break
        length = min(step, duration - start)
        words, _ = transcribe(wav, lambda f: on_progress((start + f * length) / duration))
        lines += [(round(start + t, 1), text) for t, text in speech_segments(words)]
    wav.unlink(missing_ok=True)
    return lines


MOMENTS_PROMPT = """Tu repères les meilleurs moments d'un live ou d'une vidéo pour en faire des clips courts (TikTok, Reels, Shorts).

Tu reçois une tranche du transcript. Chaque ligne commence par l'instant où elle est dite, en secondes depuis le début de la vidéo, entre crochets.

Propose au plus 5 moments qui tiendraient seuls devant quelqu'un qui n'a pas vu le reste : blague, clash, annonce, moment émotionnel, réaction forte, anecdote qui a une chute. Si rien ne s'y prête, renvoie une liste vide : mieux vaut aucun moment qu'un moment faible.

Pour chaque moment :
- start et end : en secondes, sur la même échelle que le transcript. Commence juste avant la mise en place et termine juste après la chute. Vise 20 à 90 secondes.
- title : un titre court et accrocheur, dans la langue du transcript.
- reason : une phrase qui dit pourquoi ce moment marche.
- category : blague, clash, annonce, emotion ou autre.
- score : de 0 à 100, ton estimation de son potentiel en clip. Indicatif, sois sévère."""

MOMENTS_SCHEMA = {
    "type": "object",
    "properties": {"moments": {"type": "array", "items": {
        "type": "object",
        "properties": {
            "start": {"type": "integer"}, "end": {"type": "integer"}, "title": {"type": "string"}, "reason": {"type": "string"},
            "category": {"type": "string", "enum": ["blague", "clash", "annonce", "emotion", "autre"]}, "score": {"type": "integer"},
        },
        "required": ["start", "end", "title", "reason", "category", "score"], "additionalProperties": False,
    }}},
    "required": ["moments"], "additionalProperties": False,
}


def uses_subscription(user: dict) -> bool:
    """Mode abonnement : seulement le compte du propriétaire de l'instance, jamais ceux des autres utilisateurs."""
    owner = (os.environ.get("SUBSCRIPTION_EMAIL") or "").strip().lower()
    return bool(os.environ.get("CLAUDE_CODE_OAUTH_TOKEN")) and bool(owner) and user["email"] == owner


def claude_cli(system: str, prompt: str, schema: dict) -> tuple[dict | None, int, int]:
    """Un appel à Claude par Claude Code (`claude -p`), payé par l'abonnement du jeton CLAUDE_CODE_OAUTH_TOKEN."""
    # Une clé API dans l'environnement passerait avant le jeton d'abonnement.
    env = {k: v for k, v in os.environ.items() if k not in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN")}
    try:
        done = subprocess.run(
            ["claude", "-p", "--output-format", "json", "--json-schema", json.dumps(schema), "--model", CLAUDE_MODEL,
             "--system-prompt", system, "--tools", "", "--no-session-persistence"],
            input=prompt, capture_output=True, text=True, encoding="utf-8", timeout=900, env=env, cwd=tempfile.gettempdir(),
        )
    except FileNotFoundError:
        raise Fatal("Claude Code n'est pas installé dans le worker : le mode abonnement ne peut pas tourner.")
    except subprocess.TimeoutExpired:
        raise RuntimeError("Claude Code n'a pas répondu en 15 minutes. Nouvelle tentative plus tard.")
    data, tokens_in, tokens_out, error = cli_answer(done.stdout)
    if error:
        raise Fatal(f"Claude Code (abonnement) a refusé : {error}")
    return data, tokens_in, tokens_out


def claude_moments(conn, user: dict, transcript: list[tuple[float, str]], duration: float, on_progress, notes: list[str]) -> list[dict]:
    """Fait lire le transcript à Claude, tranche par tranche, avec la clé de l'utilisateur ou l'abonnement du propriétaire. Chaque appel est noté dans Usage."""
    import anthropic

    subscription = uses_subscription(user)
    if not subscription and not user["keyEncrypted"]:
        raise Fatal("Aucune clé API Claude sur ce compte. Ajoute-la dans Compte, puis relance l'analyse.")
    client = None if subscription else anthropic.Anthropic(api_key=decrypt(user["keyEncrypted"], os.environ["MASTER_KEY"]))
    parts = slices(transcript)
    moments = []
    for i, part in enumerate(parts):
        if subscription:  # pas de facture : ni budget ni coût, seulement les tokens pour mémoire
            found, tokens_in, tokens_out = claude_cli(MOMENTS_PROMPT, format_slice(part), MOMENTS_SCHEMA)
            conn.execute(
                'INSERT INTO "Usage" (id, "userId", model, "inputTokens", "outputTokens", "costUsd") VALUES (%s, %s, %s, %s, %s, 0)',
                [uuid.uuid4().hex, user["id"], CLAUDE_MODEL, tokens_in, tokens_out],
            )
            if found is None:
                notes.append(f"Claude n'a pas pu analyser la tranche qui commence à {int(part[0][0] // 60)} min.")
            else:
                moments += clean_moments(found.get("moments", []), part[0][0], min(duration, part[-1][0] + 60))
            on_progress((i + 1) / len(parts))
            continue
        spent = conn.execute(
            f'SELECT COALESCE(SUM("costUsd"), 0) AS total FROM "Usage" WHERE "userId" = %s AND "createdAt" >= date_trunc(\'month\', {NOW})', [user["id"]],
        ).fetchone()["total"]
        if spent >= user["monthlyBudgetUsd"]:
            notes.append("Budget Claude mensuel atteint : l'analyse par Claude s'est arrêtée avant la fin. Augmente-le dans Compte pour continuer.")
            break
        try:
            response = client.beta.messages.create(
                model=CLAUDE_MODEL, max_tokens=16000,
                betas=["server-side-fallback-2026-07-01"], fallbacks="default",  # si le modèle décline, l'API bascule seule sur un autre
                system=MOMENTS_PROMPT,
                messages=[{"role": "user", "content": format_slice(part)}],
                output_config={"effort": "medium", "format": {"type": "json_schema", "schema": MOMENTS_SCHEMA}},
            )
        except anthropic.AuthenticationError:
            raise Fatal("Clé Claude refusée par Anthropic. Remplace-la dans Compte, puis relance l'analyse.")
        except anthropic.PermissionDeniedError as e:
            raise Fatal(f"Anthropic refuse cette requête avec ta clé : {e.message}")
        except anthropic.BadRequestError as e:
            raise Fatal(f"Requête refusée par Anthropic : {e.message}")
        except (anthropic.RateLimitError, anthropic.APIConnectionError, anthropic.APIStatusError) as e:
            raise RuntimeError(f"Anthropic est injoignable ou limite le débit ({type(e).__name__}). Nouvelle tentative plus tard.")

        usage = response.usage
        tokens_in = usage.input_tokens + (usage.cache_creation_input_tokens or 0) + (usage.cache_read_input_tokens or 0)
        conn.execute(
            'INSERT INTO "Usage" (id, "userId", model, "inputTokens", "outputTokens", "costUsd") VALUES (%s, %s, %s, %s, %s, %s)',
            [uuid.uuid4().hex, user["id"], response.model, tokens_in, usage.output_tokens, cost_usd(response.model, tokens_in, usage.output_tokens)],
        )
        if response.stop_reason in ("refusal", "max_tokens"):
            notes.append(f"Claude n'a pas pu analyser la tranche qui commence à {int(part[0][0] // 60)} min.")
        else:
            text = next((b.text for b in response.content if b.type == "text"), "{}")
            try:
                found = json.loads(text).get("moments", [])
            except (json.JSONDecodeError, AttributeError):
                found = []
            moments += clean_moments(found, part[0][0], min(duration, part[-1][0] + 60))
        on_progress((i + 1) / len(parts))
    return moments


def analyze(conn, job):
    """Détecte les meilleurs moments d'une source : signaux, score par tranche de 10 s, clips candidats."""
    src = conn.execute('SELECT * FROM "Source" WHERE id = %s AND status = %s', [job["payload"]["sourceId"], "ready"]).fetchone()
    if src is None:  # supprimée entre-temps
        return
    progress = make_progress(conn, job)
    file, duration = DATA / src["filePath"], src["duration"] or 0
    use_claude = bool(job["payload"].get("claude"))
    buckets = math.ceil(duration / BUCKET)
    notes: list[str] = []
    signals: dict[str, list[float]] = {}

    per_second = audio_per_second(file, duration, lambda f: progress(f * (10 if use_claude else 90)))
    if per_second:
        signals["audio"] = normalize(bucket_mean(per_second))
    else:
        notes.append("Pas de piste audio : aucun signal sonore.")

    if src["kind"] == "youtube" and src["url"]:
        try:
            heat = youtube_heatmap(src["url"])
        except Exception:  # signal facultatif : une panne de YouTube ne doit pas faire échouer l'analyse
            heat = []
        if heat:
            signals["heatmap"] = normalize(spread(heat, buckets))
        else:
            notes.append("YouTube ne fournit pas de courbe « Most replayed » pour cette vidéo (trop récente ou pas assez vue).")
    if src["kind"] in ("twitch", "kick"):
        notes.append("Twitch et Kick n'exposent pas de vraie courbe des moments les plus regardés : le score est une approximation.")
    if src["kind"] == "twitch" and src["url"]:
        try:
            clips = twitch_clips(src["url"])
        except Exception:
            clips = None
            notes.append("L'API Twitch n'a pas répondu : les clips des viewers ne sont pas pris en compte.")
        else:
            if clips is None:
                notes.append("Clips des viewers non pris en compte : TWITCH_CLIENT_ID et TWITCH_CLIENT_SECRET ne sont pas configurés sur le serveur.")
            elif clips:
                signals["clips"] = normalize(spread(clips, buckets))

    moments = []
    if use_claude:
        row = conn.execute('SELECT transcript FROM "Analysis" WHERE "sourceId" = %s', [src["id"]]).fetchone()
        transcript = row["transcript"] if row and row["transcript"] else None
        if transcript is None:
            folder = DATA / src["userId"] / "sources" / src["id"]
            transcript = transcribe_source(file, duration, folder, lambda f: progress(10 + f * 70))
            # Enregistré tout de suite : une nouvelle tentative ou une nouvelle analyse ne retranscrit pas.
            conn.execute(
                f'INSERT INTO "Analysis" ("sourceId", "userId", transcript, signals, scores, notes, "updatedAt") VALUES (%s, %s, %s, %s, %s, %s, {NOW}) '
                'ON CONFLICT ("sourceId") DO UPDATE SET transcript = EXCLUDED.transcript',
                [src["id"], src["userId"], Jsonb(transcript), Jsonb({}), Jsonb([]), Jsonb([])],
            )
        progress(80)
        if transcript:
            user = conn.execute('SELECT * FROM "User" WHERE id = %s', [src["userId"]]).fetchone()
            moments = claude_moments(conn, user, [tuple(line) for line in transcript], duration, lambda f: progress(80 + f * 18), notes)
            if moments:
                signals["claude"] = spread([(m["start"], m["end"], m["score"] / 100) for m in moments], buckets)
        else:
            notes.append("Aucune parole détectée : Claude n'a rien à lire.")

    scores = combine(signals)
    candidates = build_candidates(scores, signals, moments, duration)
    updated = conn.execute(
        f'INSERT INTO "Analysis" ("sourceId", "userId", signals, scores, notes, "updatedAt") VALUES (%s, %s, %s, %s, %s, {NOW}) '
        f'ON CONFLICT ("sourceId") DO UPDATE SET signals = EXCLUDED.signals, scores = EXCLUDED.scores, notes = EXCLUDED.notes, "updatedAt" = {NOW}',
        [src["id"], src["userId"], Jsonb({name: [round(v, 3) for v in values] for name, values in signals.items()}), Jsonb(scores), Jsonb(notes)],
    )
    conn.execute('DELETE FROM "Candidate" WHERE "sourceId" = %s', [src["id"]])
    for c in candidates:
        conn.execute(
            'INSERT INTO "Candidate" (id, "userId", "sourceId", start, "end", score, title, reason, origin) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)',
            [uuid.uuid4().hex, src["userId"], src["id"], c["start"], c["end"], c["score"], c["title"], c["reason"], c["origin"]],
        )


def account_token(conn, account: dict) -> str:
    """Jeton d'accès d'un compte de réseau, renouvelé et enregistré s'il est bientôt périmé.

    account : ligne avec accountId, provider, accessToken, refreshToken, expiresAt.
    """
    token = decrypt(account["accessToken"])
    # Instagram (jeton de 60 jours) : renouvelé dès qu'il reste moins d'une semaine.
    margin = timedelta(days=7) if account["provider"] == "instagram" else timedelta(minutes=5)
    now = datetime.now(timezone.utc).replace(tzinfo=None)  # la base stocke des dates UTC sans fuseau
    if account["expiresAt"] and account["expiresAt"] - margin < now:
        if account["provider"] == "instagram" and account["expiresAt"] < now:
            raise Fatal("L'autorisation Instagram a expiré. Reconnecte ce compte dans Réseaux.")
        token, renewal, seconds = networks.refresh(account["provider"], token, decrypt(account["refreshToken"]) if account["refreshToken"] else None)
        conn.execute(
            'UPDATE "Account" SET "accessToken" = %s, "refreshToken" = %s, "expiresAt" = %s WHERE id = %s',
            [encrypt(token), encrypt(renewal) if renewal else None, now + timedelta(seconds=seconds), account["accountId"]],
        )
    return token


def publish(conn, job):
    """Publie un clip sur un compte de réseau social, à l'heure prévue (le job attend dans la file jusque-là)."""
    pub = conn.execute(
        'SELECT p.*, c."outputPath", a.provider, a."externalId" AS "accountExternalId", a."accessToken", a."refreshToken", a."expiresAt" '
        'FROM "Publication" p JOIN "Clip" c ON c.id = p."clipId" JOIN "Account" a ON a.id = p."accountId" WHERE p.id = %s',
        [job["payload"]["publicationId"]],
    ).fetchone()
    if pub is None or pub["status"] not in ("scheduled", "publishing"):  # annulée ou déjà traitée
        return
    if not pub["outputPath"]:
        raise Fatal("Le clip n'est pas rendu. Refais son rendu, puis replanifie.")
    conn.execute('UPDATE "Publication" SET status = %s, error = NULL WHERE id = %s', ["publishing", pub["id"]])

    token = account_token(conn, pub)

    file = DATA / pub["outputPath"]
    if pub["provider"] == "youtube":
        result = networks.youtube(token, file, pub["title"], pub["description"], cover=DATA / pub["userId"] / "clips" / pub["clipId"] / "cover.jpg",
                                  kids=bool(pub["madeForKids"]))
    elif pub["provider"] == "tiktok":
        result = networks.tiktok(token, file, pub["description"], draft=bool(pub["tiktokSound"].strip()))
    else:
        url = f'{os.environ.get("APP_URL", "http://localhost:3000").rstrip("/")}/api/public/{pub["id"]}/{networks.public_token(pub["id"])}'
        result = networks.instagram(token, pub["accountExternalId"], url, pub["description"])
    status, link, note, external = result
    conn.execute('UPDATE "Publication" SET status = %s, "postUrl" = %s, note = %s, "externalId" = %s, error = NULL WHERE id = %s',
                 [status, link, note, external, pub["id"]])


def stats(conn, job):
    """Relit les vues et les « J'aime » des posts publiés d'un utilisateur, là où l'API du réseau le permet."""
    rows = conn.execute(
        'SELECT p.id, p."externalId", a.id AS "accountId", a.provider, a."accessToken", a."refreshToken", a."expiresAt" '
        'FROM "Publication" p JOIN "Account" a ON a.id = p."accountId" '
        "WHERE p.\"userId\" = %s AND p.status = 'published' AND p.\"externalId\" IS NOT NULL AND a.provider IN ('youtube', 'instagram')",
        [job["userId"]],
    ).fetchall()
    accounts: dict[str, list[dict]] = {}
    for row in rows:
        accounts.setdefault(row["accountId"], []).append(row)
    for posts in accounts.values():
        try:  # un compte déconnecté ou en panne ne bloque pas les autres
            token = account_token(conn, posts[0])
            if posts[0]["provider"] == "youtube":
                found = {}
                for i in range(0, len(posts), 50):
                    found.update(networks.youtube_stats(token, [p["externalId"] for p in posts[i:i + 50]]))
            else:
                found = {p["externalId"]: networks.instagram_stats(token, p["externalId"]) for p in posts}
        except Exception:
            traceback.print_exc()
            continue
        for post in posts:
            if post["externalId"] in found:
                views, likes = found[post["externalId"]]
                conn.execute(f'UPDATE "Publication" SET views = %s, likes = %s, "statsAt" = {NOW} WHERE id = %s', [views, likes, post["id"]])


def purge(conn):
    """Supprime les fichiers des sources plus vieilles que le délai choisi par leur propriétaire. Les clips rendus restent."""
    old = conn.execute(
        f'''SELECT s.id, s."userId" FROM "Source" s JOIN "User" u ON u.id = s."userId"
        WHERE u."purgeDays" IS NOT NULL AND s.status = 'ready' AND s."createdAt" < {NOW} - u."purgeDays" * interval '1 day'
          AND NOT EXISTS (
            SELECT 1 FROM "Job" j WHERE j.status IN ('queued', 'running') AND j.type <> 'publish'
              AND (j."sourceId" = s.id OR j."clipId" IN (SELECT c.id FROM "Clip" c WHERE c."sourceId" = s.id))
          )'''
    ).fetchall()
    for source in old:
        shutil.rmtree(DATA / source["userId"] / "sources" / source["id"], ignore_errors=True)
        conn.execute('UPDATE "Source" SET status = %s, "filePath" = NULL, "proxyPath" = NULL, "sizeBytes" = 0 WHERE id = %s', ["purged", source["id"]])
        print(f"Source {source['id']} purgée.", flush=True)
    # Envois abandonnés depuis plus d'un jour : ils comptent dans le quota tant qu'ils existent.
    for part in DATA.glob("*/uploads/*.part"):
        if time.time() - part.stat().st_mtime > 24 * 3600:
            part.unlink(missing_ok=True)


HANDLERS = {"ingest": ingest, "render": render, "analyze": analyze, "publish": publish, "stats": stats}


RECO_KEEP = 30  # clips gardés par niche et par relevé
PERIOD_DAYS = {"day": 1, "week": 7}


def utc(text: str) -> datetime:
    """Date ISO en UTC sans fuseau, comme les colonnes timestamp de Prisma."""
    return datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(timezone.utc).replace(tzinfo=None)


def niche_clips(niche: dict) -> list[dict]:
    """Clips les plus vus d'une catégorie Twitch ou Kick sur la période de la niche."""
    if niche["platform"] == "twitch":
        if not twitch_configured():
            raise Fatal("Twitch n'est pas encore configuré sur Hooklip.")
        since = datetime.now(timezone.utc) - timedelta(days=PERIOD_DAYS.get(niche["period"], 1))
        # Helix renvoie les clips de la période les plus vus d'abord ; la langue est celle de la chaîne.
        clips = helix("clips", {"game_id": niche["categoryId"], "first": 100, "started_at": since.strftime("%Y-%m-%dT%H:%M:%SZ")})
        return [{
            "externalId": c["id"], "url": c["url"], "title": c["title"], "channel": c["broadcaster_name"], "views": c["view_count"],
            "seconds": c["duration"], "thumbnailUrl": c["thumbnail_url"], "language": c.get("language") or "", "clipCreatedAt": utc(c["created_at"]),
        } for c in clips if not niche["language"] or c.get("language") == niche["language"]]

    # shortcut: API non documentée du site Kick. L'API officielle n'expose pas les clips.
    slug = urllib.parse.quote(niche["categoryId"])
    data = http_json(f"https://kick.com/api/v2/categories/{slug}/clips", {"sort": "view", "time": niche["period"]},
                     {"User-Agent": "Mozilla/5.0", "Accept": "application/json"})
    return [{
        "externalId": c["id"], "url": f'https://kick.com/{c["channel"]["slug"]}/clips/{c["id"]}', "title": c["title"],
        "channel": c["channel"]["username"], "views": c.get("view_count") or c.get("views") or 0, "seconds": c["duration"],
        "thumbnailUrl": c.get("thumbnail_url") or "", "language": "", "clipCreatedAt": utc(c["created_at"]),
    } for c in data.get("clips", []) if c.get("privacy", "public") == "public" and c.get("channel")]


def recommend(conn):
    """Relève les niches dont le dernier passage date de plus de `everyHours` heures."""
    due = conn.execute(
        f'SELECT * FROM "Niche" WHERE "fetchedAt" IS NULL OR "fetchedAt" < {NOW} - "everyHours" * interval \'1 hour\' '
        'ORDER BY "fetchedAt" NULLS FIRST LIMIT 5'
    ).fetchall()
    for niche in due:
        try:
            clips = sorted(niche_clips(niche), key=lambda c: -c["views"])[:RECO_KEEP]
            error = None
        except Fatal as e:
            clips, error = [], str(e)
        except Exception as e:
            traceback.print_exc()
            clips, error = [], f"{niche['platform'].capitalize()} n'a pas répondu ({type(e).__name__}). Nouvel essai au prochain relevé."
        for c in clips:
            conn.execute(
                'INSERT INTO "Recommendation" (id, "userId", "nicheId", platform, "externalId", url, title, channel, views, seconds, '
                '"thumbnailUrl", language, "clipCreatedAt", "fetchedAt") VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, ' + NOW + ') '
                'ON CONFLICT ("userId", platform, "externalId") DO UPDATE SET views = EXCLUDED.views, title = EXCLUDED.title, '
                '"fetchedAt" = EXCLUDED."fetchedAt"',
                [uuid.uuid4().hex, niche["userId"], niche["id"], niche["platform"], c["externalId"], c["url"], c["title"][:300],
                 c["channel"][:100], int(c["views"]), float(c["seconds"]), c["thumbnailUrl"], c["language"], c["clipCreatedAt"]],
            )
        conn.execute(f'UPDATE "Niche" SET "fetchedAt" = {NOW}, error = %s WHERE id = %s', [error, niche["id"]])
        print(f"Niche {niche['id']} : {error or f'{len(clips)} clips.'}", flush=True)
    # Un clip qui n'est plus remonté depuis une semaine n'est plus d'actualité (les importés restent).
    conn.execute(f'DELETE FROM "Recommendation" WHERE status <> \'imported\' AND "fetchedAt" < {NOW} - interval \'7 days\'')


def run(conn, job):
    try:
        HANDLERS[job["type"]](conn, job)
        conn.execute(f'UPDATE "Job" SET status = %s, progress = 100, error = NULL, "updatedAt" = {NOW} WHERE id = %s', ["done", job["id"]])
    except Exception as e:
        if isinstance(e, networks.Refused):
            e = Fatal(str(e))
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
        if job["sourceId"] and job["type"] == "ingest":
            conn.execute('UPDATE "Source" SET status = %s, error = %s WHERE id = %s', ["error", message, job["sourceId"]])
            # Pas de fichiers orphelins qui occupent le disque sans compter dans le quota.
            src = conn.execute('SELECT "userId" FROM "Source" WHERE id = %s', [job["sourceId"]]).fetchone()
            if src:
                shutil.rmtree(DATA / src["userId"] / "sources" / job["sourceId"], ignore_errors=True)
        if job["type"] == "publish":
            conn.execute('UPDATE "Publication" SET status = %s, error = %s WHERE id = %s', ["failed", message, job["payload"].get("publicationId")])
            try:  # prévenir par email ; un envoi raté ne doit rien casser d'autre
                user = conn.execute('SELECT email FROM "User" WHERE id = %s', [job["userId"]]).fetchone()
                app = os.environ.get("APP_URL", "http://localhost:3000").rstrip("/")
                networks.send_mail(user["email"], "Hooklip : une publication a échoué",
                                   f"Une publication planifiée n'a pas pu partir.\n\nRaison : {message}\n\n"
                                   f"Tu peux la relancer ou télécharger le clip pour le publier à la main : {app}/app/calendrier\n")
            except Exception:
                traceback.print_exc()
        if job["clipId"] and job["type"] == "render":
            conn.execute('UPDATE "Clip" SET status = %s, error = %s WHERE id = %s', ["error", message, job["clipId"]])


def main():
    with psycopg.connect(os.environ["DATABASE_URL"], autocommit=True, row_factory=dict_row) as conn:
        # shortcut: suppose un seul worker. Avec plusieurs, ne relancer que les jobs
        # dont "updatedAt" est vieux (worker mort), pas tous les jobs en cours.
        conn.execute("UPDATE \"Job\" SET status = 'queued' WHERE status = 'running'")
        print("Worker prêt.", flush=True)
        last_purge = last_reco = 0.0
        while True:
            # Chaque minute : une niche est-elle due ? « Actualiser » dans le site remet fetchedAt à vide.
            if time.time() - last_reco > 60:
                last_reco = time.time()
                try:
                    recommend(conn)
                except Exception:
                    traceback.print_exc()
            if time.time() - last_purge > float(os.environ.get("PURGE_EVERY_SECONDS", "600")):
                last_purge = time.time()
                try:
                    purge(conn)
                except Exception:
                    traceback.print_exc()
            job = conn.execute(CLAIM).fetchone()
            if job:
                print(f"Job {job['id']} ({job['type']}), tentative {job['attempts']}", flush=True)
                run(conn, job)
            else:
                time.sleep(1)


if __name__ == "__main__":
    main()
