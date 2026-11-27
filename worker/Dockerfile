# Recognition worker — runs as a Vercel Daemon (see /vercel.json) or anywhere Docker runs.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 MODELS_DIR=/models
RUN apt-get update \
 && apt-get install -y --no-install-recommends libglib2.0-0 ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY download_models.py .
RUN python download_models.py

COPY recognizer ./recognizer
RUN useradd --uid 10001 worker
USER worker
EXPOSE 8080
CMD ["python", "-m", "recognizer"]
