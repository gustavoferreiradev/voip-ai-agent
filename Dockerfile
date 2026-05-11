# ============================================================
# Dockerfile – Node.js VoIP/AI Agent
# Base  : debian:12.10
# Stack : Node.js 20 LTS + PostgreSQL (CDRs/transcrições)
# FreeSWITCH roda na VM com FS PBX — conecta via ESL remoto
# ============================================================
FROM debian:12.10

LABEL maintainer="voip-ai-lab"
LABEL description="Node.js AI Agent — conecta ao FS PBX via ESL remoto"

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=America/Sao_Paulo
ENV NODE_ENV=production

EXPOSE 3000/tcp

# ── 1. Dependências base ─────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl wget ca-certificates gnupg2 \
    build-essential git \
    procps net-tools \
    openssh-client \
    tzdata locales ffmpeg \
    postgresql postgresql-client \
    && ln -snf /usr/share/zoneinfo/$TZ /etc/localtime \
    && echo $TZ > /etc/timezone \
    && sed -i 's/^# *\(pt_BR.UTF-8\)/\1/' /etc/locale.gen \
    && sed -i 's/^# *\(en_US.UTF-8\)/\1/' /etc/locale.gen \
    && locale-gen \
    && echo 'LANG=pt_BR.UTF-8'   >  /etc/default/locale \
    && echo 'LANGUAGE=pt_BR:pt'  >> /etc/default/locale \
    && echo 'LC_ALL=pt_BR.UTF-8' >> /etc/default/locale \
    && rm -rf /var/lib/apt/lists/*

ENV LANG=pt_BR.UTF-8 LANGUAGE=pt_BR:pt LC_ALL=pt_BR.UTF-8

# ── 2. Node.js 20 LTS ────────────────────────────────────────
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && npm install -g npm@latest \
    && node -v && npm -v \
    && rm -rf /var/lib/apt/lists/*

# ── 3. Aplicação Node.js ──────────────────────────────────────
WORKDIR /app
COPY app/package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY app/ ./

# ── 4. Entrypoint ─────────────────────────────────────────────
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

VOLUME ["/var/lib/postgresql", "/app/logs"]

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -sf http://localhost:3000/health || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]