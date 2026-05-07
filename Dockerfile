# ============================================================
# Dockerfile – FreeSWITCH + Node.js VoIP/AI Stack
# Base  : bytedesk/freeswitch:latest
#         (FreeSWITCH 1.10 + Debian, amd64 + arm64)
# Stack : FreeSWITCH + Node.js 20 LTS + PostgreSQL
#         Deepgram STT (WebSocket) + OpenAI GPT-4o
# ============================================================
FROM bytedesk/freeswitch:latest

LABEL maintainer="voip-ai-lab"
LABEL description="FreeSWITCH + Node.js + Deepgram + GPT-4o"

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=America/Sao_Paulo
ENV NODE_ENV=production

# ── Portas ───────────────────────────────────────────────────
EXPOSE 5060/udp 5060/tcp
EXPOSE 5061/tcp
EXPOSE 16384-32768/udp
EXPOSE 8021/tcp
EXPOSE 3000/tcp

# ── 1. Dependências adicionais + timezone + locale ───────────
USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl wget gnupg2 ca-certificates \
    git unzip build-essential \
    procps net-tools iproute2 \
    vim nano tzdata locales ffmpeg \
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

ENV LANG=pt_BR.UTF-8 \
    LANGUAGE=pt_BR:pt \
    LC_ALL=pt_BR.UTF-8

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

# ── 4. Configurações FreeSWITCH customizadas ─────────────────
# bytedesk/freeswitch lê configs em /usr/local/freeswitch/etc/freeswitch
# Configs customizadas montadas via volume em runtime
# Para sobrescrever, monte: -v ./freeswitch/conf:/usr/local/freeswitch/etc/freeswitch

# ── 5. Entrypoint ─────────────────────────────────────────────
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

VOLUME ["/usr/local/freeswitch/etc/freeswitch", \
    "/usr/local/freeswitch/log", \
    "/var/lib/postgresql", \
    "/app/logs"]

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD fs_cli -p ${FREESWITCH_ESL_PASSWORD:-ClueCon} -x "status" 2>/dev/null | grep -q "UP" \
    && curl -sf http://localhost:3000/health || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]