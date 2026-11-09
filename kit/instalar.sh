#!/usr/bin/env bash
# Instala o Time de Bots nesta máquina (Linux ou Mac) e confere se está tudo certo.
# Não entra em nenhuma conta e não usa chave de API: o login é seu, no Claude Code ou no Codex.
set -euo pipefail
aqui="$(cd "$(dirname "$0")" && pwd)"
app="$aqui/../app"

ok()   { echo "  [ok]  $*"; }
falta(){ echo "  [falta] $*"; }

echo "1/4 Conferindo o que a máquina tem"
command -v node >/dev/null || { falta "Node.js 22 ou mais novo (https://nodejs.org)"; exit 1; }
maior=$(node -p 'process.versions.node.split(".")[0]')
[ "$maior" -ge 22 ] && ok "Node $(node --version)" || { falta "Node 22+ (você tem $(node --version))"; exit 1; }
command -v npm >/dev/null && ok "npm $(npm --version)" || { falta "npm"; exit 1; }
command -v git >/dev/null && ok "git" || falta "git (só para atualizar depois)"
echo "     sistema: $(uname -s) $(uname -m)"

echo "2/4 Baixando as dependências do app (npm ci)"
cd "$app"
npm ci --no-audit --no-fund

echo "3/4 Baixando os arquivos do app (modelo de memória, conferidos por checksum)"
npm run setup:assets

echo "4/4 Rodando os testes do app"
unset ANTHROPIC_API_KEY OPENAI_API_KEY
if npm test >/tmp/time-de-bots-testes.log 2>&1; then
  passou=$(grep -E '^(ℹ|#) pass [0-9]+' /tmp/time-de-bots-testes.log | grep -oE '[0-9]+' | tail -1)
  ok "${passou:-?} testes passaram"
else
  falta "algum teste falhou — veja /tmp/time-de-bots-testes.log"; exit 1
fi

echo
echo "Login (feito por você, no terminal, uma vez só):"
if command -v claude >/dev/null; then
  claude auth status --json 2>/dev/null | grep -q '"loggedIn": *true' && ok "Claude Code logado" || falta "rode: claude   (e entre com a sua conta Claude)"
else
  falta "Claude Code não instalado: https://code.claude.com/docs/en/setup  (ou use o Codex)"
fi
command -v codex >/dev/null && ok "Codex instalado (entre com: codex login)" || echo "  [opcional] Codex: npm i -g @openai/codex"
echo
echo "Pronto. Abra com:  kit/iniciar.sh"
echo "Confira uma resposta real:  node kit/scripts/conferir-resposta.mjs"
