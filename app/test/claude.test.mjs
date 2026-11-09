import {join} from 'node:path';
import {tmpdir} from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createClaudeReply, claudeEnvironment, userPrompt } from '../src/claude-backend.mjs';
import { ChatService } from '../src/chat-service.mjs';

const sessionId = '15a11fdd-babc-4c70-8455-4f2d65a8408d';
const bot = { name: 'Test', instructions: 'Use concise sentences.' };
const settings = { provider: 'claude', model: 'sonnet', effort: 'low' };
async function directory(t) { const path = await mkdtemp(join(tmpdir(),'gratis-claude-test-')); t.after(() => rm(path, { recursive: true, force: true })); return path; }
async function collect(iterator) { let result = ''; for await (const part of iterator) result += part; return result; }
const setup = query => createClaudeReply({ query, resolveExecutable: async () => '/fake/claude', status: async () => ({ signedIn: true }) });
async function* success(text = 'Hello') {
  yield { type: 'system', subtype: 'init', session_id: sessionId, tools: [] };
  yield { type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } };
  yield { type: 'assistant', message: { content: [{ type: 'text', text }] } };
  yield { type: 'result', subtype: 'success', session_id: sessionId, result: text, usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 8 } };
}

test('Claude environment retains login location but drops API billing credentials and unrelated secrets', () => {
  const env = claudeEnvironment({ HOME: '/test', PATH: '/usr/bin', ANTHROPIC_API_KEY: 'secret', CLAUDE_CODE_OAUTH_TOKEN: 'secret', GITHUB_TOKEN: 'secret', CLAUDECODE: '1' });
  assert.equal(env.HOME, '/test');
  for (const key of ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'GITHUB_TOKEN', 'CLAUDECODE']) assert.equal(env[key], undefined);
});

test('user prompt templates preserve literal dollar sequences and require a message slot', () => {
  assert.equal(userPrompt('Request: {{message}}', '$& $` $\''), 'Request: $& $` $\'');
  assert.equal(userPrompt('', 'hello'), 'hello');
  assert.throws(() => userPrompt('Drop the user request', 'hello'), /must include/);
});

test('Claude streaming does not duplicate the final message, and the next turn resumes only its own completed history', async t => {
  const workspaceDir = await directory(t), calls = []; let metadata;
  const reply = setup(args => { calls.push(args); return success(calls.length === 1 ? 'Hello' : 'Again'); });
  const args = { bot, settings, workspaceDir, signal: new AbortController().signal, onMetadata: x => metadata = x };
  assert.equal(await collect(reply({ ...args, messages: [{ role: 'user', content: 'Hi' }] })), 'Hello');
  const saved = metadata.claudeSession;
  assert.equal(metadata.usage.outputTokens, 2);
  assert.deepEqual(calls[0].options.tools, []); assert.deepEqual(calls[0].options.disallowedTools, ['*']);
  assert.deepEqual(calls[0].options.settingSources, []); assert.equal(calls[0].options.strictMcpConfig, true);
  const history = [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello' }, { role: 'user', content: 'Next' }];
  assert.equal(await collect(reply({ ...args, messages: history, claudeSession: saved })), 'Again');
  assert.equal(calls[1].options.resume, sessionId); assert.equal(calls[1].prompt, 'Next');
  await collect(reply({ ...args, bot: { ...bot, instructions: 'New system instruction' }, messages: history, claudeSession: saved }));
  assert.equal(calls[2].options.resume, undefined); assert.match(calls[2].prompt, /Prior conversation/);
  assert.match(calls[2].options.systemPrompt, /New system instruction/);
});

test('a missing SDK session rebuilds context once, but auth errors do not retry', async t => {
  const workspaceDir = await directory(t), common = { bot, settings, workspaceDir, signal: new AbortController().signal }; let metadata;
  await collect(setup(() => success())({ ...common, messages: [{ role: 'user', content: 'Hi' }], onMetadata: m => metadata = m }));
  let calls = 0;
  const reply = setup(args => { calls++; return args.options.resume ? (async function* () { throw new Error('No conversation found with session ID'); })() : success('Recovered'); });
  const history = [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello' }, { role: 'user', content: 'Next' }];
  assert.equal(await collect(reply({ ...common, messages: history, claudeSession: metadata.claudeSession })), 'Recovered'); assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(collect(setup(() => { calls++; return (async function* () { throw new Error('Authentication failed'); })(); })({ ...common, messages: history })), /Authentication failed/);
  assert.equal(calls, 1);
});

test('cancelling a Claude response aborts its SDK process', async t => {
  const workspaceDir = await directory(t), controller = new AbortController(); let started;
  const ready = new Promise(resolve => started = resolve);
  const reply = setup(({ options }) => (async function* () { started(); await new Promise((_, reject) => options.abortController.signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true })); })());
  const pending = collect(reply({ bot, settings, workspaceDir, messages: [{ role: 'user', content: 'Hi' }], signal: controller.signal }));
  await ready; controller.abort(new DOMException('Stopped', 'AbortError'));
  await assert.rejects(pending, { name: 'AbortError' });
});

