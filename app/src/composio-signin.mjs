import {access,mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
const message=error=>error.code==='ENOENT'?'Composio did not finish preparing your account. Retry connection to continue, or cancel sign-in to start again.':String(error.message||error).replace(/(?:uak_|ak_|ck_|gsk_)[\w-]+/g,'[redacted]').replace(/https?:\/\/\S+/g,'[sign-in URL]').slice(0,400);
const savedFiles=['user_data.json','config.json','.composio/project.json','.env.local'];
const projectKey=value=>typeof value==='string'&&/^ak_[\w-]+$/.test(value)?value:null;
const keyFromEnv=source=>{const entry=source.split(/\r?\n/).find(line=>/^\s*(?:export\s+)?COMPOSIO_API_KEY\s*=/.test(line));return projectKey(entry?.slice(entry.indexOf('=')+1).trim().replace(/^['"]|['"]$/g,''));};

// Use Composio's supported browser sign-in flow in an app-private cache.
// CLI output and cached credentials never cross the renderer boundary.
export class ComposioSignIn {
  constructor({directory,binary,connections,openExternal,onState=()=>{},execute=exec,request=fetch}){Object.assign(this,{directory,binary,connections,openExternal,onState,execute,request});this.current={status:'idle'};this.job=null;this.recovery=join(directory,'composio-signin.secure');}
  state(){return this.current;}
  update(status,error){this.current={status,...(error?{error}:{}),updatedAt:Date.now()};this.onState(this.current);return this.current;}
  async command(job,args,timeout=30000){const env={HOME:process.env.HOME,USER:process.env.USER,PATH:process.env.PATH,TMPDIR:process.env.TMPDIR,LANG:process.env.LANG||'en_US.UTF-8',COMPOSIO_CACHE_DIR:job.cache};return this.execute(this.binary,args,{cwd:job.cache,env,signal:job.controller.signal,timeout,maxBuffer:1000000});}
  async checkpoint(job){
    if(!this.connections.encrypt)return;
    const files={};for(const name of savedFiles){try{files[name]=await readFile(join(job.cache,name),'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}}
    if(!files['user_data.json'])return;
    const temporary=this.recovery+'.tmp';await writeFile(temporary,this.connections.encrypt(JSON.stringify({files})),{mode:0o600});await rename(temporary,this.recovery);
  }
  async restore(job){
    if(!this.connections.decrypt)return false;
    let saved;try{saved=JSON.parse(this.connections.decrypt(await readFile(this.recovery)));}catch(error){if(error.code==='ENOENT')return false;throw new Error('Could not unlock your saved Composio sign-in. Cancel sign-in to start again.');}
    for(const name of savedFiles){if(typeof saved.files?.[name]!=='string')continue;await mkdir(join(job.cache,name,'..'),{recursive:true,mode:0o700});await writeFile(join(job.cache,name),saved.files[name],{mode:0o600});}
    return true;
  }
  async start(){
    if(this.job)return this.state();
    await access(this.binary);const cache=join(this.directory,'composio-signin',randomUUID());await mkdir(cache,{recursive:true,mode:0o700});
    const job={cache,controller:new AbortController(),url:null,promise:null};this.job=job;this.update('opening');
    try{
      if(await this.restore(job)){this.update('configuring');job.promise=this.finish(job,true);return this.state();}
      // Only this short-lived private cache uses JSON credentials. They are
      // encrypted for recovery and removed from disk when the attempt finishes.
      await writeFile(join(cache,'config.json'),JSON.stringify({security:'json'}),{mode:0o600});
      await this.command(job,['login','--no-wait','--no-skill-install']);
      const pending=JSON.parse(await readFile(join(cache,'pending-login-session.json'),'utf8'));
      const url=new URL(pending.loginUrl);
      if(url.protocol!=='https:'||url.username||url.password||!(url.hostname==='composio.dev'||url.hostname.endsWith('.composio.dev')))throw new Error('Composio returned an unexpected sign-in address.');
      job.url=url.href;await this.openExternal(job.url);this.update('waiting');
      job.promise=this.finish(job);return this.state();
    }catch(error){if(this.job===job){this.job=null;this.update('error',message(error));}await rm(cache,{recursive:true,force:true});if(job.controller.signal.aborted)return this.state();throw new Error(message(error));}
  }
  async resolveCredential(job){
    try{const key=keyFromEnv(await readFile(join(job.cache,'.env.local'),'utf8'));if(key)return key;}catch(error){if(error.code!=='ENOENT')throw error;}
    // Resolve the project with the account API. CLI dev init's optional .env
    // output is not a reliable handoff contract for a desktop application.
    // Never use a user key as a project key.
    const user=JSON.parse(await readFile(join(job.cache,'user_data.json'),'utf8'));
    let project={};try{project=JSON.parse(await readFile(join(job.cache,'.composio/project.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
    if(user.base_url&&new URL(user.base_url).origin!=='https://backend.composio.dev')throw new Error('This Composio account uses a different server. Add its project key in Advanced settings.');
    if(!user.api_key)throw new Error('Composio sign-in did not return a usable account credential. Cancel sign-in, then sign in again.');
    const org=project.org_id||user.org_id,projectId=project.project_id||user.project_id;
    const headers={'x-user-api-key':user.api_key,...(org?{'x-org-id':org}:{}),...(projectId?{'x-project-id':projectId}:{})};
    const call=async(path,options={})=>{
      const response=await this.request('https://backend.composio.dev'+path,{...options,headers:{...headers,...options.headers},redirect:'error',signal:AbortSignal.any([job.controller.signal,AbortSignal.timeout(30000)])});
      if(!response.ok)throw new Error(response.status===401||response.status===403?'Composio needs you to sign in again. Cancel sign-in, then retry.':`Composio account setup is temporarily unavailable (HTTP ${response.status}). Retry connection to continue your saved sign-in.`);
      try{return await response.json();}catch{throw new Error('Composio returned an unreadable setup response. Retry connection to continue your saved sign-in.');}
    };
    const session=await call('/api/v3.1/auth/session/info');
    const existing=projectKey(session.api_key?.key);if(existing)return existing;
    const selected=session.project?.nano_id||projectId;
    const scopedOrg=session.project?.org?.nano_id||org;
    if(!selected||!scopedOrg)throw new Error('Your Composio account needs a developer project. Create one in Composio, then retry connection.');
    // SDK 0.28 supports a user credential scoped to one organization/project.
    // Fresh accounts have no project API key; no key creation is necessary.
    return {apiKey:null,userApiKey:user.api_key,orgId:scopedOrg,projectId:selected};
  }

  async finish(job,resuming=false){
    try{
      if(!resuming)await this.command(job,['login','--poll','--no-skill-install'],660000);job.controller.signal.throwIfAborted();this.update('configuring');await this.checkpoint(job);
      const key=await this.resolveCredential(job);job.controller.signal.throwIfAborted();
      await this.connections.connectComposio(key,{signal:job.controller.signal});job.controller.signal.throwIfAborted();await rm(this.recovery,{force:true});this.update('connected');
    }catch(error){if(!job.controller.signal.aborted)this.update('error',message(error));}
    finally{await rm(job.cache,{recursive:true,force:true});if(this.job===job)this.job=null;}
  }
  async reopen(){if(this.job?.url)await this.openExternal(this.job.url);return this.state();}
  async cancel({preserve=false}={}){const job=this.job;if(job){job.controller.abort();await job.promise?.catch(()=>{});await rm(job.cache,{recursive:true,force:true});if(this.job===job)this.job=null;}if(!preserve)await rm(this.recovery,{force:true});return this.update('idle');}
}
