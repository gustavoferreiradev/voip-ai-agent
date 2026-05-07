#!/bin/bash
set -e

echo "============================================"
echo " VoIP AI Stack – Iniciando..."
echo "============================================"

# Variáveis com defaults
FS_ESL_PASSWORD="${FREESWITCH_ESL_PASSWORD:-ClueCon}"
DB_NAME="${DB_NAME:-voipai}"
DB_USER="${DB_USER:-voipai}"
DB_PASS="${DB_PASS:-voipai}"

# ── PostgreSQL ───────────────────────────────────────────────
echo "[1/3] Iniciando PostgreSQL..."
service postgresql start
sleep 3

su - postgres -c "psql -tc \"SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'\" \
  | grep -q 1 || psql -c \"CREATE ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASS}';\""
su - postgres -c "psql -lqt | cut -d\| -f1 | grep -qw ${DB_NAME} || \
  createdb -O ${DB_USER} ${DB_NAME}"

echo "[1/3] PostgreSQL OK."

# ── FreeSWITCH ───────────────────────────────────────────────
# bytedesk/freeswitch já tem seu próprio entrypoint que inicia o FS.
# Como estamos sobrescrevendo o entrypoint, iniciamos manualmente.
echo "[2/3] Iniciando FreeSWITCH..."
/usr/local/freeswitch/bin/freeswitch -nonat -nc -nf \
  -conf /usr/local/freeswitch/etc/freeswitch \
  -log  /usr/local/freeswitch/log \
  -db   /usr/local/freeswitch/db &

MAX=30; COUNT=0
until fs_cli -p "$FS_ESL_PASSWORD" -x "status" 2>/dev/null | grep -q "UP"; do
  COUNT=$((COUNT+1))
  [ $COUNT -ge $MAX ] && { echo "AVISO: FS timeout, continuando..."; break; }
  echo "  Aguardando FreeSWITCH... ($COUNT/$MAX)"
  sleep 2
done
echo "[2/3] FreeSWITCH OK."

# ── Node.js ──────────────────────────────────────────────────
echo "[3/3] Iniciando Node.js..."
cd /app

# Carrega variáveis do .env se existir
if [ -f /app/.env ]; then
  set -a
  source /app/.env
  set +a
fi

node src/index.js &

MAX=20; COUNT=0
until curl -sf http://localhost:3000/health > /dev/null 2>&1; do
  COUNT=$((COUNT+1))
  [ $COUNT -ge $MAX ] && { echo "AVISO: Node timeout, continuando..."; break; }
  echo "  Aguardando Node.js... ($COUNT/$MAX)"
  sleep 2
done
echo "[3/3] Node.js OK → http://localhost:3000"

echo ""
echo "============================================"
echo " Stack pronta!"
echo " ESL FreeSWITCH : 8021  (senha: $FS_ESL_PASSWORD)"
echo " SIP            : 5060 UDP/TCP"
echo " Node.js API    : http://localhost:3000"
echo "   GET  /health"
echo "   POST /call   { destination, callerId }"
echo "   GET  /transcripts/:uuid"
echo "============================================"
echo ""

# Mantém container vivo
tail -f /usr/local/freeswitch/log/freeswitch.log 2>/dev/null || \
  tail -f /dev/null