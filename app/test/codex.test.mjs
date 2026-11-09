import {join} from 'node:path';
import {tmpdir} from 'node:os';
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';import {resolve} from 'node:path';
import {createCodexReply,isolatedCodexConfig} from '../src/codex-backend.mjs';
import {codexEnvironment,codexLauncher} from '../src/codex-client.mjs';
import {createCodexBridge} from '../src/codex-mcp.mjs';import {agentRuntime} from '../src/agent-tools.mjs';import {WorkspaceFiles} from '../src/workspace-files.mjs';import {ChatService} from '../src/chat-service.mjs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const id='1cd03073-d571-46dd-b997-fcfb9d4b58b0',settings={provider:'codex',model:'gpt-test',effort:'medium'},bot={id,name:'Test',instructions:'Use concise sentences.'};
async function directory(t){const dir=await mkdtemp(join(tmpdir(),'gratis-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
async function collect(run){let text='';for await(const chunk of run)text+=chunk;return text;}
async function* success(){yield{type:'item.updated',item:{id:'a',type:'agent_message',text:'Hello'}};yield{type:'item.completed',item:{id:'a',type:'agent_message',text:'Hello'}};yield{type:'turn.completed',usage:{output_tokens:1}};}
test('Codex uses existing authentication without inheriting API keys or unrelated app secrets',async t=>{
 const env=codexEnvironment({HOME:'/test',PATH:'/bin',CODEX_HOME:'/private/codex',OPENAI_API_KEY:'secret',CODEX_API_KEY:'secret',GITHUB_TOKEN:'secret'});assert.equal(env.CODEX_HOME,'/private/codex');assert.equal(env.OPENAI_API_KEY,undefined);assert.equal(env.CODEX_API_KEY,undefined);assert.equal(env.GITHUB_TOKEN,undefined);
 const path=await codexLauncher(await directory(t),"/test/it's codex");const script=await readFile(path,'utf8');assert.match(script,/--ignore-user-config --ignore-rules/);assert.match(script,/'\\''/);assert.equal(isolatedCodexConfig.features.shell_tool,false);assert.equal(isolatedCodexConfig.features.plugins,false);
});
test('SDK streaming avoids duplicate text; session resume requires exact history and model',async t=>{
 const workspaceDir=await directory(t),calls=[];let metadata;const createClient=options=>{assert.equal(options.apiKey,undefined);return{startThread:opts=>{calls.push({opts});return{id,runStreamed:async prompt=>{calls.at(-1).prompt=prompt;return{events:success()};}}},resumeThread:(saved,opts)=>{calls.push({saved,opts});return{id,runStreamed:async prompt=>{calls.at(-1).prompt=prompt;return{events:success()};}}}};};
 const reply=createCodexReply({createClient,status:async()=>({signedIn:true}),resolveExecutable:async()=>'/fake/codex'}),args={workspaceDir,bot,settings,signal:new AbortController().signal,onMetadata:value=>metadata=value};
 assert.equal(await collect(reply({...args,messages:[{role:'user',content:'Hi'}]})),'Hello');const session=metadata.codexSession;assert.equal(metadata.usage.outputTokens,1);assert.equal(calls[0].opts.sandboxMode,'read-only');
 const messages=[{role:'user',content:'Hi'},{role:'assistant',content:'Hello'},{role:'user',content:'Again'}];await collect(reply({...args,messages,codexSession:session}));assert.equal(calls[1].saved,id);assert.equal(calls[1].prompt,'Again');
 await collect(reply({...args,settings:{...settings,model:'different'},messages,codexSession:session}));assert.equal(calls[2].saved,undefined);assert.match(calls[2].prompt,/Hi/);
});
test('Codex cancellation aborts the SDK turn and closes the private bridge',async t=>{
 const controller=new AbortController();let closed=false;const reply=createCodexReply({status:async()=>({signedIn:true}),resolveExecutable:async()=>'/fake',bridgeFactory:async()=>({url:'http://127.0.0.1:1234/mcp',token:'secret',close:async()=>{closed=true;}}),createClient:()=>({startThread:()=>({id,runStreamed:async(_,{signal})=>({events:(async function*(){controller.abort(new Error('Stopped'));signal.throwIfAborted();})()})})})});
 await assert.rejects(collect(reply({workspaceDir:await directory(t),bot,settings,messages:[{role:'user',content:'Hi'}],runtime:{mcpServers:{},capabilities:{},definitions:[]},signal:controller.signal})),/Stopped/);assert.ok(closed);
});
test('private Codex MCP authenticates, validates arguments, and preserves bot file isolation',async t=>{
 const files=new WorkspaceFiles(await directory(t)),signal=new AbortController().signal,runtime=await agentRuntime({bot:{...bot,capabilities:{web:false,computer:false,connections:false}},conversationId:id,files,connections:{status:()=>({})},onActivity:()=>{},approve:async()=>false,signal});
 const bridge=await createCodexBridge(runtime);t.after(()=>bridge.close());assert.equal((await fetch(bridge.url,{method:'POST'})).status,401);
 assert.equal((await fetch(bridge.url,{method:'POST',headers:{Authorization:'Bearer '+bridge.token,Origin:'https://untrusted.example'}})).status,401);
 const client=new Client({name:'test',version:'1'});await client.connect(new StreamableHTTPClientTransport(new URL(bridge.url),{requestInit:{headers:{Authorization:'Bearer '+bridge.token}}}));t.after(()=>client.close());
 assert.deepEqual((await client.listTools()).tools.map(t=>t.name),['list_files','read_file','write_file']);
 await client.callTool({name:'write_file',arguments:{path:'proof.txt',content:'verified'}});assert.equal(await files.read(id,'proof.txt'),'verified');
 const rejected=await client.callTool({name:'write_file',arguments:{path:'../../escape',content:'no'}});assert.equal(rejected.isError,true);
 const invalid=await client.callTool({name:'write_file',arguments:{path:42}});assert.equal(invalid.isError,true);
});
test('switching subscriptions preserves chat history and independent per-bot models',async t=>{
 const seen=[],service=new ChatService({dataDir:await directory(t),runtimeFactory:async()=>({}),backend:async function*(args){seen.push(args);yield 'Response';}});await service.init();const b=service.state.bots[0],c=service.state.conversations[0];await service.updateBot({id:b.id,instructions:'Manual',model:'haiku',codexModel:'gpt-bot'});
 await service.updateSettings({...service.state.settings,provider:'claude',model:'opus'});await service.send({conversationId:c.id,text:'First'});await service.whenIdle();
 await service.updateSettings({...service.state.settings,provider:'codex',model:'gpt-default'});await service.send({conversationId:c.id,text:'Second'});await service.whenIdle();
 assert.equal(seen[0].settings.model,'haiku');assert.equal(seen[1].settings.model,'gpt-bot');assert.equal(seen[1].messages.length,3);assert.equal(service.state.settings.providerDefaults.claude.model,'opus');
 await service.close();const reopened=new ChatService({dataDir:service.store.directory});await reopened.init();assert.equal(reopened.state.settings.provider,'codex');assert.equal(reopened.state.bots[0].model,'haiku');assert.equal(reopened.state.bots[0].codexModel,'gpt-bot');assert.equal(reopened.state.conversations[0].messages.length,4);await reopened.close();
});

test('changing recalled data keeps a Codex session warm; privacy changes require fresh context',async t=>{
 const calls=[];let metadata;const client={startThread:()=>thread(false),resumeThread:()=>thread(true)};function thread(resumed){calls.push({resumed});return{id,runStreamed:async prompt=>{calls.at(-1).prompt=prompt;return{events:success()};}};}const reply=createCodexReply({createClient:()=>client,status:async()=>({signedIn:true}),resolveExecutable:async()=>'/fake'}),common={bot,settings,workspaceDir:await directory(t),signal:new AbortController().signal,onMetadata:m=>metadata=m};let messages=[{role:'user',content:'Hi'}];await collect(reply({...common,messages,turnContext:'Preference A',contextEpoch:0}));const first=metadata.codexSession;messages.push({role:'assistant',content:'Hello'},{role:'user',content:'Next'});await collect(reply({...common,messages,codexSession:first,turnContext:'Preference B',contextEpoch:0}));assert.equal(calls[1].resumed,true);assert.match(calls[1].prompt,/Preference B/);const second=metadata.codexSession;messages.push({role:'assistant',content:'Hello'},{role:'user',content:'After forget'});await collect(reply({...common,messages,codexSession:second,turnContext:'',contextEpoch:1}));assert.equal(calls[2].resumed,false);await collect(reply({...common,messages:[{role:'user',content:'Background extraction'}],persistSession:false}));assert.match(await readFile(common.workspaceDir+'/codex-launcher','utf8'),/--ephemeral/);
});