test('prompt settings persist; display messages stay unwrapped; errors invalidate native sessions for a clean retry', async t => {
  const dataDir = await directory(t); let requests = [], fail = false;
  const backend = async function* (request) { requests.push(request); if (fail) throw new Error('Temporary Claude failure'); yield 'reply'; request.onMetadata({ claudeSession: { id: sessionId }, usage: { model: 'sonnet', outputTokens: 1 } }); };
  let service = new ChatService({ dataDir, backend }); await service.init(); const initial = service.snapshot();
  await service.updateBot({ id: initial.activeBotId, instructions: 'My system prompt', userPromptTemplate: 'Please answer: {{message}}' });
  await service.updateSettings({ provider: 'claude', model: 'sonnet', baseUrl: 'http://127.0.0.1:11434/v1', effort: 'low' });
  await service.send({ conversationId: initial.activeConversationId, text: 'Hello' }); await service.whenIdle();
  let c = service.snapshot().conversations[0]; assert.equal(c.messages[0].content, 'Hello'); assert.equal(requests[0].messages[0].content, 'Please answer: Hello'); assert.ok(c.claudeSession);
  await service.close(); service = new ChatService({ dataDir, backend }); await service.init(); assert.equal(service.snapshot().bots[0].userPromptTemplate, 'Please answer: {{message}}');
  fail = true; await service.send({ conversationId: initial.activeConversationId, text: 'Second' }); await service.whenIdle(); c = service.snapshot().conversations[0]; assert.equal(c.claudeSession, null);
  fail = false; await service.retry({ conversationId: initial.activeConversationId }); await service.whenIdle(); c = service.snapshot().conversations[0]; assert.equal(c.messages.filter(m => m.role === 'user').length, 2); assert.equal(requests.at(-1).claudeSession, null);
  await service.close();
});

test('tool hooks expose actual external tool outcomes without changing tool permissions',async()=>{
 const {claudeToolHooks}=await import('../src/claude-backend.mjs'),events=[],hooks=claudeToolHooks(v=>events.push(v.activity));
 const input={tool_name:'WebSearch',tool_use_id:'trace-one',tool_input:{query:'flight research',apiKey:'secret'}};
 assert.deepEqual(await hooks.PreToolUse[0].hooks[0]({...input,hook_event_name:'PreToolUse'}),{});
 await hooks.PostToolUse[0].hooks[0]({...input,hook_event_name:'PostToolUse',tool_response:{sources:['https://example.com']}});
 assert.equal(events[0].status,'running');assert.equal(events[1].status,'complete');assert.equal(events[0].input.apiKey,'[redacted]');assert.ok(events[1].result.sources);
 await hooks.PreToolUse[0].hooks[0]({...input,tool_name:'mcp__gratis__computer',hook_event_name:'PreToolUse'});assert.equal(events.length,2);
});

test('changing recalled data keeps a Claude session warm; privacy changes require fresh context',async t=>{
 const calls=[];let metadata;const reply=setup(args=>{calls.push(args);return success();}),common={bot,settings,workspaceDir:await directory(t),signal:new AbortController().signal,onMetadata:m=>metadata=m};let messages=[{role:'user',content:'Hi'}];await collect(reply({...common,messages,turnContext:'Preference A',contextEpoch:0}));const first=metadata.claudeSession;messages.push({role:'assistant',content:'Hello'},{role:'user',content:'Next'});await collect(reply({...common,messages,claudeSession:first,turnContext:'Preference B',contextEpoch:0}));assert.equal(calls[1].options.resume,sessionId);assert.match(calls[1].prompt,/Preference B/);const second=metadata.claudeSession;messages.push({role:'assistant',content:'Hello'},{role:'user',content:'After forget'});await collect(reply({...common,messages,claudeSession:second,turnContext:'',contextEpoch:1}));assert.equal(calls[2].options.resume,undefined);
});
