#!/usr/bin/env node
// Prova que o app responde DE VERDADE pela sua assinatura do Claude (não é modo demonstração).
// Usa o mesmo código que o app usa (app/src/claude-backend.mjs) e o login do Claude Code desta máquina.
// Uso: node kit/scripts/conferir-resposta.mjs [modelo]   (padrão: haiku, o mais leve)
import { createClaudeReply, getClaudeStatus } from '../../app/src/claude-backend.mjs';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

for (const chave of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY']) {
  if (process.env[chave]) { console.log(`Aviso: ${chave} está definida no terminal. O app não a repassa, mas o ideal é rodar sem ela (unset ${chave}).`); }
}

const modelo = process.argv[2] || 'haiku';
const status = await getClaudeStatus();
console.log('Login do Claude:', status.signedIn ? 'OK (assinatura claude.ai)' : 'NÃO — ' + status.message);
if (!status.signedIn) process.exit(2);

const workspaceDir = await mkdtemp(path.join(tmpdir(), 'time-de-bots-teste-'));
const reply = createClaudeReply();
const bot = { name: 'Teste', instructions: 'Responda em português do Brasil, em uma linha.', userPromptTemplate: '{{message}}' };
const pergunta = 'Dê três títulos curtos para uma nota de planejamento da semana.';
const inicio = Date.now();
let texto = '';
for await (const evento of reply({
  settings: { model: modelo }, bot,
  messages: [{ role: 'user', content: pergunta }],
  signal: new AbortController().signal, workspaceDir, persistSession: false,
})) {
  if (typeof evento === 'string') texto += evento;
  else if (evento?.text) texto += evento.text;
  else if (evento?.delta) texto += evento.delta;
}
const segundos = ((Date.now() - inicio) / 1000).toFixed(1);
const ok = texto.trim().length > 0;
console.log(`Resposta (${segundos} s, modelo ${modelo}):\n${texto.trim() || '(vazia)'}`);

const aqui = path.dirname(fileURLToPath(import.meta.url));
const pasta = path.join(aqui, '..', 'verificacao');
await mkdir(pasta, { recursive: true });
const registro = { data: new Date().toISOString(), modelo, segundos: Number(segundos), login: 'claude.ai', resposta_recebida: ok, pergunta };
await writeFile(path.join(pasta, 'ultima-resposta.json'), JSON.stringify(registro, null, 2) + '\n');
console.log(ok ? 'RESULTADO: resposta real recebida pela assinatura.' : 'RESULTADO: nenhuma resposta.');
process.exit(ok ? 0 : 1);
