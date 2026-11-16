FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
# Claude Code : sert seulement au mode abonnement (CLAUDE_CODE_OAUTH_TOKEN).
RUN npm install -g @anthropic-ai/claude-code
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build
EXPOSE 3000
# Applique les migrations au démarrage, puis lance le serveur.
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
