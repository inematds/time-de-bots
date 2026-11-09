# CLAUDE.md — time-de-bots

Kit + guia (PT/EN/ES) de um painel de bots no computador: cada bot com papel, avatar, memória e tarefas
agendadas, respondendo pela ASSINATURA do Claude ou do Codex (login do CLI, nunca chave de API).
Roda no Linux (testado ARM64), no Mac e numa VPS (tela virtual + noVNC só em 127.0.0.1, acesso por túnel SSH).
Várias instâncias = vários times separados (dados em `~/.local/share/time-de-bots/<instância>`).

- Conta/autor: `inematds <inematds@gmail.com>`. Pages da raiz; guia em `guia/` (+ `guia/en/`, `guia/es/`).
- `app/` = código de terceiros sob MIT: manter `app/LICENSE` e `app/THIRD_PARTY_NOTICES.md` intactos (exigência da licença).
  Mudanças nossas no app: só nome visível (edition.json, index.html, store.mjs, main.cjs, package.json). Listar novas em `kit/MUDANCAS-NO-APP.md`.
- Sem citar fonte (vídeo/curso de terceiro) no README, guia, portal ou Telegram. Não chamar de "clone" de produto nenhum.
- Só assinatura: `kit/iniciar.sh` faz `unset ANTHROPIC_API_KEY OPENAI_API_KEY CODEX_API_KEY`; o app aceita só login `claude.ai`.
- VPS: nada em 0.0.0.0; x11vnc `-localhost`, websockify em 127.0.0.1. Login da conta é sempre feito pelo dono no terminal.
- Testes: `cd app && npm test` (193) e `node kit/scripts/conferir-resposta.mjs` (resposta real; grava `kit/verificacao/`).

## Self-learning

When I correct you, or you catch yourself making a mistake: before continuing, add the lesson as a one-line
rule at the TOP of the Lessons section below, so it never happens again.

## Lessons
- rsync para a VPS: excluir só `assets/models/sentence-encoder/` (pesos); `assets/models/manifest.json` é código e o setup quebra sem ele. (09/11/2026)
- Resumo do `node --test` fora de terminal sai como `# pass N` (TAP), não `ℹ pass N`: casar os dois. (09/11/2026)
