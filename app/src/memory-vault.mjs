import {randomBytes,randomUUID,createCipheriv,createDecipheriv,createHmac} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const clean=(v,max=4000)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw new Error('Enter memory text within the supported length.');return v.trim();};
export const memoryKey=value=>clean(value,120).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'_').replace(/^_|_$/g,'');
export const safeMemoryText=value=>String(value||'').replace(/\b(?:sk-(?:ant-)?[\w-]{16,}|Bearer\s+[\w.~+-]{16,})/gi,'[private credential]').replace(/\b(password|passphrase|api[_ -]?key|access[_ -]?token|secret)\s*[:=]\s*[^\s,;]+/gi,'$1: [private credential]');
export const sensitiveMemory=value=>/\b(password|passphrase|api[_ -]?key|access[_ -]?token|private key|credit card|social security|diagnos(?:is|ed)|religio(?:n|us)|sexual orientation|political affiliation)\b/i.test(value)||/\bsk-(?:ant-)?[\w-]{16,}\b/.test(value);
const initial=()=>({version:1,enabled:true,revision:0,privacyRevision:0,facts:[],episodes:[],tasks:{},jobs:[],completed:[],forgotten:[],cuts:{},changes:[]});
export class MemoryVault {
 constructor({directory,wrapKey,unwrapKey,now=()=>Date.now()}){this.directory=directory;this.wrapKey=wrapKey;this.unwrapKey=unwrapKey;this.now=now;this.tail=Promise.resolve();this.indexRevision=-1;}
 async init(){
  await mkdir(this.directory,{recursive:true,mode:0o700});this.path=join(this.directory,'memory.secure');this.keyPath=join(this.directory,'memory-key.secure');
  let wrapped;try{wrapped=await readFile(this.keyPath);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(wrapped){const decrypted=await this.unwrapKey(wrapped),text=typeof decrypted==='string'?decrypted:decrypted?.value;this.key=Buffer.from(text,'base64');if(this.key.length!==32)throw new Error('The memory key could not be opened.');if(decrypted?.rewrap)await this.atomic(this.keyPath,await this.wrapKey(text));}
  else {try{await readFile(this.path);throw new Error('The existing memory key is missing. The vault has been preserved.');}catch(e){if(e.code!=='ENOENT')throw e;}this.key=randomBytes(32);await this.atomic(this.keyPath,await this.wrapKey(this.key.toString('base64')));}
  try{const bytes=await readFile(this.path);if(bytes.subarray(0,4).toString()!=='GME1')throw new Error('format');const d=createDecipheriv('aes-256-gcm',this.key,bytes.subarray(4,16));d.setAuthTag(bytes.subarray(16,32));this.state=JSON.parse(Buffer.concat([d.update(bytes.subarray(32)),d.final()]).toString());if(this.state.version!==1||!Array.isArray(this.state.facts)||!Array.isArray(this.state.jobs)||!Array.isArray(this.state.forgotten))throw new Error('format');}
  catch(e){if(e.code!=='ENOENT')throw new Error('Memory could not be opened. Its encrypted files have been preserved.');this.state=initial();await this.persist();}
  this.db=new DatabaseSync(':memory:');this.db.exec('PRAGMA temp_store=MEMORY; CREATE VIRTUAL TABLE memory_search USING fts5(id UNINDEXED, body);');return this;
 }
 async atomic(path,bytes){const temp=path+'.'+randomUUID()+'.tmp';try{await writeFile(temp,bytes,{mode:0o600,flag:'wx'});await rename(temp,path);}finally{await unlink(temp).catch(()=>{});}}
 async persist(){const text=JSON.stringify(this.state);if(Buffer.byteLength(text)>64_000_000)throw new Error('Memory is full. Remove unused items before learning more.');const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',this.key,iv),payload=Buffer.concat([c.update(text,'utf8'),c.final()]);await this.atomic(this.path,Buffer.concat([Buffer.from('GME1'),iv,c.getAuthTag(),payload]));}
 mutate(fn){const job=this.tail.catch(()=>{}).then(async()=>{const before=structuredClone(this.state);try{const out=fn(this.state);this.state.revision++;await this.persist();return structuredClone(out);}catch(e){this.state=before;throw e;}});this.tail=job;return job;}
 snapshot(){return structuredClone(this.state);}
 allowed(context,row,seen=new Set()){if(!context.scopes.some(s=>s.type===row.scope&&s.id===row.scopeId)||seen.has(row.id))return false;if(!row.memoryRefs?.length)return true;seen.add(row.id);return row.memoryRefs.every(id=>{const dependency=this.state.facts.find(r=>r.id===id)||this.state.episodes.find(r=>r.id===id);return dependency&&this.allowed(context,dependency,new Set(seen));});}
 assertScope(context,scope,scopeId){if(!context.scopes.some(s=>s.type===scope&&s.id===scopeId))throw new Error('This memory belongs to a different context.');}
 stamp(action,item){this.state.changes.push({id:randomUUID(),action,memoryId:item?.id,scope:item?.scope,scopeId:item?.scopeId,at:this.now()});this.state.changes=this.state.changes.slice(-100);}
 digest(row){return createHmac('sha256',this.key).update(JSON.stringify([row.scope,row.scopeId,row.key])).digest('hex');}
 current(context,{at=this.now(),pending=false}={}){
  const facts=this.state.facts.filter(r=>this.allowed(context,r)&&!r.invalid&&r.validFrom<=at&&(!r.validTo||r.validTo>at)&&(!r.expiresAt||r.expiresAt>at)&&(pending||r.status==='confirmed'));
  return facts.sort((a,b)=>b.updatedAt-a.updatedAt);
 }
 rebuildIntervals(binding){const rows=this.state.facts.filter(r=>r.scope===binding.scope&&r.scopeId===binding.scopeId&&r.key===binding.key&&r.status==='confirmed'&&!r.invalid).sort((a,b)=>a.validFrom-b.validFrom);rows.forEach((r,i)=>r.validTo=rows[i+1]?.validFrom||null);}
 async remember(context,input,{manual=false,allowRelearn=false,generation}={}){
  const scope=input.scope||'thread',scopeId=input.scopeId;this.assertScope(context,scope,scopeId);
  const key=memoryKey(input.key||input.title),content=clean(input.content),title=clean(input.title||input.key,120),category=['about','preferences','work','projects','constraint','fact'].includes(input.category)?input.category:'fact';
  const source=input.source;if(!source||typeof source.messageId!=='string'||typeof source.conversationId!=='string'||typeof source.quote!=='string')throw new Error('A memory needs a source.');
  if(!manual&&sensitiveMemory(content+' '+source.quote))return{status:'skipped'};
  const validFrom=input.validFrom??source.at??this.now(),expiresAt=input.expiresAt??null;
  if(!Number.isSafeInteger(validFrom)||expiresAt!==null&&(!Number.isSafeInteger(expiresAt)||expiresAt<=validFrom))throw new Error('Choose a valid memory date range.');
  const status=manual||input.stated===true?'confirmed':'pending';
  return this.mutate(s=>{
   if(generation!==undefined&&generation!==s.privacyRevision)return{status:'cancelled'};
   const binding={scope,scopeId,key},digest=this.digest(binding);
   if(s.forgotten.includes(digest)&&!manual&&!allowRelearn)return{status:'forgotten'};
   if(manual||allowRelearn)s.forgotten=s.forgotten.filter(d=>d!==digest);
   const existing=s.facts.find(r=>r.scope===scope&&r.scopeId===scopeId&&r.key===key&&r.sources.some(x=>x.messageId===source.messageId));
   if(existing&&!manual)return{status:'duplicate',id:existing.id};
   const equal=s.facts.find(r=>r.scope===scope&&r.scopeId===scopeId&&r.key===key&&r.content===content&&!r.invalid&&r.status===status&&(r.validFrom===validFrom||r.validTo===null&&r.validFrom<=validFrom));
   if(equal){if(!equal.sources.some(x=>x.messageId===source.messageId))equal.sources.push(source);equal.updatedAt=this.now();return{status:'unchanged',id:equal.id};}
   const older=s.facts.filter(r=>r.scope===scope&&r.scopeId===scopeId&&r.key===key&&!r.invalid&&r.status==='confirmed');
   let resolvedStatus=status;
   if(!manual&&older.some(r=>r.pinned&&input.corrects!==r.id||r.validFrom===validFrom&&r.content!==content&&input.corrects!==r.id))resolvedStatus='pending';
   if(input.corrects){const old=s.facts.find(r=>r.id===input.corrects);if(!old||!this.allowed(context,old)||old.scope!==scope||old.scopeId!==scopeId||old.key!==key)throw new Error('The earlier memory is unavailable.');if(resolvedStatus==='confirmed'){old.invalid=true;}}
   const row={id:randomUUID(),scope,scopeId,key,title,content,category,status:resolvedStatus,pinned:manual,sources:[source],validFrom,validTo:null,expiresAt,createdAt:this.now(),updatedAt:this.now()};s.facts.push(row);this.rebuildIntervals(row);this.stamp(resolvedStatus==='pending'?'proposed':'learned',row);return{status:resolvedStatus,id:row.id};
  });
 }
 async revise(context,{id,content,title,category}){const old=this.state.facts.find(r=>r.id===id);if(!old||!this.allowed(context,old))throw new Error('Memory not found.');return this.remember(context,{scope:old.scope,scopeId:old.scopeId,key:old.key,title:title||old.title,content,category:category||old.category,validFrom:this.now(),corrects:id,source:{messageId:'manual-'+randomUUID(),conversationId:context.rootId,quote:content,at:this.now(),kind:'edited'}},{manual:true});}
 async confirm(context,id){return this.mutate(s=>{const row=s.facts.find(r=>r.id===id);if(!row||!this.allowed(context,row))throw new Error('Memory not found.');row.status='confirmed';row.pinned=true;row.updatedAt=this.now();const collision=s.facts.find(r=>r.id!==id&&r.scope===row.scope&&r.scopeId===row.scopeId&&r.key===row.key&&r.validFrom===row.validFrom&&r.status==='confirmed');if(collision)collision.invalid=true;this.rebuildIntervals(row);this.stamp('confirmed',row);return{id};});}
 related(row){
  // Follow overlapping evidence and old versions. Independent details quoted
  // from the same message can remain; summaries of that message are removed.
  const ids=new Set([row.id]),sources=[...(row.sources||[])];let changed=true;
  const overlap=(a,b)=>{const x=a.quote?.normalize('NFKC').trim(),y=b.quote?.normalize('NFKC').trim();return a.conversationId===b.conversationId&&a.messageId===b.messageId&&x&&y&&(x.includes(y)||y.includes(x));};
  while(changed){changed=false;for(const r of this.state.facts){if(ids.has(r.id))continue;const sameKey=r.scope===row.scope&&r.scopeId===row.scopeId&&r.key===row.key;const derived=r.sources?.some(x=>sources.some(y=>overlap(x,y)));if(sameKey||derived){ids.add(r.id);sources.push(...r.sources||[]);changed=true;}}}
  let more=true;while(more){more=false;for(const r of this.state.episodes)if(!ids.has(r.id)&&(r.memoryRefs?.some(id=>ids.has(id))||r.sources?.some(x=>sources.some(y=>x.conversationId===y.conversationId&&x.messageId===y.messageId)))){ids.add(r.id);more=true;}}
  return [...this.state.facts,...this.state.episodes].filter(r=>ids.has(r.id));
 }

 async forget(context,id,{cuts={}}={}){
  const row=this.state.facts.find(r=>r.id===id)||this.state.episodes.find(r=>r.id===id);if(!row||!this.allowed(context,row))throw new Error('Memory not found.');
  return this.mutate(s=>{s.privacyRevision++;const related=this.related(row),ids=new Set(related.map(r=>r.id)),sources=new Set(related.flatMap(r=>(r.sources||[]).map(x=>x.messageId)));
   s.facts=s.facts.filter(r=>!ids.has(r.id));s.episodes=s.episodes.filter(r=>{const remove=ids.has(r.id)||r.sources?.some(x=>cuts[x.conversationId]?.includes(x.messageId));if(remove)ids.add(r.id);return!remove;});s.jobs=[];
   s.forgotten=[...new Set([...s.forgotten,...related.map(r=>this.digest(r))])];for(const [cid,messageIds]of Object.entries(cuts))s.cuts[cid]=[...new Set([...(s.cuts[cid]||[]),...messageIds])];
   for(const cid of Object.keys(cuts))delete s.tasks[cid];this.stamp('forgotten',row);return{ids:[...ids],sourceIds:[...sources]};});
 }
 async addEpisode(context,input,{generation}={}){this.assertScope(context,input.scope,input.scopeId);return this.mutate(s=>{if(generation!==undefined&&generation!==s.privacyRevision)return{status:'cancelled'};if(s.episodes.some(e=>e.jobId===input.jobId))return{status:'duplicate'};const row={id:randomUUID(),scope:input.scope,scopeId:input.scopeId,kind:'episode',key:'episode_'+input.jobId,title:clean(input.title,120),content:clean(input.content,6000),sources:input.sources,memoryRefs:input.memoryRefs||[],jobId:input.jobId,createdAt:this.now(),updatedAt:this.now()};s.episodes.push(row);return{id:row.id};});}
 async checkpoint(context,task){return this.mutate(s=>{if(!s.enabled)return{};s.tasks[context.rootId]={...task,scope:'thread',scopeId:context.rootId,updatedAt:this.now()};return{};});}
 async setEnabled(enabled){if(typeof enabled!=='boolean')throw new Error('Choose a memory setting.');return this.mutate(s=>{s.enabled=enabled;s.privacyRevision++;if(!enabled)s.jobs=[];return{enabled};});}
 async enqueue(job){return this.mutate(s=>{if(!s.enabled||s.completed.includes(job.id)||s.jobs.some(j=>j.id===job.id))return{queued:false};s.jobs.push({...job,generation:s.privacyRevision,status:'queued',attempts:0});return{queued:true};});}
 async jobState(id,patch){return this.mutate(s=>{const job=s.jobs.find(j=>j.id===id);if(job)Object.assign(job,patch);return{};});}
 async finishJob(id){return this.mutate(s=>{s.jobs=s.jobs.filter(j=>j.id!==id);s.completed.push(id);s.completed=[...new Set(s.completed)];return{};});}
 async setVector(id,vector,revision){return this.mutate(s=>{const row=[...s.facts,...s.episodes].find(r=>r.id===id);if(row&&row.updatedAt===revision)row.vector=Buffer.from(Float32Array.from(vector).buffer).toString('base64');return{};});}
 lexical(query,allowed){
  if(this.indexRevision!==this.state.revision){this.db.exec('DELETE FROM memory_search');const put=this.db.prepare('INSERT INTO memory_search(id,body) VALUES(?,?)');this.db.exec('BEGIN');try{for(const r of [...this.state.facts,...this.state.episodes])put.run(r.id,`${r.title} ${r.content}`);this.db.exec('COMMIT');this.indexRevision=this.state.revision;}catch(e){this.db.exec('ROLLBACK');throw e;}}
  const words=String(query).match(/[\p{L}\p{N}_]+/gu)?.slice(0,24)||[];if(!words.length)return[];const permit=new Set(allowed.map(r=>r.id));return this.db.prepare('SELECT id,bm25(memory_search) AS score FROM memory_search WHERE memory_search MATCH ? ORDER BY score').all(words.map(w=>'"'+w+'"').join(' OR ')).filter(r=>permit.has(r.id));
 }
 recall(context,query,{vector,at=this.now(),limit=8}={}){
  if(!this.state.enabled)return[];const facts=this.current(context,{at}),episodes=this.state.episodes.filter(r=>this.allowed(context,r)&&r.createdAt<=at),allowed=[...facts,...episodes],scores=new Map();
  this.lexical(query,allowed).forEach((r,i)=>scores.set(r.id,(scores.get(r.id)||0)+1/(35+i)));
  if(vector){const q=Float32Array.from(vector);allowed.filter(r=>r.vector).map(r=>{const b=Buffer.from(r.vector,'base64'),v=new Float32Array(b.buffer,b.byteOffset,b.length/4);let score=0;if(v.length!==q.length)return{id:r.id,score:-1};for(let i=0;i<v.length;i++)score+=v[i]*q[i];return{id:r.id,score};}).filter(r=>r.score>.28).sort((a,b)=>b.score-a.score).slice(0,24).forEach((r,i)=>scores.set(r.id,(scores.get(r.id)||0)+1/(35+i)));}
  return allowed.filter(r=>scores.has(r.id)).sort((a,b)=>(scores.get(b.id)-scores.get(a.id))||b.updatedAt-a.updatedAt).slice(0,Math.min(20,limit)).map(r=>structuredClone({...r,vector:undefined,score:scores.get(r.id)}));
 }
 view(context){return{enabled:this.state.enabled,revision:this.state.revision,profile:this.current(context).filter(r=>r.scope==='profile').map(r=>({...r,vector:undefined})),facts:this.current(context).filter(r=>r.scope!=='profile').map(r=>({...r,vector:undefined})),pending:this.state.facts.filter(r=>r.status==='pending'&&!r.invalid&&this.allowed(context,r)).map(r=>({...r,vector:undefined})),history:this.state.facts.filter(r=>this.allowed(context,r)&&r.status==='confirmed'&&(r.invalid||r.validTo||r.expiresAt&&r.expiresAt<=this.now())).sort((a,b)=>b.updatedAt-a.updatedAt).map(r=>({...r,vector:undefined})),episodes:this.state.episodes.filter(r=>this.allowed(context,r)).sort((a,b)=>b.createdAt-a.createdAt).slice(0,100).map(r=>({...r,vector:undefined})),task:this.state.tasks[context.rootId]||null,jobs:this.state.jobs.filter(j=>j.context.rootId===context.rootId).map(j=>({id:j.id,status:j.status,error:j.error})),changes:this.state.changes.filter(r=>!r.scope||this.allowed(context,r)).slice(-30)};}
 async close(){await this.tail.catch(()=>{});this.db?.close();this.key?.fill(0);}
}
