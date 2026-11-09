#!/usr/bin/env bash
# Cria (ou mostra) uma instância do Time de Bots no servidor e liga o serviço dela.
# Cada instância = um time de bots separado, com tela, portas e dados próprios.
# Uso: kit/vps/nova-instancia.sh <nome> [numero 1-50]
set -euo pipefail
nome="${1:?uso: nova-instancia.sh <nome> [numero]}"
case "$nome" in *[!a-zA-Z0-9_-]*) echo "nome: só letras, números, - e _" >&2; exit 1 ;; esac
n="${2:-1}"
[ "$n" -ge 1 ] && [ "$n" -le 50 ] || { echo "número entre 1 e 50" >&2; exit 1; }

conf_dir="$HOME/.config/time-de-bots"; mkdir -p "$conf_dir"
conf="$conf_dir/$nome.env"
if [ ! -f "$conf" ]; then
  cat > "$conf" <<EOF
TELA=:$((20 + n))
PORTA_VNC=$((5920 + n))
PORTA_WEB=$((6080 + n))
TAMANHO=1440x900
EOF
fi
# shellcheck disable=SC1090
source "$conf"

unit_dir="$HOME/.config/systemd/user"; mkdir -p "$unit_dir"
cp "$(dirname "$0")/time-de-bots@.service" "$unit_dir/"
systemctl --user daemon-reload
systemctl --user enable --now "time-de-bots@$nome"
sleep 3
systemctl --user --no-pager --lines=0 status "time-de-bots@$nome" | sed -n 1,3p

ip=$(hostname -I 2>/dev/null | awk '{print $1}')
echo
echo "Instância '$nome' ligada. No SEU computador, abra o túnel:"
echo "   ssh -N -L $PORTA_WEB:127.0.0.1:$PORTA_WEB $(whoami)@${ip:-SEU_SERVIDOR}"
echo "e no navegador:  http://localhost:$PORTA_WEB/vnc.html  (botão Connect)"
