FROM python:3.11-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends bubblewrap tesseract-ocr tesseract-ocr-eng tesseract-ocr-osd fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/requirements.txt /app/requirements.txt
RUN python -m pip install --no-cache-dir --upgrade "pip>=26.2.0" "setuptools>=84.1.0" \
    && python -m pip install --no-cache-dir -r requirements.txt \
    && useradd --create-home --uid 10001 appuser
COPY backend/app /app/app
USER appuser
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/ready', timeout=4)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2", "--limit-concurrency", "16", "--timeout-keep-alive", "5"]
