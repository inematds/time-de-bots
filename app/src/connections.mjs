import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Composio} from '@composio/core';

// Credentials never enter workspace snapshots or the renderer.
export class Connections {
  constructor({directory,encrypt,decrypt,createClient=credential=>new Composio(typeof credential==='string'?{apiKey:credential}:credential)}){this.directory=directory;this.encrypt=encrypt;this.decrypt=decrypt;this.createClient=createClient;this.value={userId:randomUUID()};this.sessionPromise=null;}
  async init(){await mkdir(this.directory,{recursive:true,mode:0o700});try{this.value=JSON.parse(this.decrypt(await readFile(join(this.directory,'connections.secure'))));}catch(error){if(error.code!=='ENOENT')throw new Error('Could not unlock saved connections.');}return this;}
  async save(){const temporary=join(this.directory,`.connections-${randomUUID()}`);await writeFile(temporary,this.encrypt(JSON.stringify(this.value)),{mode:0o600});await rename(temporary,join(this.directory,'connections.secure'));}
  status(){return {composio:!!(this.value.composioKey||this.value.composioAccount),cloud:!!this.value.cloud?.token,cloudEndpoint:this.value.cloud?.endpoint||''};}
  async configure({composioKey,cloudEndpoint,cloudToken}={}){
    if(composioKey!==undefined){if(typeof composioKey!=='string'||composioKey.length>2000)throw new Error('Invalid Composio key.');this.value.composioKey=composioKey.trim();delete this.value.composioAccount;delete this.value.sessionId;this.sessionPromise=null;}
    if(cloudEndpoint!==undefined||cloudToken!==undefined){const endpoint=cloudEndpoint||this.value.cloud?.endpoint;const token=cloudToken||this.value.cloud?.token;const url=new URL(endpoint);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new Error('The cloud computer needs a secure HTTPS endpoint.');if(typeof token!=='string'||token.length<16||token.length>4096)throw new Error('Invalid cloud computer credential.');this.value.cloud={endpoint:url.origin,token};}
    await this.save();return this.status();
  }
  async connectComposio(key,{signal}={}){
    if(typeof key!=='string'&&(!key||key.apiKey!==null||typeof key.userApiKey!=='string'||!key.userApiKey.startsWith('uak_')||!key.orgId||!key.projectId))throw new Error('Composio did not provide a valid account scope.');
    const session=await this.createClient(key).create(this.value.userId,{mcp:true});
    signal?.throwIfAborted();
    const previous=this.value,previousSession=this.sessionPromise;
    this.value={...previous,composioKey:typeof key==='string'?key:undefined,composioAccount:typeof key==='string'?undefined:key,sessionId:session.sessionId};this.sessionPromise=Promise.resolve(session);
    try{await this.save();}catch(error){this.value=previous;this.sessionPromise=previousSession;throw error;}
    return this.status();
  }
  async session(){
    if(!this.value.composioKey&&!this.value.composioAccount)throw new Error('Connect Composio in Settings → Connections first.');
    if(!this.sessionPromise)this.sessionPromise=(async()=>{
      const client=this.createClient(this.value.composioAccount||this.value.composioKey);
      if(this.value.sessionId){try{return await client.use(this.value.sessionId,{mcp:true});}catch{delete this.value.sessionId;}}
      const session=await client.create(this.value.userId,{mcp:true});this.value.sessionId=session.sessionId;await this.save();return session;
    })().catch(error=>{this.sessionPromise=null;throw error;});
    return this.sessionPromise;
  }
  async catalog(options={}){const {search='',cursor}=typeof options==='string'?{search:options}:options;const session=await this.session();const result=await session.toolkits({limit:50,...(search?{search:String(search).slice(0,100)}:{}),...(cursor?{cursor:String(cursor)}:{})});return {items:result.items.map(item=>({slug:item.slug,name:item.name,connected:!!item.connection?.isActive,noAuth:item.isNoAuth})),cursor:result.cursor||null};}
  async connect(slug){if(typeof slug!=='string'||!/^[a-z0-9_-]{1,80}$/.test(slug))throw new Error('Choose an app from the list.');const result=await(await this.session()).authorize(slug);const url=new URL(result.redirectUrl);if(url.protocol!=='https:')throw new Error('The provider returned an unsafe sign-in link.');void result.waitForConnection(600000).then(()=>this.onChange?.()).catch(()=>this.onChange?.());return url.href;}
  async mcp(){const session=await this.session();const {type,url,headers}=session.mcp;return {type,url,headers};}
}
