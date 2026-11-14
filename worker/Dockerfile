FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
# yt-dlp a besoin de deno pour lire toutes les qualités YouTube.
COPY --from=denoland/deno:bin /deno /usr/local/bin/deno
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["python", "worker.py"]
