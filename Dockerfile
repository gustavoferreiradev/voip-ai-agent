# ============================================================
# Dockerfile — VoIP AI Agent
# Base  : node:24-slim (Debian Trixie)
# Stack : Node.js 24 LTS + TypeScript + PostgreSQL + ffmpeg
# ============================================================
FROM node:24-bookworm-slim

LABEL maintainer="voip-ai-lab"
LABEL description="VoIP AI Agent — Node 24 + TS + FreeSWITCH ESL + Deepgram + GPT-4o"

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=America/Sao_Paulo
# NODE_ENV é definido após o build para não bloquear devDependencies durante a compilação

EXPOSE 3000/tcp
EXPOSE 8090/tcp

# ── 1. Dependências do sistema ───────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    postgresql-client \
    postgresql \
    openssh-client \
    curl \
    ca-certificates \
    tzdata \
    && ln -snf /usr/share/zoneinfo/$TZ /etc/localtime \
    && echo $TZ > /etc/timezone \
    && rm -rf /var/lib/apt/lists/*

# ── 2. Instala todas as dependências (prod + dev para build) ─
WORKDIR /app
COPY app/package*.json ./
RUN npm install --no-audit --no-fund

# ── 3. Lint + Build TypeScript ────────────────────────────────
COPY app/tsconfig.json ./
COPY app/biome.json    ./
COPY app/src           ./src

# Lint antes de compilar — falha o build se houver erros
RUN ./node_modules/.bin/biome check ./src
RUN ./node_modules/.bin/tsc

# Remove devDependencies após o build
RUN npm prune --omit=dev

# Define NODE_ENV=production apenas em runtime
ENV NODE_ENV=production

# ── 4. Entrypoint ─────────────────────────────────────────────
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

VOLUME ["/var/lib/postgresql", "/app/logs"]

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -sf http://localhost:3000/health || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]