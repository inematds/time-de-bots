#!/usr/bin/env bash
# Uma instância do Time de Bots num servidor sem monitor:
#   tela virtual (Xvfb) + app + acesso pelo navegador (noVNC), tudo preso em 127.0.0.1.
# Você entra por um túnel SSH; nada fica aberto para a internet.
# Chamado pelo serviço time-de-bots@<nome>; config em ~/.config/time-de-bots/<nome>.env
set -euo pipefail
nome="${1:?uso: sessao.sh <nome-da-instancia>}"
conf="$HOME/.config/time-de-bots/$nome.env"
[ -f "$conf" ] || { echo "falta $conf (rode kit/vps/nova-instancia.sh $nome)" >&2; exit 1; }
# shellcheck disable=SC1090
source "$conf"   # TELA=:21  PORTA_VNC=5921  PORTA_WEB=6081  TAMANHO=1440x900
kit="$(cd "$(dirname "$0")/.." && pwd)"
novnc="${NOVNC_DIR:-/usr/share/novnc}"

filhos=()
encerrar() { for p in "${filhos[@]}"; do kill "$p" 2>/dev/null || true; done; }
trap encerrar EXIT INT TERM

Xvfb "$TELA" -screen 0 "${TAMANHO:-1440x900}x24" -nolisten tcp &
filhos+=($!)
for _ in $(seq 1 50); do [ -e "/tmp/.X11-unix/X${TELA#:}" ] && break; sleep 0.1; done

# VNC só em 127.0.0.1 e sem senha: quem chega aqui já passou pelo SSH.
x11vnc -display "$TELA" -localhost -rfbport "$PORTA_VNC" -forever -shared -nopw -quiet &
filhos+=($!)
websockify --web "$novnc" "127.0.0.1:$PORTA_WEB" "127.0.0.1:$PORTA_VNC" >/dev/null 2>&1 &
filhos+=($!)

"$kit/iniciar.sh" --instancia "$nome" --tela "$TELA" &
app=$!
filhos+=($app)
wait "$app"
