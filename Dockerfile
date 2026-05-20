FROM python:3.13-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        curl \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN chmod +x bin/reese84 bin/epsfc 2>/dev/null || true

RUN mkdir -p state logs

ENV PYTHONUNBUFFERED=1

STOPSIGNAL SIGTERM

HEALTHCHECK --interval=60s --timeout=10s --retries=3 \
    CMD python3 -c "import os, signal; os.kill(1, 0)" || exit 1

CMD ["python3", "main.py"]