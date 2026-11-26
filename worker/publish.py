"""Publication d'un clip sur YouTube, TikTok, Instagram ou X, par leurs API officielles.

Écrit d'après les documentations officielles de novembre 2026 (adresses dans le README).
Chaque fonction de publication renvoie (statut, lien du post ou None, note ou None, identifiant du post ou None).
"""

import hashlib
import hmac
import os
import time
from pathlib import Path

import requests

TIMEOUT = 60
MB = 1024 * 1024


class Refused(Exception):
    """Le réseau refuse pour de bon (quota, compte, vidéo) : réessayer ne sert à rien. Message montré à l'utilisateur."""


def api(host: str, path: str) -> str:
    """URL d'une API de réseau. PLATFORM_BASE_URL (tests seulement) redirige tous les appels vers un faux serveur."""
    base = os.environ.get("PLATFORM_BASE_URL")
    return (f"{base}/{host}" if base else f"https://{host}") + path


def public_token(publication_id: str) -> str:
    """Même calcul que publicToken dans web/lib/oauth.ts."""
    return hmac.new(os.environ.get("SERVER_SALT", "").encode(), f"publication:{publication_id}".encode(), hashlib.sha256).hexdigest()


def check(response: requests.Response, network: str) -> requests.Response:
    """Trie les réponses : 5xx et 429 se réessaient, les autres erreurs sont définitives."""
    if response.status_code >= 500 or response.status_code == 429:
        raise RuntimeError(f"{network} est indisponible ou limite le débit ({response.status_code}). Nouvelle tentative plus tard.")
    if response.status_code == 401:
        raise Refused(f"{network} ne reconnaît plus l'autorisation. Reconnecte ce compte dans Réseaux.")
    if response.status_code >= 400:
        raise Refused(f"{network} a refusé la publication ({response.status_code}) : {response.text[:300]}")
    return response


def refresh(provider: str, access_token: str, refresh_token: str | None) -> tuple[str, str | None, float]:
    """Renouvelle le jeton d'accès. Renvoie (jeton d'accès, jeton de renouvellement, durée de validité en secondes)."""
    if provider == "youtube":
        data = check(requests.post(api("oauth2.googleapis.com", "/token"), timeout=TIMEOUT, data={
            "client_id": os.environ.get("GOOGLE_CLIENT_ID"), "client_secret": os.environ.get("GOOGLE_CLIENT_SECRET"),
            "grant_type": "refresh_token", "refresh_token": refresh_token,
        }), "Google").json()
        return data["access_token"], refresh_token, data.get("expires_in", 3600)
    if provider == "tiktok":
        data = check(requests.post(api("open.tiktokapis.com", "/v2/oauth/token/"), timeout=TIMEOUT, data={
            "client_key": os.environ.get("TIKTOK_CLIENT_KEY"), "client_secret": os.environ.get("TIKTOK_CLIENT_SECRET"),
            "grant_type": "refresh_token", "refresh_token": refresh_token,
        }), "TikTok").json()
        if "access_token" not in data:
            raise Refused("TikTok ne reconnaît plus l'autorisation. Reconnecte ce compte dans Réseaux.")
        # TikTok change aussi le jeton de renouvellement à chaque fois : l'ancien devient inutilisable.
        return data["access_token"], data.get("refresh_token", refresh_token), data.get("expires_in", 7200)
    if provider == "x":
        data = check(requests.post(api("api.x.com", "/2/oauth2/token"), timeout=TIMEOUT,
                                   auth=(os.environ.get("X_CLIENT_ID", ""), os.environ.get("X_CLIENT_SECRET", "")),
                                   data={"grant_type": "refresh_token", "refresh_token": refresh_token,
                                         "client_id": os.environ.get("X_CLIENT_ID")}), "X").json()
        # Comme TikTok, X remplace le jeton de renouvellement à chaque usage.
        return data["access_token"], data.get("refresh_token", refresh_token), data.get("expires_in", 7200)
    data = check(requests.get(api("graph.instagram.com", "/refresh_access_token"), timeout=TIMEOUT,
                              params={"grant_type": "ig_refresh_token", "access_token": access_token}), "Instagram").json()
    return data["access_token"], None, data.get("expires_in", 5184000)


