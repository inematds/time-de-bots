# O que mudamos no app (pasta `app/`)

O app em `app/` é software livre sob licença MIT (veja `app/LICENSE` e `app/THIRD_PARTY_NOTICES.md`,
mantidos como a licença exige). Mudamos só o que aparece na tela:

| Arquivo | Mudança |
|---|---|
| `app/edition.json` | nome "Time de Bots", pasta de dados "Time de Bots", id `club.inema.timedebots` |
| `app/package.json` | `name`, `productName` e endereços do repositório (apontam para este kit) |
| `app/README.md` | trocado por uma nota curta em português apontando para o kit |
| `app/DISCLAIMER.md` | lista de marcas sem afiliação encurtada |
| `app/src/index.html` | título da tela inicial |
| `app/src/store.mjs` | bot inicial "Assistente", instrução "Responda em português do Brasil…" |
| `app/src/main.cjs` | mesmo nome do bot inicial no app empacotado |

Depois das mudanças: `npm test` → 193 de 193 passam (Linux ARM64 e VPS x86_64, 09/11/2026).
O resto do kit (`kit/`) é nosso: instalação, lançador com várias instâncias, modo VPS e conferência.
