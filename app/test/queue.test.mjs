import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';import {ChatService} from '../src/chat-service.mjs';
async function fixture(t){const dataDir=await mkdtemp(join(tmpdir(),'gratis-queue-')),seen=[];const backend=async function*({messages,signal}){seen.push(messages.at(-1).content);await delay(20,null,{signal});yield 'Done '+messages.at(-1).content;};const service=new ChatService({dataDir,backend});await service.init();t.after(async()=>{await service.close();await rm(dataDir,{recursive:true,force:true});});return {service,dataDir,seen};}
test('messages queue in order and share completed conversation history',async t=>{
 const {service,seen}=await fixture(t),conversationId=service.state.activeConversationId;
 await service.send({conversationId,text:'one'});await service.send({conversationId,text:'two'});await service.send({conversationId,text:'three'});
 assert.equal(service.state.conversations[0].queue.length,2);await service.whenIdle();
 assert.deepEqual(seen,['one','two','three']);assert.equal(service.state.conversations[0].messages.length,6);assert.equal(service.state.conversations[0].queue.length,0);
});
test('stop pauses the queue, removal persists, and restart requires resume',async t=>{
 const {service,dataDir,seen}=await fixture(t),conversationId=service.state.activeConversationId;
 await service.send({conversationId,text:'one'});await service.send({conversationId,text:'two'});await service.send({conversationId,text:'three'});
 await service.stop({conversationId});assert.equal(service.state.conversations[0].queuePaused,true);assert.equal(seen.length,1);
 const id=service.state.conversations[0].queue[1].id;await service.updateQueue({conversationId,id,action:'remove'});await service.close();
 const restart=new ChatService({dataDir,backend:async function*(){yield 'resumed';}});await restart.init();t.after(()=>restart.close());
 assert.equal(restart.state.conversations[0].queue.length,1);assert.equal(restart.tasks.size,0);
 await restart.updateQueue({conversationId,action:'resume'});await restart.whenIdle();assert.equal(restart.state.conversations[0].messages.at(-1).content,'resumed');
});
