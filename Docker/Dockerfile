FROM python:3.12-slim

WORKDIR /app

# Install dependencies + openssl for key generation
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY Backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend
COPY Backend/ .

# Copy frontend (static files served by backend)
COPY Frontend/ /app/static/

# Entrypoint: auto-generates private key if missing
COPY Docker/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
ENTRYPOINT ["/docker-entrypoint.sh"]

EXPOSE 8200

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8200"]
