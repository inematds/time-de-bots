import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {WorkspaceFiles} from '../src/workspace-files.mjs';
import {Connections} from '../src/connections.mjs';
import {ChatService} from '../src/chat-service.mjs';
test('bot files are isolated, persisted, bounded, and reject traversal and symlinks',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'gratis-files-'));t.after(()=>rm(dir,{recursive:true,force:true}));const files=new WorkspaceFiles(dir),a=randomUUID(),b=randomUUID();
 await files.write(a,'notes/work.md','Saved note');assert.equal(await files.read(a,'notes/work.md'),'Saved note');assert.equal((await files.list(b)).length,0);
 for(const path of ['../other','/etc/passwd','.secret/key','ok/../../out'])await assert.rejects(files.write(a,path,'bad'));
 await symlink(tmpdir(),join(files.root(a),'escape'));await assert.rejects(files.write(a,'escape/out','bad'),/symlink/);
 await assert.rejects(files.write(a,'big.txt','x'.repeat(200001)),/200 KB/);
});
test('connection snapshots never include secrets and encrypted settings survive restart',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'gratis-connections-'));t.after(()=>rm(directory,{recursive:true,force:true}));const options={directory,encrypt:s=>Buffer.from(s).reverse(),decrypt:b=>Buffer.from(b).reverse().toString()};
 const c=await new Connections(options).init();await c.configure({cloudEndpoint:'https://example.com',cloudToken:'private-credential',composioKey:'private-key'});
 assert.equal(JSON.stringify(c.status()).includes('private'),false);const next=await new Connections(options).init();assert.deepEqual(next.status(),c.status());
 await assert.rejects(c.configure({cloudEndpoint:'http://example.com',cloudToken:'private-credential'}),/HTTPS/);
});
test('approvals unblock tools only after the matching decision; stop cancels pending approvals',async t=>{
 const dataDir=await mkdtemp(join(tmpdir(),'gratis-approval-'));let runtime;
 const service=new ChatService({dataDir,runtimeFactory:args=>{runtime=args;return args;},backend:async function*({runtime}){const allowed=await runtime.approve('Create external item',{title:'Test'});yield allowed?'Allowed':'Denied';}});
 await service.init();t.after(async()=>{await service.close();await rm(dataDir,{recursive:true,force:true});});await service.updateBot({id:service.state.activeBotId,instructions:'Test tool permissions'});await service.updateSettings({...service.state.settings,provider:'claude',model:'haiku'});
 const conversationId=service.state.activeConversationId;await service.send({conversationId,text:'Test approval'});
 while(!service.approvals.size)await new Promise(r=>setTimeout(r,1));const id=[...service.approvals.keys()][0];
 await service.respondApproval({id,allow:true});await service.whenIdle();assert.equal(service.state.conversations[0].messages.at(-1).content,'Allowed');
 await assert.rejects(service.respondApproval({id,allow:true}),/no longer pending/);
 await service.send({conversationId,text:'Cancel this approval'});while(!service.approvals.size)await new Promise(r=>setTimeout(r,1));await service.stop({conversationId});assert.equal(service.approvals.size,0);assert.equal(service.state.conversations[0].messages.at(-1).status,'cancelled');
});

test('manual control prevents agent computer actions until the user returns control',async()=>{
 const {agentRuntime}=await import('../src/agent-tools.mjs');let human=true,calls=0;
 const runtime=await agentRuntime({bot:{id:'345fe4b3-f4f7-442e-a456-68559388fc7e',capabilities:{web:false,files:false,computer:true,connections:false}},conversationId:'test',files:{root:()=>'/private-test'},cloud:{execute:async()=>{calls++;return{output:'ready'};}},connections:{status:()=>({cloud:true})},signal:new AbortController().signal,onActivity:()=>{},approve:async()=>false,canUseComputer:()=>!human});
 const computer=runtime.definitions.find(t=>t.name==='computer');const denied=await computer.handler({action:'capture_screen',args:{}});assert.equal(denied.isError,true);assert.equal(calls,0);human=false;const allowed=await computer.handler({action:'capture_screen',args:{}});assert.ok(!allowed.isError);assert.equal(calls,1);
});
