FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    APKEDITOR_JAR=/opt/apkeditor/APKEditor.jar \
    MERGE_KEYSTORE=/data/merge-keystore.p12

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git openjdk-21-jdk-headless \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt ./
RUN pip install --upgrade pip && pip install -r requirements.txt
COPY install-apkeditor.sh ./
RUN ./install-apkeditor.sh
COPY app.py ./

RUN mkdir -p /data /root/.config/gplaydl
VOLUME ["/data", "/root/.config/gplaydl"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/health || exit 1

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1", "--proxy-headers", "--forwarded-allow-ips", "*"]
