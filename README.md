# ClipForge

Studio de clipping : importer une VOD ou une vidéo, repérer les meilleurs moments, monter des clips verticaux et les publier.

État actuel : **phase 4**.

- Phase 1 (socle) : connexion par clé Claude, import par URL ou par fichier, file de jobs, bibliothèque avec progression en temps réel, page Utilisation.
- Phase 2 (clip de base) : découpe d'un extrait, recadrage vertical 9:16, sous-titres karaoké mot par mot, voix de synthèse en option, musique de fond, rendu 1080x1920 H.264/AAC, export SRT.
- Phase 3 (éditeur complet) : cadrage manuel par images clés, split facecam/jeu, vidéo secondaire empilée, styles de sous-titres et correction du texte, accroche, filigrane, barre de progression, zoom sur les pics sonores, coupe des silences, normalisation du volume, miniature, templates, aperçu vertical en direct.
- Phase 4 (détection) : score des meilleurs moments par tranche de 10 secondes (volume sonore, « Most replayed » de YouTube, clips des viewers Twitch, lecture du transcript par Claude), heatmap cliquable, clips candidats à charger dans l'éditeur ou à rejeter, coût Claude estimé avant et compté après.

## Architecture

```
web/      Next.js : interface, actions serveur, routes API, Prisma
worker/   Python : exécute les jobs (yt-dlp, FFmpeg, faster-whisper, OpenCV, Piper)
postgres  données + file de jobs (table "Job")
data/     fichiers, partagés entre web et worker :
          data/{userId}/sources/{sourceId}/, data/{userId}/clips/{clipId}/ et data/{userId}/music/
```

- Le web crée une ligne dans `Job`. Le worker la prend (`FOR UPDATE SKIP LOCKED`), écrit sa progression dans `Job.progress`.
- Le navigateur suit la progression par SSE (`/api/events`), qui relit la base chaque seconde.
- Un seul job à la fois par utilisateur. Trois tentatives par job, puis statut `error` avec la raison.

## Rendu d'un clip

Les réglages d'un clip sont un objet JSON (`Clip.edit`), décrit et validé dans `web/lib/edit.ts`. Le job `render` du worker les applique :

1. **Transcription** de l'extrait avec faster-whisper (modèle `small`, en local), si les sous-titres, la voix de synthèse ou la coupe des silences en ont besoin. Le modèle (environ 500 Mo) est téléchargé au premier rendu, puis gardé dans le volume Docker `models`. Pour changer de modèle : `WHISPER_MODEL=medium` dans `.env`. Si l'utilisateur a corrigé les mots à la main, ils sont repris tels quels.
2. **Cadrage**, quatre modes :
   - suivi du visage : une mesure par seconde (OpenCV), lissée pour que le cadre ne tremble pas ;
   - centre ;
   - manuel : le cadre glisse d'une image clé à la suivante ;
   - split : la zone de la facecam en haut, le jeu en bas.
   Hors split, une vidéo secondaire de la bibliothèque peut être empilée au-dessus ou en dessous (elle boucle, sans son). La part de hauteur de chaque partie est réglable.
3. **Texte incrusté** (un seul fichier ASS) : sous-titres (karaoké ou gros texte mot par mot ; police, taille, couleur, contour, position), accroche des 3 premières secondes, filigrane. Fichier SRT à part.
4. **Coupe des silences** : seules les parties parlées sont gardées (avec une petite marge) ; les sous-titres sont recalés.
5. **Zoom** sur les pics sonores : les moments les plus forts de l'extrait, un par tranche de 10 secondes au plus.
6. **Son** : voix de synthèse Piper (locale, sans clé) qui redit la transcription et remplace tout le son d'origine ; musique de fond (fichier de l'utilisateur, volume réglable, fondus, baissée quand ça parle) ; normalisation à -14 LUFS.
7. **Barre de progression**, puis **miniature** (une image du clip rendu).

Un clip rendu peut être refait : avec d'autres réglages, avec des sous-titres corrigés, ou en appliquant les réglages actuels à tous les clips de la source. Un **template** enregistre les réglages (sans les images clés, propres à un clip) pour les recharger plus tard.

La logique pure (cadre, silences, pics, texte, commandes FFmpeg) est dans `worker/render.py`, testée dans `worker/test_worker.py`. La validation des réglages est testée dans `web/lib/edit.test.ts`.

## Détection des meilleurs moments

Sur la page d'une source, « Analyser cette vidéo » lance un job `analyze`. Chaque signal disponible donne une valeur de 0 à 1 par tranche de 10 secondes ; le score (0 à 100) est leur moyenne pondérée.

| Signal | Source | Poids |
| --- | --- | --- |
| Claude | lit le transcript complet, par tranches de 25 minutes, et propose des moments avec titre, raison et note | 0,40 |
| « Most replayed » | courbe de YouTube, lue par yt-dlp quand elle existe | 0,35 |
| Clips des viewers | API officielle Twitch (Helix), si `TWITCH_CLIENT_ID` et `TWITCH_CLIENT_SECRET` sont renseignés | 0,30 |
| Volume sonore | pics de volume (cris, rires), toujours disponible | 0,20 |

