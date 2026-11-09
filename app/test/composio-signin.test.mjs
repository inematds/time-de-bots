import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,readFile,writeFile,rm,readdir} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {ComposioSignIn} from '../src/composio-signin.mjs';
test('browser sign-in provisions through the supported CLI and keeps keys out of public state',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'gratis-login-'));t.after(()=>rm(directory,{recursive:true,force:true}));let configured,opened;const calls=[];
 const signIn=new ComposioSignIn({directory,binary:process.execPath,connections:{connectComposio:async key=>{configured={composioKey:key};}},openExternal:async url=>{opened=url;},execute:async(binary,args,options)=>{
   calls.push(args);if(args.includes('--no-wait'))await writeFile(join(options.cwd,'pending-login-session.json'),JSON.stringify({loginUrl:'https://dashboard.composio.dev/login?fixture=1'}));
   if(args.includes('--poll'))await writeFile(join(options.cwd,'.env.local'),'COMPOSIO_API_KEY="ak_fixture_secret"\n');return {stdout:'',stderr:''};
 }});
 await signIn.start();const job=signIn.job;await job?.promise;assert.equal(signIn.state().status,'connected');assert.equal(configured.composioKey,'ak_fixture_secret');assert.match(opened,/dashboard.composio.dev/);assert.equal(JSON.stringify(signIn.state()).includes('secret'),false);assert.ok(calls.some(a=>a.includes('--poll')));assert.deepEqual(await readdir(join(directory,'composio-signin')),[]);
});
test('an unexpected login host is rejected before opening the browser',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'gratis-login-'));t.after(()=>rm(directory,{recursive:true,force:true}));let opened=false;
 const signin=new ComposioSignIn({directory,binary:process.execPath,connections:{},openExternal:async()=>{opened=true;},execute:async(binary,args,options)=>{await writeFile(join(options.cwd,'pending-login-session.json'),JSON.stringify({loginUrl:'https://evil.example/'}));return{};}});
 await assert.rejects(signin.start(),/unexpected/);assert.equal(opened,false);assert.equal(signin.state().status,'error');
});

