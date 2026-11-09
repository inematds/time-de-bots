import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { ChatService } from '../src/chat-service.mjs';
import { streamReply, validateSettings } from '../src/backend.mjs';

async function fixture(t, backend) {
  const dataDir = await mkdtemp(join(tmpdir(), 'independent-bot-test-'));
  const changes = [], service = new ChatService({ dataDir, backend, onChange: state => changes.push(state) });
  await service.init();
  t.after(async () => { await service.close(); await rm(dataDir, { recursive: true, force: true }); });
  return { dataDir, service, changes };
}
const echo = async function* ({ messages, signal }) { await delay(5, undefined, { signal }); yield `Reply to: ${messages.at(-1).content}`; };

test('bots, conversations, drafts, messages and active selection survive restart', async t => {
  const { service, dataDir, changes } = await fixture(t, echo);
  const initial = service.snapshot(), firstId = initial.activeConversationId;
  await service.send({ conversationId: firstId, text: 'A remembered first message' });
  await service.whenIdle();
  await service.createBot({ name: 'Researcher', instructions: 'Cite sources.' });
  const secondId = service.snapshot().activeConversationId;
  await service.setDraft({ conversationId: secondId, text: 'Unsent second draft' });
  await service.close();
  const reopened = new ChatService({ dataDir });
  await reopened.init(); t.after(() => reopened.close());
  assert.equal(reopened.snapshot().activeConversationId, secondId);
  assert.equal(reopened.snapshot().conversations.find(c => c.id === secondId).draft, 'Unsent second draft');
  assert.deepEqual(reopened.snapshot().conversations.find(c => c.id === firstId).messages.map(m => m.content), ['A remembered first message', 'Reply to: A remembered first message']);
  assert.ok(changes.some(s => s.conversations[0].messages.some(m => m.status === 'streaming')));
  assert.ok(changes.some(s => s.conversations[0].messages.some(m => m.role === 'assistant' && m.status === 'complete')));
});

test('each bot and each conversation keep separate message histories', async t => {
  const requests = [];
  const backend = async function* (request) { requests.push(request); yield request.bot.name; };
  const { service } = await fixture(t, backend);
  const firstBot = service.snapshot().activeBotId, firstConvo = service.snapshot().activeConversationId;
  await service.send({ conversationId: firstConvo, text: 'Alpha' }); await service.whenIdle();
  await service.newConversation({ botId: firstBot });
  const otherConvo = service.snapshot().activeConversationId;
  await service.send({ conversationId: otherConvo, text: 'Beta' }); await service.whenIdle();
  await service.createBot({ name: 'Writer', instructions: 'Write brief prose.' });
  const writerConvo = service.snapshot().activeConversationId;
  await service.send({ conversationId: writerConvo, text: 'Gamma' }); await service.whenIdle();
  assert.deepEqual(requests.map(r => r.messages.map(m => m.content)), [['Alpha'], ['Beta'], ['Gamma']]);
  assert.equal(requests[2].bot.instructions, 'Write brief prose.');
  await service.selectConversation({ id: firstConvo });
  assert.equal(service.snapshot().activeBotId, firstBot);
  assert.equal(service.snapshot().conversations.find(c => c.id === otherConvo).messages[0].content, 'Beta');
});

test('backend errors are persisted, retry does not duplicate user message', async t => {
  let calls = 0;
  const backend = async function* () { if (++calls === 1) throw new Error('Intentional failure'); yield 'Recovered'; };
  const { service } = await fixture(t, backend), conversationId = service.snapshot().activeConversationId;
  await service.send({ conversationId, text: 'Try once' }); await service.whenIdle();
  assert.equal(service.snapshot().conversations[0].messages.at(-1).status, 'error');
  assert.match(service.snapshot().conversations[0].messages.at(-1).error, /Intentional/);
  await service.retry({ conversationId }); await service.whenIdle();
  const messages = service.snapshot().conversations[0].messages;
  assert.equal(messages.filter(m => m.role === 'user').length, 1);
  assert.equal(messages.at(-1).content, 'Recovered');
  assert.equal(messages.at(-1).status, 'complete');
});

test('stopping a stream retains partial response and permits retry', async t => {
  const backend = async function* ({ signal }) { yield 'Partial'; await delay(5000, undefined, { signal }); yield ' later'; };
  const { service } = await fixture(t, backend), conversationId = service.snapshot().activeConversationId;
  await service.send({ conversationId, text: 'Stop this' }); await delay(20);
  await service.stop({ conversationId });
  const response = service.snapshot().conversations[0].messages.at(-1);
  assert.equal(response.content, 'Partial'); assert.equal(response.status, 'cancelled');
  await assert.rejects(service.send({ conversationId, text: ' ' }), /non-empty/);
});

test('corrupt state is rejected without overwriting existing bytes', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'independent-bot-corrupt-')); t.after(() => rm(dataDir, { recursive: true, force: true }));
  const original = '{ invalid state'; await writeFile(join(dataDir, 'workspace.json'), original);
  await assert.rejects(new ChatService({ dataDir }).init(), /preserved/);
  assert.equal(await readFile(join(dataDir, 'workspace.json'), 'utf8'), original);
});

