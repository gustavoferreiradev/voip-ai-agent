#!/bin/bash
set -e

echo "============================================"
echo " VoIP AI Agent – Iniciando..."
echo "============================================"

DB_NAME="${DB_NAME:-voipai}"
DB_USER="${DB_USER:-voipai}"
DB_PASS="${DB_PASS:-voipai}"
FS_HOST="${FS_HOST:-127.0.0.1}"
FS_ESL_PORT="${FS_ESL_PORT:-8021}"
VM_IP="${VM_IP:-}"
VM_USER="${VM_USER:-ubuntu}"
SSH_KEY="${SSH_KEY:-/var/snap/multipass/common/data/multipassd/ssh-keys/id_rsa}"

# ── PostgreSQL local (CDRs + transcrições da IA) ─────────────
echo "[1/3] Iniciando PostgreSQL..."
service postgresql start
sleep 3

su - postgres -c "psql -tc \"SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'\" \
  | grep -q 1 || psql -c \"CREATE ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASS}';\""
su - postgres -c "psql -lqt | cut -d\| -f1 | grep -qw ${DB_NAME} || \
  createdb -O ${DB_USER} ${DB_NAME}"

echo "[1/3] PostgreSQL OK."

# ── SSH Tunnel para ESL (se VM_IP estiver definido) ──────────
if [ -n "$VM_IP" ]; then
  echo "[2/3] Criando tunnel SSH para ESL (${VM_IP}:${FS_ESL_PORT})..."

  # Aguarda a VM estar acessível
  MAX=15; COUNT=0
  until ssh -i "$SSH_KEY" \
        -o StrictHostKeyChecking=no \
        -o ConnectTimeout=3 \
        -o BatchMode=yes \
        "${VM_USER}@${VM_IP}" "echo ok" 2>/dev/null | grep -q ok; do
    COUNT=$((COUNT+1))
    [ $COUNT -ge $MAX ] && { echo "AVISO: VM não acessível, pulando tunnel."; break; }
    echo "  Aguardando VM... ($COUNT/$MAX)"
    sleep 3
  done

  # Corrige permissão da chave SSH (Docker monta com 644, SSH exige 600)
  chmod 600 "$SSH_KEY" 2>/dev/null || true

  # Cria o tunnel em background
  ssh -i "$SSH_KEY" \
      -L "${FS_ESL_PORT}:127.0.0.1:${FS_ESL_PORT}" \
      -N -f \
      -o StrictHostKeyChecking=no \
      -o ServerAliveInterval=30 \
      -o ServerAliveCountMax=3 \
      -o ExitOnForwardFailure=yes \
      "${VM_USER}@${VM_IP}" 2>/dev/null && \
    echo "[2/3] Tunnel SSH ativo: localhost:${FS_ESL_PORT} → ${VM_IP}:${FS_ESL_PORT}" || \
    echo "[2/3] AVISO: Tunnel SSH falhou — tentando conectar diretamente."
else
  echo "[2/3] VM_IP não definido — usando ESL direto em ${FS_HOST}:${FS_ESL_PORT}."
fi

# ── Node.js ──────────────────────────────────────────────────
echo "[3/3] Iniciando Node.js..."
cd /app

if [ -f /app/.env ]; then
  set -a; source /app/.env; set +a
fi

node src/index.js &

MAX=20; COUNT=0
until curl -sf http://localhost:3000/health > /dev/null 2>&1; do
  COUNT=$((COUNT+1))
  [ $COUNT -ge $MAX ] && { echo "AVISO: Node timeout."; break; }
  echo "  Aguardando Node.js... ($COUNT/$MAX)"
  sleep 2
done
echo "[3/3] Node.js OK → http://localhost:3000"

echo ""
echo "============================================"
echo " Agente pronto!"
echo " FS PBX (ESL) : ${FS_HOST}:${FS_ESL_PORT}"
echo " Node.js API  : http://localhost:3000"
echo "   GET  /health"
echo "   POST /call   { destination, callerId }"
echo "============================================"
echo ""

tail -f /app/logs/node.log 2>/dev/null || tail -f /dev/null