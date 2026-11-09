# FALHAS — time-de-bots

| data | o que quebrou | menor correção | prompt \| infra |
|---|---|---|---|
| 09/11/2026 | `kit/iniciar.sh` exigia DISPLAY também no Mac (onde ele vem vazio) e parava; guia dizia "AI provider", app mostra "AI subscription" | DISPLAY obrigatório só no Linux; rótulo corrigido no README/guia (achado do revisor) | prompt |
| 09/11/2026 | `setup:assets` na VPS: ENOENT `assets/models/manifest.json` | rsync excluindo só `sentence-encoder/`, não `assets/models` inteiro | prompt |
| 09/11/2026 | instalar.sh mostrava "[ok]  testes passaram" sem número na VPS | grep aceita `ℹ pass` e `# pass` (TAP fora de TTY) | infra |
| 09/11/2026 | 1ª subida da instância "principal" na VPS caiu e reiniciou 1× (Restart=on-failure segurou) | observar; se repetir, esperar o socket do X antes do app (já há laço de 5 s) | infra |
