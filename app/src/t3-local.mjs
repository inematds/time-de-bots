import {access,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
export class T3LocalHost {
 constructor({home,installer,execute=exec,onProgress=()=>{}}){Object.assign(this,{home,installer,execute,onProgress});this.pending=null;}
 async running(){for(const home of [this.home,join(homedir(),'.t3')]){try{const state=JSON.parse(await readFile(join(home,'userdata/server-runtime.json'),'utf8'));if(!Number.isInteger(state.pid)||state.pid<1)continue;process.kill(state.pid,0);const url=new URL(state.origin);if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))continue;return{endpoint:url.origin+'/mcp',home,owned:home===this.home,version:state.serverVersion};}catch{}}return null;}
 async setup(){if(this.pending)return this.pending;this.pending=this.install().finally(()=>{this.pending=null;});return this.pending;}
 async binary(host){for(const candidate of [join(host.home,'bin/t3'),join(homedir(),'.local/bin/t3'),'/opt/homebrew/bin/t3','/usr/local/bin/t3']){try{await access(candidate);return candidate;}catch{}}throw new Error('The T3 command could not be found on this Mac.');}
 async registerProject(host,folder){await this.execute(await this.binary(host),['project','add','--base-dir',host.home,folder],{env:{...process.env,T3CODE_HOME:host.home},timeout:30000,maxBuffer:100000});}
 async browserLink(host,threadId){
  const {stdout}=await this.execute(await this.binary(host),['auth','pairing','create','--base-dir',host.home,'--scope','orchestration:read','--scope','orchestration:operate','--scope','filesystem:read','--scope','preview:operate','--ttl','5m','--label','Gratis browser handoff','--json'],{env:{...process.env,T3CODE_HOME:host.home},timeout:20000,maxBuffer:100000});
  const value=JSON.parse(stdout),environmentId=(await readFile(join(host.home,'userdata/environment-id'),'utf8')).trim();
  if(typeof value.credential!=='string'||!environmentId)throw new Error('Could not prepare the local T3 view.');
  const url=new URL('/'+encodeURIComponent(environmentId)+'/'+encodeURIComponent(threadId),host.endpoint);url.hash=new URLSearchParams({token:value.credential}).toString();return url.href;
 }
 async authorize(host){
  const binary=await this.binary(host);
  const {stdout}=await this.execute(binary,['auth','session','issue','--base-dir',host.home,'--subject','mcp-client','--label','Gratis desktop','--scope','orchestration:read','--scope','orchestration:operate','--ttl','30d','--token-only'],{env:{...process.env,T3CODE_HOME:host.home},timeout:20000,maxBuffer:100000});
  const token=stdout.trim();if(!token||/\s/.test(token))throw new Error('T3 did not return a usable local connection credential.');return token;
 }
 async install(){
  const running=await this.running();if(running)return running;
  const binary=join(this.home,'bin/t3'),env={...process.env,T3CODE_HOME:this.home,T3CODE_VERSION:'0.1.7',T3CODE_INSTALL_BIN_DIR:join(this.home,'bin')};
  try{await access(binary);}catch{
   this.onProgress('Downloading and verifying T3…');await mkdir(this.home,{recursive:true,mode:0o700});const script=join(this.home,'install-t3.sh');await writeFile(script,await readFile(this.installer),{mode:0o700});
   try{await this.execute('/bin/sh',[script],{env,timeout:300000,maxBuffer:1000000});}finally{await rm(script,{force:true});}
  }
  this.onProgress('Starting the T3 background service…');await this.execute(binary,['service','install','--base-dir',this.home],{env,timeout:120000,maxBuffer:1000000});
  for(let i=0;i<60;i++){const result=await this.running();if(result)return result;await new Promise(resolve=>setTimeout(resolve,500));}
  throw new Error('T3 was installed but its service did not become ready. Open T3 to check its status.');
 }
}