def youtube(token: str, file: Path, title: str, description: str, cover: Path | None = None, kids: bool = False):
    """Envoi en deux temps : ouverture d'une session, puis le fichier. Une vidéo verticale courte devient un Short.
    `cover` : miniature choisie par l'utilisateur, envoyée ensuite ; son refus ne fait pas échouer la publication."""
    size = file.stat().st_size
    session = requests.post(
        api("www.googleapis.com", "/upload/youtube/v3/videos"), timeout=TIMEOUT,
        params={"uploadType": "resumable", "part": "snippet,status"},
        headers={"Authorization": f"Bearer {token}", "X-Upload-Content-Length": str(size), "X-Upload-Content-Type": "video/mp4"},
        json={
            # Limites YouTube : titre de 100 caractères, description de 5 000 octets, ni < ni >.
            "snippet": {"title": clean(title)[:100] or "Clip", "description": clip_bytes(clean(description), 5000), "categoryId": "22"},
            "status": {"privacyStatus": "public", "selfDeclaredMadeForKids": kids},
        },
    )
    if session.status_code == 403 and "quota" in session.text.lower():
        raise Refused("Quota YouTube du jour atteint. Réessaie demain.")
    upload_url = check(session, "YouTube").headers["Location"]
    with file.open("rb") as f:
        done = check(requests.put(upload_url, data=f, timeout=1800, headers={
            "Authorization": f"Bearer {token}", "Content-Length": str(size), "Content-Type": "video/mp4"}), "YouTube")
    video = done.json()["id"]
    note = None
    if cover and cover.exists():
        sent = requests.post(api("www.googleapis.com", "/upload/youtube/v3/thumbnails/set"), timeout=TIMEOUT, params={"videoId": video},
                             headers={"Authorization": f"Bearer {token}", "Content-Type": "image/jpeg"}, data=cover.read_bytes())
        if not sent.ok:
            note = "Vidéo publiée, mais YouTube a refusé la miniature. Les miniatures personnalisées demandent une chaîne validée par téléphone."
    return "published", f"https://www.youtube.com/shorts/{video}", note, video


def clean(text: str) -> str:
    return text.replace("<", "").replace(">", "").strip()


def clip_bytes(text: str, limit: int) -> str:
    return text.encode()[:limit].decode(errors="ignore")


def tiktok_chunks(size: int) -> tuple[int, int]:
    """(taille d'un morceau, nombre de morceaux) selon les règles TikTok.

    Jusqu'à 64 Mo : un seul envoi. Au-delà : morceaux de 10 Mo, le dernier absorbe le reste (nombre arrondi vers le bas).
    """
    if size <= 64 * MB:
        return size, 1
    return 10 * MB, size // (10 * MB)


TIKTOK_ERRORS = {
    "unaudited_client_can_only_post_to_private_accounts": "L'application TikTok n'est pas encore validée par TikTok : elle ne peut publier que sur un compte privé.",
    "spam_risk_too_many_posts": "TikTok refuse : trop de publications aujourd'hui sur ce compte.",
    "spam_risk_too_many_pending_share": "TikTok refuse : 5 brouillons attendent déjà dans la boîte de réception de ce compte.",
    "reached_active_user_cap": "TikTok refuse : l'application a atteint son plafond d'utilisateurs du jour.",
    "scope_not_authorized": "Ce compte TikTok n'a pas donné le droit de publier. Reconnecte-le dans Réseaux.",
}


