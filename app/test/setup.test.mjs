import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatService } from '../src/chat-service.mjs';

async function fixture(t, promptGenerator) {
  const dataDir = await mkdtemp(join(tmpdir(), 'gratis-setup-')), requests = [];
  const service = new ChatService({dataDir, promptGenerator, backend: async function* (request) {requests.push(request);yield 'Ready to help.';}});
  await service.init();t.after(async()=>{await service.close();await rm(dataDir,{recursive:true,force:true});});
  await service.createBot({name:'Planner', avatarShape:'cloud',avatarColor:'blue',promptMode:'auto'});
  return {service,requests,dataDir,conversationId:service.snapshot().activeConversationId};
}
test('first stated intention creates and persists instructions once; welcome cards stay out of model history',async t=>{
  const generations=[];const {service,requests,dataDir,conversationId}=await fixture(t,async request=>{generations.push(request);return 'Help plan vegetarian dinners with short shopping lists.';});
  assert.equal(service.snapshot().conversations.at(-1).messages.length,2);
  await service.send({conversationId,text:'Help me plan vegetarian dinners.'});await service.whenIdle();
  await service.send({conversationId,text:'Keep a shopping list too.'});await service.whenIdle();
  assert.equal(generations.length,1);assert.equal(generations[0].intention,'Help me plan vegetarian dinners.');
  assert.equal(requests[0].bot.instructions,'Help plan vegetarian dinners with short shopping lists.');
  assert.deepEqual(requests[0].messages,[{role:'user',content:'Help me plan vegetarian dinners.'}]);
  assert.equal(requests[1].messages.length,3);
  const reloaded=new ChatService({dataDir});await reloaded.init();t.after(()=>reloaded.close());
  const bot=reloaded.snapshot().bots.at(-1);assert.equal(bot.promptGenerated,true);assert.equal(bot.avatarShape,'cloud');assert.equal(bot.avatarColor,'blue');
});
test('failed setup can retry without duplicating first user message',async t=>{
 let calls=0;const {service,requests,conversationId}=await fixture(t,async()=>{if(++calls===1)throw new Error('Setup unavailable');return 'Help with the stated goal.';});
 await service.send({conversationId,text:'Help organize tasks.'});await service.whenIdle();
 assert.equal(service.snapshot().bots.at(-1).promptGenerated,false);assert.equal(requests.length,0);
 await service.retry({conversationId});await service.whenIdle();
 assert.equal(calls,2);assert.equal(requests.length,1);assert.equal(service.snapshot().conversations.at(-1).messages.filter(m=>m.role==='user').length,1);
});
test('manual edits made during setup are respected',async t=>{
 let release, started;const ready=new Promise(r=>started=r);const gate=new Promise(r=>release=r);
 const {service,requests,conversationId}=await fixture(t,async()=>{started();await gate;return 'Generated instructions';});
 await service.send({conversationId,text:'Help organize tasks.'});await ready;
 await service.updateBot({id:service.snapshot().activeBotId,instructions:'My chosen instructions'});release();await service.whenIdle();
 assert.equal(requests[0].bot.instructions,'My chosen instructions');assert.equal(service.snapshot().bots.at(-1).promptMode,'manual');
});
test('cancelled setup cannot persist instructions or start a reply',async t=>{
 let started;const ready=new Promise(r=>started=r);
 const {service,requests,conversationId}=await fixture(t,async({signal})=>{started();await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));return 'Too late';});
 await service.send({conversationId,text:'Help organize tasks.'});await ready;await service.stop({conversationId});
 assert.equal(service.snapshot().bots.at(-1).promptGenerated,false);assert.equal(requests.length,0);assert.equal(service.snapshot().conversations.at(-1).messages.at(-1).status,'cancelled');
});
