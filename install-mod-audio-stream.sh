#!/bin/bash
# ============================================================
# install-mod-audio-stream.sh
# Compila e instala o mod_audio_stream no FreeSWITCH do FS PBX
# Executar dentro da VM: multipass exec fspbx -- sudo bash /home/debian/install-mod-audio-stream.sh
# ============================================================
set -e

echo "============================================"
echo " Instalando mod_audio_stream"
echo "============================================"

# ── 1. Dependências de compilação ────────────────────────────
echo "[1/6] Instalando dependências..."
apt-get update -qq
apt-get install -y --no-install-recommends \
    git build-essential cmake \
    libfreeswitch-dev freeswitch-dev \
    libwebsockets-dev \
    pkg-config \
    curl wget

echo "[1/6] Dependências OK."

# ── 2. Clona o repositório ───────────────────────────────────
echo "[2/6] Clonando mod_audio_stream..."
cd /usr/src

if [ -d "mod_audio_stream" ]; then
    echo "  Diretório existente — atualizando..."
    cd mod_audio_stream && git pull
else
    git clone https://github.com/nicklvsa/freeswitch-mod-audio-stream.git mod_audio_stream
    cd mod_audio_stream
fi

echo "[2/6] Clone OK."

# ── 3. Verifica path do FreeSWITCH ──────────────────────────
echo "[3/6] Verificando instalação do FreeSWITCH..."

# Localiza os headers do FreeSWITCH
FS_INCLUDE=$(find /usr -name "switch.h" 2>/dev/null | head -1 | xargs dirname 2>/dev/null || echo "")
FS_MOD_DIR=$(fs_cli -x "global_getvar mod_dir" 2>/dev/null || echo "/usr/lib/freeswitch/mod")

echo "  Headers  : $FS_INCLUDE"
echo "  Módulos  : $FS_MOD_DIR"

if [ -z "$FS_INCLUDE" ]; then
    echo "ERRO: headers do FreeSWITCH não encontrados."
    echo "Tentando instalar freeswitch-dev..."
    apt-get install -y freeswitch-dev
    FS_INCLUDE=$(find /usr -name "switch.h" 2>/dev/null | head -1 | xargs dirname 2>/dev/null)
fi

echo "[3/6] FreeSWITCH OK — headers em $FS_INCLUDE"

# ── 4. Compila ───────────────────────────────────────────────
echo "[4/6] Compilando mod_audio_stream..."
cd /usr/src/mod_audio_stream

# Tenta cmake primeiro
if [ -f "CMakeLists.txt" ]; then
    mkdir -p build && cd build
    cmake .. \
        -DCMAKE_BUILD_TYPE=Release \
        -DFREESWITCH_INCLUDE_DIR="$FS_INCLUDE" \
        -DFREESWITCH_MOD_DIR="$FS_MOD_DIR"
    make -j$(nproc)
    cd ..
else
    # Fallback: compilação direta com gcc
    gcc -shared -fPIC -o mod_audio_stream.so \
        mod_audio_stream.c \
        -I"$FS_INCLUDE" \
        -lwebsockets \
        $(pkg-config --libs --cflags freeswitch 2>/dev/null || echo "") \
        -Wl,-soname,mod_audio_stream.so
fi

echo "[4/6] Compilação OK."

# ── 5. Instala o módulo ──────────────────────────────────────
echo "[5/6] Instalando módulo em $FS_MOD_DIR..."

# Encontra o .so compilado
SO_FILE=$(find /usr/src/mod_audio_stream -name "mod_audio_stream.so" | head -1)

if [ -z "$SO_FILE" ]; then
    echo "ERRO: mod_audio_stream.so não encontrado após compilação."
    exit 1
fi

cp "$SO_FILE" "$FS_MOD_DIR/mod_audio_stream.so"
chmod 755 "$FS_MOD_DIR/mod_audio_stream.so"
echo "  Instalado em $FS_MOD_DIR/mod_audio_stream.so"

echo "[5/6] Instalação OK."

# ── 6. Carrega o módulo no FreeSWITCH ───────────────────────
echo "[6/6] Carregando módulo..."

# Adiciona ao modules.conf.xml se não estiver
MODULES_CONF="/etc/freeswitch/autoload_configs/modules.conf.xml"
if ! grep -q "mod_audio_stream" "$MODULES_CONF" 2>/dev/null; then
    # Insere antes do </modules>
    sed -i 's|</modules>|  <load module="mod_audio_stream"/>\n</modules>|' "$MODULES_CONF"
    echo "  Adicionado ao modules.conf.xml"
fi

# Carrega em runtime
fs_cli -x "load mod_audio_stream" && \
    echo "[6/6] Módulo carregado com sucesso!" || \
    echo "[6/6] AVISO: carregamento em runtime falhou — reinicie o FreeSWITCH."

# Verifica
echo ""
echo "============================================"
echo " Verificando instalação..."
fs_cli -x "module_exists mod_audio_stream" && \
    echo " mod_audio_stream: INSTALADO ✓" || \
    echo " mod_audio_stream: reinicie o FreeSWITCH para ativar"
echo ""
echo " Para testar em uma chamada:"
echo " fs_cli -x \"uuid_audio_stream <UUID> ws://IP_NODE:8090 both 8000\""
echo "============================================"