def tiktok_call(token: str, path: str, body: dict | None = None) -> dict:
    response = requests.post(api("open.tiktokapis.com", path), timeout=TIMEOUT, json=body or {},
                             headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json; charset=UTF-8"})
    try:
        payload = response.json()
    except ValueError:
        payload = {}
    code = (payload.get("error") or {}).get("code", "ok")
    if code in TIKTOK_ERRORS:
        raise Refused(TIKTOK_ERRORS[code])
    if code == "rate_limit_exceeded":
        raise RuntimeError("TikTok limite le débit. Nouvelle tentative plus tard.")
    check(response, "TikTok")
    if code != "ok":
        raise Refused(f"TikTok a refusé : {code} {(payload.get('error') or {}).get('message', '')}".strip())
    return payload.get("data") or {}


def tiktok(token: str, file: Path, caption: str, draft: bool):
    """Publication directe, ou envoi en brouillon dans la boîte de réception (l'utilisateur termine dans l'appli)."""
    size = file.stat().st_size
    chunk, count = tiktok_chunks(size)
    source = {"source": "FILE_UPLOAD", "video_size": size, "chunk_size": chunk, "total_chunk_count": count}
    note = username = None
    if draft:
        start = tiktok_call(token, "/v2/post/publish/inbox/video/init/", {"source_info": source})
    else:
        creator = tiktok_call(token, "/v2/post/publish/creator_info/query/")
        username = creator.get("creator_username")
        options = creator.get("privacy_level_options") or ["SELF_ONLY"]
        privacy = "PUBLIC_TO_EVERYONE" if "PUBLIC_TO_EVERYONE" in options else options[0]
        if privacy != "PUBLIC_TO_EVERYONE":
            note = "Publié en visibilité restreinte : TikTok n'autorise pas le mode public pour ce compte ou cette application."
        start = tiktok_call(token, "/v2/post/publish/video/init/", {"post_info": {"title": caption[:2200], "privacy_level": privacy}, "source_info": source})

    with file.open("rb") as f:
        for i in range(count):
            first = i * chunk
            data = f.read(chunk) if i < count - 1 else f.read()  # le dernier morceau prend tout ce qui reste
            sent = requests.put(start["upload_url"], data=data, timeout=1800, headers={
                "Content-Type": "video/mp4", "Content-Length": str(len(data)), "Content-Range": f"bytes {first}-{first + len(data) - 1}/{size}"})
            if sent.status_code not in (201, 206):
                check(sent, "TikTok")
                raise Refused(f"TikTok a refusé l'envoi de la vidéo ({sent.status_code}).")

    # Le fichier est parti : à partir d'ici on ne relance plus, pour ne pas publier deux fois.
    for _ in range(24):
        try:
            state = tiktok_call(token, "/v2/post/publish/status/fetch/", {"publish_id": start["publish_id"]})
        except RuntimeError:
            state = {}
        if state.get("status") == "FAILED":
            raise Refused(f"TikTok a rejeté la vidéo : {state.get('fail_reason', 'raison inconnue')}.")
        if state.get("status") == "SEND_TO_USER_INBOX":
            return "draft_sent", None, None, None
        if state.get("status") == "PUBLISH_COMPLETE":
            ids = state.get("publicaly_available_post_id") or []  # orthographe de la doc TikTok
            if ids and username:
                return "published", f"https://www.tiktok.com/@{username}/video/{ids[0]}", note, str(ids[0])
            return "published", None, note or "Publié. TikTok ne donne le lien qu'après sa modération.", None
        time.sleep(float(os.environ.get("POLL_SECONDS", "5")))
    return ("draft_sent" if draft else "published"), None, "Vidéo envoyée. TikTok n'avait pas fini de la traiter : vérifie dans l'appli.", None


def instagram(token: str, user_id: str, video_url: str, caption: str):
    """Reel : Instagram télécharge la vidéo depuis `video_url`, puis on publie le conteneur une fois prêt."""
    if not video_url.startswith("https://") and not os.environ.get("PLATFORM_BASE_URL"):
        raise Refused("Instagram télécharge la vidéo lui-même : le site doit être joignable en https depuis Internet (APP_URL).")
    auth = {"Authorization": f"Bearer {token}"}
    container = check(requests.post(api("graph.instagram.com", f"/v27.0/{user_id}/media"), timeout=TIMEOUT, headers=auth,
                                    data={"media_type": "REELS", "video_url": video_url, "caption": caption[:2200]}), "Instagram").json()["id"]
    for _ in range(30):  # Instagram recommande une vérification par minute, 5 minutes au plus
        status = check(requests.get(api("graph.instagram.com", f"/v27.0/{container}"), timeout=TIMEOUT, headers=auth,
                                    params={"fields": "status_code,status"}), "Instagram").json()
        if status.get("status_code") == "FINISHED":
            break
        if status.get("status_code") in ("ERROR", "EXPIRED"):
            raise Refused(f"Instagram n'a pas pu traiter la vidéo : {status.get('status', status.get('status_code'))}.")
        time.sleep(float(os.environ.get("POLL_SECONDS", "10")))
    else:
        raise RuntimeError("Instagram n'a pas fini de traiter la vidéo. Nouvelle tentative plus tard.")
    media = check(requests.post(api("graph.instagram.com", f"/v27.0/{user_id}/media_publish"), timeout=TIMEOUT, headers=auth,
                                data={"creation_id": container}), "Instagram").json()["id"]
    try:
        link = requests.get(api("graph.instagram.com", f"/v27.0/{media}"), timeout=TIMEOUT, headers=auth, params={"fields": "permalink"}).json().get("permalink")
    except (requests.RequestException, ValueError):
        link = None  # publié quand même : seul le lien manque
    return "published", link, None, media


X_CHUNK = 4 * MB


def x(token: str, file: Path, text: str):
    """Envoi de la vidéo par morceaux (API média v2), attente du traitement, puis le post avec la vidéo jointe."""
    auth = {"Authorization": f"Bearer {token}"}
    size = file.stat().st_size
    media = check(requests.post(api("api.x.com", "/2/media/upload/initialize"), timeout=TIMEOUT, headers=auth,
                                json={"media_type": "video/mp4", "total_bytes": size, "media_category": "tweet_video"}), "X").json()["data"]["id"]
    with file.open("rb") as f:
        for index in range((size + X_CHUNK - 1) // X_CHUNK):
            check(requests.post(api("api.x.com", f"/2/media/upload/{media}/append"), timeout=600, headers=auth,
                                data={"segment_index": index}, files={"media": f.read(X_CHUNK)}), "X")
    info = (check(requests.post(api("api.x.com", f"/2/media/upload/{media}/finalize"), timeout=TIMEOUT, headers=auth), "X")
            .json().get("data", {}).get("processing_info"))
    for _ in range(60):
        if not info or info.get("state") == "succeeded":
            break
        if info.get("state") == "failed":
            raise Refused(f"X n'a pas pu traiter la vidéo : {(info.get('error') or {}).get('message', 'raison inconnue')}.")
        time.sleep(float(os.environ.get("POLL_SECONDS", str(info.get("check_after_secs", 5)))))
        info = (check(requests.get(api("api.x.com", "/2/media/upload"), timeout=TIMEOUT, headers=auth,
                                   params={"command": "STATUS", "media_id": media}), "X").json().get("data", {}).get("processing_info"))
    else:
        raise RuntimeError("X n'a pas fini de traiter la vidéo. Nouvelle tentative plus tard.")
    post = check(requests.post(api("api.x.com", "/2/tweets"), timeout=TIMEOUT, headers=auth,
                               json={"text": text[:280], "media": {"media_ids": [media]}}), "X").json()["data"]["id"]
    return "published", f"https://x.com/i/web/status/{post}", None, post


def youtube_stats(token: str, ids: list[str]) -> dict[str, tuple[int | None, int | None]]:
    """Vues et mentions « J'aime » de vidéos YouTube (50 au plus par appel) : {identifiant: (vues, likes)}."""
    items = check(requests.get(api("www.googleapis.com", "/youtube/v3/videos"), timeout=TIMEOUT, headers={"Authorization": f"Bearer {token}"},
                               params={"part": "statistics", "id": ",".join(ids)}), "YouTube").json().get("items", [])
    number = lambda v: int(v) if v is not None else None
    return {i["id"]: (number(i.get("statistics", {}).get("viewCount")), number(i.get("statistics", {}).get("likeCount"))) for i in items}


def instagram_stats(token: str, media: str) -> tuple[int | None, int | None]:
    """Mentions « J'aime » d'un Reel. Les vues demandent l'API Insights, non branchée : (None, likes)."""
    data = check(requests.get(api("graph.instagram.com", f"/v27.0/{media}"), timeout=TIMEOUT, headers={"Authorization": f"Bearer {token}"},
                              params={"fields": "like_count,comments_count"}), "Instagram").json()
    return None, data.get("like_count")


def send_mail(to: str, subject: str, body: str) -> bool:
    """Envoie un email si SMTP_URL est configuré (smtp://utilisateur:motdepasse@hôte:port, ou smtps://). Sinon ne fait rien."""
    import smtplib
    from email.message import EmailMessage
    from urllib.parse import unquote, urlparse

    url = urlparse(os.environ.get("SMTP_URL") or "")
    if not url.hostname:
        return False
    message = EmailMessage()
    message["From"] = os.environ.get("MAIL_FROM") or "Hooklip <no-reply@localhost>"
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body)
    smtp_class = smtplib.SMTP_SSL if url.scheme == "smtps" else smtplib.SMTP
    with smtp_class(url.hostname, url.port or (465 if url.scheme == "smtps" else 587), timeout=20) as smtp:
        if url.scheme != "smtps" and smtp.has_extn("starttls"):
            smtp.starttls()
        if url.username:
            smtp.login(unquote(url.username), unquote(url.password or ""))
        smtp.send_message(message)
    return True