- **Sans Claude** : gratuit, quelques secondes. Les candidats sont les pics du score.
- **Avec Claude** (case à cocher) : la source est d'abord transcrite en entier sur le serveur (compter à peu près sa durée), puis Claude lit le transcript avec la clé de l'utilisateur. Le coût estimé est affiché avant ; l'analyse est refusée s'il dépasse le budget mensuel restant, et s'arrête si le budget est atteint en cours de route. Chaque appel est enregistré dans `Usage` et apparaît dans Compte. Le transcript est gardé : relancer l'analyse ne retranscrit pas.
- Le modèle est `claude-opus-5-5` par défaut ; `CLAUDE_MODEL` dans `.env` permet d'en choisir un autre (`claude-sonnet-5-5`, `claude-haiku-5-5`). Les prix servant aux estimations sont dans `web/lib/cost.ts` et `worker/detect.py` : à mettre à jour si Anthropic les change.
- Twitch et Kick n'exposent pas de vraie courbe des moments les plus regardés. Le score y est une approximation, et l'interface le dit.

La logique pure (cases, normalisation, score, choix des pics, coût) est dans `worker/detect.py`, testée dans `worker/test_worker.py`.

## Lancer

Prérequis : Docker Desktop.

1. Copier `.env.example` en `.env`.
2. Remplir `MASTER_KEY` et `SERVER_SALT`. Pour générer chaque valeur :

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

3. Démarrer :

```bash
docker compose up --build
```

4. Ouvrir http://localhost:3000 et se connecter avec une clé API Claude (`sk-ant-…`).

Ne change jamais `MASTER_KEY` ni `SERVER_SALT` après la première connexion : les comptes existants deviendraient inaccessibles.

## Développer le web hors Docker

Plus rapide pour modifier l'interface (rechargement à chaud) :

```bash
docker compose up postgres worker
```

```bash
cd web && cp ../.env .env && npm install && npx prisma migrate dev && npm run dev
```

## Tests

```bash
cd web && npm test
```

```bash
docker compose run --rm --no-deps worker python -m unittest -v
```

Le même vecteur de chiffrement est vérifié des deux côtés : ce que le web chiffre, le worker sait le déchiffrer.

## Sécurité

- La clé Claude n'est jamais renvoyée au navigateur. En base : un hash (HMAC-SHA256 avec `SERVER_SALT`) pour identifier le compte, et la clé chiffrée (AES-256-GCM avec `MASTER_KEY`) pour le worker.
- Session : jeton aléatoire dans un cookie httpOnly, seul son hash est en base.
- Chaque requête filtre par utilisateur ; les fichiers ne sont servis qu'à leur propriétaire.
- Connexion limitée à 5 tentatives par minute et par adresse IP.

## Limites connues

- L'email de récupération est enregistré, mais l'envoi du lien de récupération n'existe pas encore.
- Le coût Claude affiché est une estimation calculée à partir des tokens consommés, pas la facture d'Anthropic.
- Densité du chat Twitch / Kick : pas prise en compte. Aucune API officielle ne donne le chat d'une rediffusion.
- Clips des viewers Twitch : code écrit d'après la documentation Helix, jamais exécuté contre la vraie API (il faut des identifiants d'application Twitch).
- Signal sonore : volume seulement, pas de reconnaissance des rires ou des cris.
- Un seul worker. Pour en lancer plusieurs, voir le commentaire `shortcut` dans `worker/worker.py`.
- Stockage sur disque local uniquement (S3 prévu en phase 6).
- Suivi du visage : détecteur Haar d'OpenCV, fiable sur les visages de face. Sans visage détecté, le cadre reste centré.
- Transcription sur processeur : compter environ la durée du clip. Un clip dure 180 secondes au maximum.
- Aperçu de l'éditeur : approximatif. Le suivi du visage, les zooms, la coupe des silences et le vrai texte des sous-titres ne se voient qu'au rendu.
- Split : la zone de la facecam se règle avec quatre curseurs, pas à la souris, et n'est pas détectée automatiquement.
- Coupe des silences : tout ce qui n'est pas de la parole est coupé, y compris un cri ou un rire sans mots.
- Sous-titres : pas d'emojis automatiques. La correction du texte passe par un premier rendu.
- Voix de synthèse : une voix française et une voix anglaise, choisies selon la langue détectée (français par défaut). Les mots surlignés suivent le rythme de la voix d'origine, pas exactement celui de la voix de synthèse.
- Musique : pas d'écoute avant rendu, fichiers non comptés dans le quota de stockage.
- Filigrane : texte seulement, pas de logo image. Miniature : image prise au tiers du clip, non réglable.

## Rappel

N'importe que du contenu dont tu détiens les droits ou pour lequel tu as l'autorisation. Respecte les conditions d'utilisation des plateformes.