const response=(value,status=200)=>({ok:status>=200&&status<300,status,json:async()=>value});
async function recoveryFixture(t,{request,connectComposio=async()=>{},withProject=true}={}){
 const directory=await mkdtemp(join(tmpdir(),'gratis-login-recovery-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const calls=[],opened=[];let configured;
 const connections={encrypt:text=>Buffer.from(text).map(b=>b^42),decrypt:buffer=>Buffer.from(buffer).map(b=>b^42).toString(),connectComposio:async key=>{await connectComposio(key);configured=key;}};
 const execute=async(binary,args,options)=>{calls.push(args);
  if(args.includes('--no-wait'))await writeFile(join(options.cwd,'pending-login-session.json'),JSON.stringify({loginUrl:'https://dashboard.composio.dev/login?fixture=1'}));
  if(args.includes('--poll'))await writeFile(join(options.cwd,'user_data.json'),JSON.stringify({api_key:'uak_fixture_private',org_id:'org_fixture',base_url:'https://backend.composio.dev'}));
  if(args.includes('init')&&withProject){await mkdir(join(options.cwd,'.composio'));await writeFile(join(options.cwd,'.composio/project.json'),JSON.stringify({org_id:'org_fixture',project_id:'project_fixture'}));}
  return {stdout:'Project initialized. Warning: could not decode API key response.',stderr:''};
 };
 const options={directory,binary:process.execPath,connections,openExternal:async url=>opened.push(url),execute,request};
 return {options,calls,opened,get configured(){return configured;}};
}
test('browser authentication without .env.local resolves the existing project key using session API',async t=>{
 const requests=[];const fixture=await recoveryFixture(t,{request:async(url,options)=>{requests.push({url,options});return response({api_key:{key:'ak_existing_private'},new_server_field:true});}});
 const signIn=new ComposioSignIn(fixture.options);await signIn.start();await signIn.job?.promise;
 assert.equal(signIn.state().status,'connected');assert.equal(fixture.configured,'ak_existing_private');assert.equal(requests.length,1);
 assert.equal(requests[0].options.headers['x-user-api-key'],'uak_fixture_private');assert.equal(requests[0].options.headers['x-org-id'],'org_fixture');assert.equal(fixture.calls.some(a=>a.includes('init')),false);
 assert.equal(JSON.stringify(signIn.state()).includes('private'),false);await assert.rejects(readFile(signIn.recovery),{code:'ENOENT'});
});
test('temporary provisioning failure preserves encrypted sign-in and resumes after restart without browser login',async t=>{
 let available=false;const fixture=await recoveryFixture(t,{request:async()=>response(available?{api_key:{key:'ak_recovered_private'}}:{},available?200:503)});
 let signIn=new ComposioSignIn(fixture.options);await signIn.start();await signIn.job?.promise;
 assert.equal(signIn.state().status,'error');assert.match(signIn.state().error,/503/);const saved=await readFile(signIn.recovery);assert.equal(saved.toString().includes('uak_fixture'),false);
 available=true;signIn=new ComposioSignIn(fixture.options);await signIn.start();await signIn.job?.promise;
 assert.equal(signIn.state().status,'connected');assert.equal(fixture.opened.length,1);assert.equal(fixture.calls.filter(a=>a.includes('--poll')).length,1);
});
test('fresh accounts use project-scoped user credentials without creating an API key',async t=>{
 let requests=0;const fixture=await recoveryFixture(t,{request:async(url,options)=>{requests++;assert.equal(options.method,undefined);return response({api_key:null,project:{id:'internal-id',nano_id:'proj_fixture',org:{nano_id:'org_fixture'}}});}});
 const signIn=new ComposioSignIn(fixture.options);await signIn.start();await signIn.job?.promise;
 assert.equal(signIn.state().status,'connected');assert.equal(requests,1);assert.deepEqual(fixture.configured,{apiKey:null,userApiKey:'uak_fixture_private',orgId:'org_fixture',projectId:'proj_fixture'});
 assert.equal(JSON.stringify(signIn.state()).includes('private'),false);
});
test('a fresh account can retry failed SDK validation without reauthentication or key creation',async t=>{
 let valid=false,requests=0;const fixture=await recoveryFixture(t,{request:async(url,options)=>{requests++;assert.equal(options.method,undefined);return response({api_key:null,project:{nano_id:'proj_fixture'}});},connectComposio:async()=>{if(!valid)throw new Error('Service unavailable');}});
 const signIn=new ComposioSignIn(fixture.options);await signIn.start();await signIn.job?.promise;assert.equal(signIn.state().status,'error');valid=true;
 await signIn.start();await signIn.job?.promise;assert.equal(signIn.state().status,'connected');assert.equal(requests,2);assert.equal(fixture.opened.length,1);
});
test('cancel clears encrypted sign-in recovery',async t=>{
 const fixture=await recoveryFixture(t,{request:async()=>response({},401)});const signIn=new ComposioSignIn(fixture.options);await signIn.start();await signIn.job?.promise;
 assert.match(signIn.state().error,/sign in again/);await signIn.cancel();await assert.rejects(readFile(signIn.recovery),{code:'ENOENT'});
});

test('unexpected credential issuer is rejected without transmitting its token',async t=>{
 let requests=0;const fixture=await recoveryFixture(t,{request:async()=>{requests++;return response({});}});
 const execute=fixture.options.execute;fixture.options.execute=async(binary,args,options)=>{await execute(binary,args,options);if(args.includes('--poll'))await writeFile(join(options.cwd,'user_data.json'),JSON.stringify({api_key:'uak_untrusted_private',base_url:'https://untrusted.example',org_id:'org_fixture'}));return{};};
 const signIn=new ComposioSignIn(fixture.options);await signIn.start();await signIn.job?.promise;
 assert.equal(signIn.state().status,'error');assert.match(signIn.state().error,/different server/);assert.equal(requests,0);assert.equal(JSON.stringify(signIn.state()).includes('private'),false);
});
