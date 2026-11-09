#!/usr/bin/env bash
# Abre o Time de Bots. Cada --instancia tem seus próprios bots, conversas e memória,
# então dá para ter mais de um time na mesma máquina (ex.: "pessoal" e "trabalho").
#
# Uso:  kit/iniciar.sh                      -> instância "principal"
#       kit/iniciar.sh --instancia trabalho -> segundo time, separado
#       kit/iniciar.sh --instancia vps --tela :21   (usado pela VPS, numa tela virtual)
set -euo pipefail

aqui="$(cd "$(dirname "$0")" && pwd)"
app="$aqui/../app"
instancia="principal"
tela=""

while [ $# -gt 0 ]; do
  case "$1" in
    --instancia) instancia="${2:?nome da instância}"; shift 2 ;;
    --tela) tela="${2:?número da tela, ex.: :21}"; shift 2 ;;
    -h|--help) sed -n 2,9p "$0"; exit 0 ;;
    *) echo "opção desconhecida: $1" >&2; exit 1 ;;
  esac
done

case "$instancia" in
  *[!a-zA-Z0-9_-]*|"") echo "nome de instância: só letras, números, - e _" >&2; exit 1 ;;
esac

# Só assinatura: o app usa o login do Claude Code / Codex, nunca uma chave de API.
unset ANTHROPIC_API_KEY OPENAI_API_KEY CODEX_API_KEY

dados="${TIME_DE_BOTS_DADOS:-$HOME/.local/share/time-de-bots}/$instancia"
mkdir -p "$dados" && chmod 700 "$dados"
export GRATIS_DATA_DIR="$dados"

[ -n "$tela" ] && export DISPLAY="$tela"
# No Mac a janela abre sem DISPLAY; no Linux ele é obrigatório.
if [ "$(uname -s)" = "Linux" ] && [ -z "${DISPLAY:-}" ]; then
  echo "Sem tela (DISPLAY vazio). No servidor, use kit/vps/instalar-vps.sh." >&2; exit 1
fi

[ -d "$app/node_modules" ] || { echo "Rode antes: kit/instalar.sh" >&2; exit 1; }

# Linux: o Electron precisa do sandbox com dono root (setuid). Se não estiver assim,
# abre sem ele e avisa. Para ligar: sudo chown root:root .../chrome-sandbox && sudo chmod 4755 ...
extra=()
sandbox="$app/node_modules/electron/dist/chrome-sandbox"
if [ "$(uname -s)" = "Linux" ]; then
  if [ "$(stat -c %u "$sandbox" 2>/dev/null)" != "0" ] || [ ! -u "$sandbox" ]; then
    echo "Aviso: sandbox do Electron desligado (veja kit/COMO-LIGAR-SANDBOX.md)."
    extra+=(--no-sandbox)
  fi
  # Servidor sem placa de vídeo: desenha pela CPU.
  [ -n "$tela" ] && extra+=(--disable-gpu)
fi

echo "Time de Bots — instância '$instancia' — dados em $dados"
cd "$app"
exec ./node_modules/.bin/electron . "${extra[@]}"