test('interrupted response is marked cancelled when a saved workspace reopens', async t => {
  const { service, dataDir } = await fixture(t, echo), state = service.snapshot();
  state.conversations[0].messages.push({ id: 'interrupted', role: 'assistant', content: 'Partial persisted', status: 'streaming', createdAt: Date.now() });
  await writeFile(join(dataDir, 'workspace.json'), JSON.stringify(state));
  const restarted = new ChatService({ dataDir }); await restarted.init(); t.after(() => restarted.close());
  assert.equal(restarted.snapshot().conversations[0].messages[0].status, 'cancelled');
});

test('local OpenAI-compatible stream sends instructions and history and parses split SSE frames', async t => {
  let received;
  const server = createServer(async (req, res) => {
    assert.equal(req.url, '/v1/chat/completions'); assert.equal(req.method, 'POST');
    let body = ''; for await (const chunk of req) body += chunk; received = JSON.parse(body);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"con');
    await delay(5); res.write('tent":"Hello "}}]}\r');
    await delay(5); res.write('\n\r\ndata: {"choices":[{"delta":{"content":"world"}}]}\n\n');
    res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/v1`;
  const parts = [];
  for await (const chunk of streamReply({ settings: { provider: 'local', baseUrl: url, model: 'local-model' }, bot: { name: 'Helper', instructions: 'Be concise' }, messages: [{ role: 'user', content: 'First' }, { role: 'assistant', content: 'Prior' }, { role: 'user', content: 'Second' }], signal: new AbortController().signal })) parts.push(chunk);
  assert.equal(parts.join(''), 'Hello world');
  assert.deepEqual(received, { model: 'local-model', stream: true, messages: [{ role: 'system', content: 'Be concise' }, { role: 'user', content: 'First' }, { role: 'assistant', content: 'Prior' }, { role: 'user', content: 'Second' }] });
});

test('local backend JSON fallback and malformed stream/HTTP errors are explicit', async t => {
  const server = createServer((req, res) => {
    const path = req.url;
    if (path.startsWith('/good/')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: 'JSON reply' } }] })); }
    else if (path.startsWith('/malformed/')) { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end('data: wrong\n\n'); }
    else { res.writeHead(503); res.end('unavailable'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  async function collect(path) { let s = ''; for await (const chunk of streamReply({ settings: { provider: 'local', baseUrl: `http://127.0.0.1:${server.address().port}/${path}`, model: 'model' }, bot: { instructions: '' }, messages: [{ role: 'user', content: 'hi' }], signal: new AbortController().signal })) s += chunk; return s; }
  assert.equal(await collect('good'), 'JSON reply');
  await assert.rejects(collect('malformed'), /malformed/);
  await assert.rejects(collect('missing'), /503/);
});

test('remote or credential-bearing backend URLs and invalid user inputs are rejected', async t => {
  for (const baseUrl of ['https://example.com/v1', 'http://example.com', 'http://127.0.0.1.evil.test', 'http://user:pass@127.0.0.1:1234', 'http://127.0.0.1/v1?token=x']) assert.throws(() => validateSettings({ provider: 'local', baseUrl, model: 'test' }), /loopback/);
  const { service } = await fixture(t, echo);
  await assert.rejects(service.createBot({ name: '' }), /non-empty/);
  await assert.rejects(service.selectConversation({ id: 'unknown' }), /not found/);
  await assert.rejects(service.updateBot({ id: service.snapshot().activeBotId, avatarDataUrl: 'https://example.com/image.png' }), /PNG/);
});

test('profile name trims, persists across restart and survives older model-only updates', async t => {
  const {service,dataDir}=await fixture(t,echo);
  await service.updateSettings({...service.snapshot().settings,displayName:'  Taylor Test  '});
  assert.equal(service.snapshot().settings.displayName,'Taylor Test');
  await service.updateSettings({provider:'demo',baseUrl:'http://127.0.0.1:11434/v1',model:''});
  assert.equal(service.snapshot().settings.displayName,'Taylor Test');
  await assert.rejects(service.updateSettings({...service.snapshot().settings,displayName:'x'.repeat(81)}),/80/);
  await service.close();const reopened=new ChatService({dataDir});await reopened.init();t.after(()=>reopened.close());
  assert.equal(reopened.snapshot().settings.displayName,'Taylor Test');
});

test('profile photos persist independently, survive model changes, and reject unsafe image values', async t => {
 const {service,dataDir}=await fixture(t,echo),botBefore=service.snapshot().bots[0];
 const photo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
 await service.updateSettings({...service.snapshot().settings,profileAvatarDataUrl:photo});
 await service.updateSettings({provider:'demo',model:'',baseUrl:'http://127.0.0.1:11434/v1'});
 assert.equal(service.snapshot().settings.profileAvatarDataUrl,photo);assert.deepEqual(service.snapshot().bots[0],botBefore);
 for(const bad of ['https://example.com/photo.png','data:image/svg+xml;base64,PHN2Zz4=',123])await assert.rejects(service.updateSettings({...service.snapshot().settings,profileAvatarDataUrl:bad}),/PNG/);
 await service.close();const reopened=new ChatService({dataDir});await reopened.init();t.after(()=>reopened.close());assert.equal(reopened.snapshot().settings.profileAvatarDataUrl,photo);
 await reopened.updateSettings({...reopened.snapshot().settings,profileAvatarDataUrl:null});assert.equal(reopened.snapshot().settings.profileAvatarDataUrl,null);
});
