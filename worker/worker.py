"""Worker ClipForge : prend les jobs dans la table "Job" de Postgres et les exécute un par un."""

import os
import shutil
import subprocess
import time
import traceback
from pathlib import Path

import psycopg
import yt_dlp
from psycopg.rows import dict_row

DATA = Path(os.environ.get("DATA_DIR", "/data"))
MAX_HOURS = float(os.environ.get("MAX_SOURCE_HOURS", "8"))
MAX_ATTEMPTS = 3

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


def ingest(conn, job):
    """Télécharge la source si c'est une URL, puis mesure sa durée et crée l'aperçu."""
    src = conn.execute('SELECT * FROM "Source" WHERE id = %s', [job["payload"]["sourceId"]]).fetchone()
    if src is None:  # supprimée entre-temps
        return
    folder = DATA / src["userId"] / "sources" / src["id"]
    folder.mkdir(parents=True, exist_ok=True)

    last = -1

    def progress(percent: float):
        nonlocal last
        percent = max(0, min(99, int(percent)))
        if percent != last:
            last = percent
            conn.execute('UPDATE "Job" SET progress = %s, "updatedAt" = ' + NOW + " WHERE id = %s", [percent, job["id"]])

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
    process = subprocess.Popen(proxy_cmd(file, proxy), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    for line in process.stdout:
        if line.startswith("out_time_us=") and duration > 0:
            try:
                progress(70 + int(line.split("=")[1]) / 1e6 / duration * 30)
            except ValueError:
                pass  # "N/A" en début d'encodage
    if process.wait() != 0:
        raise Fatal("FFmpeg n'a pas pu lire cette vidéo : " + process.stderr.read()[-300:])

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


HANDLERS = {"ingest": ingest}


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
