#!/usr/bin/env bash
# Prepara um servidor Ubuntu 24.04+ (VPS) para o Time de Bots.
# Rode COM SEU USUÁRIO (não root), que precisa ter sudo. Ele:
#   1) instala tela virtual, VNC, noVNC e as bibliotecas do Electron (sudo apt);
#   2) instala Node 22 se faltar;
#   3) deixa seus serviços rodando mesmo depois que você sair do SSH (linger);
#   4) roda kit/instalar.sh (dependências + testes do app).
# Não abre nenhuma porta no firewall: o acesso é só por túnel SSH.
set -euo pipefail
[ "$(id -u)" -ne 0 ] || { echo "Rode com um usuário comum (com sudo), não como root." >&2; exit 1; }
kit="$(cd "$(dirname "$0")/.." && pwd)"

echo "1/4 Pacotes do sistema"
sudo apt-get update -qq
sudo apt-get install -y -qq xvfb x11vnc novnc websockify \
  libgtk-3-0t64 libnss3 libasound2t64 libgbm1 libxss1 libxshmfence1 libdrm2 fonts-noto-color-emoji ca-certificates curl git \
  || sudo apt-get install -y -qq xvfb x11vnc novnc websockify libgtk-3-0 libnss3 libasound2 libgbm1 libxss1 libxshmfence1 libdrm2 fonts-noto-color-emoji ca-certificates curl git

echo "2/4 Node.js 22+"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y -qq nodejs
fi
node --version

echo "3/4 Serviços continuam depois que você sai do SSH"
sudo loginctl enable-linger "$(whoami)"

echo "4/4 App"
"$kit/instalar.sh"

echo
echo "Agora:"
echo "  a) entre na sua conta (uma vez):  claude      ou   codex login --device-auth"
echo "  b) ligue a primeira instância:     kit/vps/nova-instancia.sh principal 1"
echo "  c) quer outro time separado?       kit/vps/nova-instancia.sh trabalho 2"
