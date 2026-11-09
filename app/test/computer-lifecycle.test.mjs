import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {CloudComputer} from '../src/cloud-computer.mjs';
const connection={value:{cloud:{endpoint:'https://computer.example',token:'test'}}};
const image=Buffer.from('fixture'),sha256=createHash('sha256').update(image).digest('hex');
const result=body=>!body.auditContext?Response.json({human:false}):Response.json({browserObservation:{url:'https://computer.example/start'},output:'Ready',argumentDigest:body.auditContext.argumentDigest,receiptId:'runner-fixture-1234',visualArtifact:{mimeType:'image/png',dataBase64:image.toString('base64'),sha256,currentUrl:'https://computer.example/start',pageTitle:'Ready'}});
test('starting is deduplicated and ready means a verified first screen exists',async()=>{
 let complete,calls=0;const states=[];const cloud=new CloudComputer(connection,{onState:s=>states.push(s.status),fetcher:async(url,options)=>{if(url.endsWith('/browser-control'))return Response.json({human:false});calls++;return new Promise(resolve=>{complete=()=>resolve(result(JSON.parse(options.body)));});}});
 const first=cloud.start({botId:'bot',conversationId:'conversation'}),second=cloud.start({botId:'bot',conversationId:'conversation'});assert.equal(first,second);assert.equal(cloud.state('conversation').status,'starting');
 await new Promise(r=>setImmediate(r));complete();const snapshot=await first;assert.equal(snapshot.state.status,'ready');assert.ok(snapshot.frame);assert.equal(calls,1);
 await cloud.start({botId:'bot',conversationId:'conversation'});assert.equal(calls,1);assert.deepEqual(states,['starting','ready']);
});
test('stopping a startup prevents its late screen from resurrecting the computer',async()=>{
 let complete;const cloud=new CloudComputer(connection,{fetcher:async(url,options)=>url.endsWith('/browser-control')?Response.json({human:false}):url.endsWith('/dispose')?Response.json({ok:true}):new Promise(resolve=>{complete=()=>resolve(result(JSON.parse(options.body)));})});
 const starting=cloud.start({botId:'bot',conversationId:'conversation'});await new Promise(r=>setImmediate(r));const stopping=cloud.dispose('bot','conversation');complete();
 await assert.rejects(starting,/cancelled/);await stopping;assert.equal(cloud.state('conversation').status,'stopped');assert.equal(cloud.frames.has('conversation'),false);
});
test('a startup error is visible and a later start retries',async()=>{
 let fail=true;const cloud=new CloudComputer(connection,{fetcher:async(url,options)=>{if(fail)throw new Error('Temporary connection problem');return result(JSON.parse(options.body));}});
 await assert.rejects(cloud.start({botId:'bot',conversationId:'conversation'}),/Temporary/);assert.equal(cloud.state('conversation').status,'error');fail=false;
 assert.equal((await cloud.start({botId:'bot',conversationId:'conversation'})).state.status,'ready');
});

test('a navigation failure preserves its last screen and is not mislabeled as a startup failure',async()=>{
 let fail=false;const cloud=new CloudComputer(connection,{fetcher:async(url,options)=>fail?Response.json({output:'Sandbox action failed: navigation timeout',argumentDigest:JSON.parse(options.body).auditContext.argumentDigest,receiptId:'runner-fixture-1234'}):result(JSON.parse(options.body))});
 await cloud.start({botId:'bot',conversationId:'conversation'});const frame=cloud.frames.get('conversation');fail=true;
 await assert.rejects(cloud.execute({botId:'bot',conversationId:'conversation',name:'browse_url',args:{url:'https://slow.example'}}),/navigation timeout/);assert.equal(cloud.state('conversation').status,'attention');assert.equal(cloud.frames.get('conversation'),frame);
});
test('stop aborts a stalled manual request and clears its screen',async()=>{
 let entered;const started=new Promise(r=>entered=r);let stall=false;
 const cloud=new CloudComputer(connection,{fetcher:async(url,options)=>{if(url.endsWith('/dispose'))return Response.json({ok:true});if(!stall)return result(JSON.parse(options.body));entered();return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));}});
 await cloud.start({botId:'bot',conversationId:'conversation'});stall=true;const action=cloud.execute({botId:'bot',conversationId:'conversation',name:'inspect_page',args:{}});const rejected=assert.rejects(action,/Stopped/);await started;await cloud.dispose('bot','conversation');await rejected;assert.equal(cloud.state('conversation').status,'stopped');assert.equal(cloud.frames.size,0);
});
test('browser restart closes only the browser then obtains a new screen',async()=>{
 const calls=[];const cloud=new CloudComputer(connection,{fetcher:async(url,options)=>{calls.push(url);return url.endsWith('/restart-browser')?Response.json({ok:true}):result(JSON.parse(options.body));}});
 await cloud.start({botId:'bot',conversationId:'conversation'});await cloud.start({botId:'bot',conversationId:'conversation',restart:true});assert.equal(calls.filter(url=>url.endsWith('/restart-browser')).length,1);assert.ok(calls.at(-1).endsWith('/execute'));assert.equal(cloud.state('conversation').status,'ready');assert.ok(!calls.some(url=>url.endsWith('/dispose')));
});
test('a transient connection failure retries the identical action receipt, without duplicating the action',async()=>{
 const payloads=[];const cloud=new CloudComputer(connection,{fetcher:async(url,options)=>{payloads.push(options.body);if(payloads.length===1)throw new TypeError('fetch failed');return result(JSON.parse(options.body));}});
 await cloud.execute({botId:'bot',conversationId:'conversation',name:'browse_url',args:{url:'https://example.com'}});assert.equal(payloads.length,2);assert.equal(payloads[0],payloads[1]);assert.equal(cloud.state('conversation').status,'ready');
});
test('an already-started agent action drains before takeover even when the model is aborted',async()=>{
 let finish,entered;const started=new Promise(r=>entered=r);const controller=new AbortController();
 const cloud=new CloudComputer(connection,{fetcher:async(_url,options)=>{entered();return new Promise(resolve=>{finish=()=>resolve(result(JSON.parse(options.body)));});}});
 const action=cloud.execute({botId:'bot',conversationId:'conversation',name:'click_screen',args:{x:1,y:1},signal:controller.signal,finishStarted:true});await started;controller.abort();let idle=false;const drained=cloud.whenIdle('conversation').then(()=>idle=true);await new Promise(r=>setImmediate(r));assert.equal(idle,false);finish();await action;await drained;assert.equal(idle,true);
});
test('tool observations update the address without replacing the newer live image',async()=>{
 const frames=[];const cloud=new CloudComputer(connection,{onFrame:f=>frames.push(f),fetcher:async(_url,options)=>result(JSON.parse(options.body))});const previous={conversationId:'conversation',botId:'bot',dataUrl:'data:image/jpeg;base64,bGl2ZQ==',url:'https://old.example',at:123};cloud.frames.set('conversation',previous);cloud.live.set('conversation',{ready:true,url:'https://current.example/?manual=changed'});await cloud.execute({botId:'bot',conversationId:'conversation',name:'capture_screen'});assert.equal(cloud.frames.get('conversation').dataUrl,previous.dataUrl);assert.equal(cloud.frames.get('conversation').url,'https://current.example/?manual=changed');assert.equal(frames.at(-1).at,123);
});
