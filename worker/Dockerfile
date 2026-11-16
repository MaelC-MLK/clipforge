FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-montserrat fonts-bebas-neue fonts-lato curl ca-certificates && rm -rf /var/lib/apt/lists/*
# yt-dlp a besoin de deno pour lire toutes les qualités YouTube.
COPY --from=denoland/deno:bin /deno /usr/local/bin/deno
# Claude Code : sert seulement au mode abonnement (CLAUDE_CODE_OAUTH_TOKEN).
RUN curl -fsSL https://claude.ai/install.sh | bash
ENV PATH=/root/.local/bin:$PATH
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["python", "worker.py"]
