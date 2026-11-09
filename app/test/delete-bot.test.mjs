import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ChatService} from '../src/chat-service.mjs';

async function fixture(t, options = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'gratis-delete-'));
  const service = new ChatService({dataDir, ...options}); await service.init();
  t.after(async () => { await service.close(); await rm(dataDir, {recursive:true, force:true}); });
  return {service, dataDir};
}
test('deletion preserves other bots and settings, and an empty workspace survives restart', async t => {
  const {service, dataDir} = await fixture(t);
  const original = service.snapshot();
  await service.createBot({name:'Delete me', instructions:'Test'});
  const target = service.snapshot().activeBotId;
  await service.newConversation({botId:target});
  const targetChat = service.snapshot().activeConversationId;
  await service.setDraft({conversationId:targetChat, text:'Discard with this bot'});
  await service.createBot({name:'Keep me', instructions:'Keep these instructions'});
  const keep = service.snapshot();
  const result = await service.deleteBot({id:target});
  assert.equal(result.activeBotId, keep.activeBotId);
  assert.deepEqual(result.settings, original.settings);
  assert.deepEqual(result.bots, keep.bots.filter(b => b.id !== target));
  assert.deepEqual(result.conversations, keep.conversations.filter(c => c.botId !== target));
  await assert.rejects(service.deleteBot({id:target}), /not found/);
  assert.deepEqual(service.snapshot(), result);
  await service.deleteBot({id:keep.activeBotId});
  assert.equal(service.snapshot().activeBotId, original.activeBotId);
  await service.deleteBot({id:original.activeBotId});
  assert.deepEqual(service.snapshot().bots, []);
  assert.deepEqual(service.snapshot().conversations, []);
  assert.equal(service.snapshot().activeBotId, null);
  const restart = new ChatService({dataDir}); await restart.init(); t.after(() => restart.close());
  assert.deepEqual(restart.snapshot(), service.snapshot());
  await restart.createBot({name:'Fresh start', promptMode:'auto'});
  assert.equal(restart.snapshot().bots.length, 1);
  assert.equal(restart.snapshot().conversations[0].messages.length, 2);
});
test('deletion aborts the target response without stopping another bot or resurrecting chats', async t => {
  let release, targetSignal;
  const hold = new Promise(resolve => {release=resolve;});
  const backend = async function* ({bot, signal}) {
    if (bot.name === 'Target') {
      targetSignal=signal; yield 'Partial'; signal.throwIfAborted();
      await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), {once:true}));
    } else { await hold; yield 'Other reply'; }
  };
  const {service} = await fixture(t, {backend});
  const original = service.snapshot();
  await service.send({conversationId:original.activeConversationId, text:'Continue independently'});
  await service.createBot({name:'Target', instructions:'Test'});
  const target=service.snapshot();
  await service.send({conversationId:target.activeConversationId, text:'Stop on deletion'});
  await service.deleteBot({id:target.activeBotId});
  assert.equal(targetSignal.aborted, true);
  assert.equal(service.tasks.size, 1);
  release(); await service.whenIdle();
  assert.equal(service.snapshot().conversations.length, 1);
  assert.equal(service.snapshot().conversations[0].messages.at(-1).content, 'Other reply');
});
test('deleting during the first save waits for task initialization and prevents backend startup', async t => {
  let called=false;
  const {service} = await fixture(t, {backend:async function* () {called=true;yield 'Should not run';}});
  let release; const hold=new Promise(resolve=>{release=resolve;});
  const save=service.store.save.bind(service.store); let block=true;
  service.store.save=async state=>{if(block){block=false;await hold;}return save(state);};
  const state=service.snapshot();
  const sending=service.send({conversationId:state.activeConversationId,text:'Racing deletion'});
  const deleting=service.deleteBot({id:state.activeBotId});
  release(); await Promise.all([sending,deleting]); await service.whenIdle();
  assert.equal(called,false); assert.equal(service.snapshot().bots.length,0);
  assert.equal(service.tasks.size,0);
});
