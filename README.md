# ClipForge

Studio de clipping : importer une VOD ou une vidéo, repérer les meilleurs moments, monter des clips verticaux et les publier.

État actuel : **phase 1** (socle). Connexion par clé Claude, import par URL ou par fichier, file de jobs, bibliothèque avec progression en temps réel, page Utilisation.

## Architecture

```
web/      Next.js : interface, actions serveur, routes API, Prisma
worker/   Python : exécute les jobs (yt-dlp, FFmpeg)
postgres  données + file de jobs (table "Job")
data/     fichiers, partagés entre web et worker : data/{userId}/sources/{sourceId}/
```

- Le web crée une ligne dans `Job`. Le worker la prend (`FOR UPDATE SKIP LOCKED`), écrit sa progression dans `Job.progress`.
- Le navigateur suit la progression par SSE (`/api/events`), qui relit la base chaque seconde.
- Un seul job à la fois par utilisateur. Trois tentatives par job, puis statut `error` avec la raison.

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
docker compose run --rm worker python -m unittest -v
```

Le même vecteur de chiffrement est vérifié des deux côtés : ce que le web chiffre, le worker sait le déchiffrer.

## Sécurité

- La clé Claude n'est jamais renvoyée au navigateur. En base : un hash (HMAC-SHA256 avec `SERVER_SALT`) pour identifier le compte, et la clé chiffrée (AES-256-GCM avec `MASTER_KEY`) pour le worker.
- Session : jeton aléatoire dans un cookie httpOnly, seul son hash est en base.
- Chaque requête filtre par utilisateur ; les fichiers ne sont servis qu'à leur propriétaire.
- Connexion limitée à 5 tentatives par minute et par adresse IP.

## Limites connues (phase 1)

- L'email de récupération est enregistré, mais l'envoi du lien de récupération n'existe pas encore.
- Le coût Claude affiché reste à zéro tant que les analyses (phase 4) ne sont pas en place.
- Un seul worker. Pour en lancer plusieurs, voir le commentaire `shortcut` dans `worker/worker.py`.
- Stockage sur disque local uniquement (S3 prévu en phase 6).

## Rappel

N'importe que du contenu dont tu détiens les droits ou pour lequel tu as l'autorisation. Respecte les conditions d'utilisation des plateformes.
