import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
const required=(v,label,max)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw new Error(`Enter ${label} under ${max} characters.`);return v.trim();};
export function validateTiming(value){
 const timezone=value.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone;
 try{new Intl.DateTimeFormat('en',{timeZone:timezone}).format();}catch{throw new Error('Choose a valid timezone, such as America/Toronto.');}
 if(value.kind==='interval'){
  if(!Number.isInteger(value.minutes)||value.minutes<15||value.minutes>10080)throw new Error('Choose an interval from 15 minutes to one week.');
  return{kind:'interval',minutes:value.minutes,timezone};
 }
 if(value.kind!=='weekly'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time||''))throw new Error('Choose a time in HH:mm format.');
 const days=[...new Set(value.days||[0,1,2,3,4,5,6])].sort();
 if(!days.length||days.some(d=>!Number.isInteger(d)||d<0||d>6))throw new Error('Choose at least one day.');
 return{kind:'weekly',time:value.time,days,timezone};
}
export function nextRun(timing,after,servedAt){
 if(timing.kind==='interval')return after+timing.minutes*60000;
 // Iterate actual instants, so daylight-saving gaps are skipped and repeated
 // wall-clock times do not require inventing a timezone offset.
 const format=new Intl.DateTimeFormat('en-GB',{timeZone:timing.timezone,year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 const localDate=t=>{const p=Object.fromEntries(format.formatToParts(t).map(p=>[p.type,p.value]));return `${p.year}-${p.month}-${p.day}`;};
 const servedDate=servedAt===undefined?null:localDate(servedAt);
 const initial=Object.fromEntries(format.formatToParts(after).map(p=>[p.type,p.value]));
 const skipToday=`${initial.hour}:${initial.minute}`>=timing.time?localDate(after):null;
 const names=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
 for(let t=Math.floor(after/60000)*60000+60000,end=t+8*86400000;t<end;t+=60000){const p=Object.fromEntries(format.formatToParts(t).map(p=>[p.type,p.value]));if(localDate(t)!==servedDate&&localDate(t)!==skipToday&&timing.days.includes(names.indexOf(p.weekday))&&`${p.hour}:${p.minute}`===timing.time)return t;}
 throw new Error('Could not determine the next scheduled time.');
}
export class Schedules {
 constructor({directory,encrypt,decrypt,service,onChange=()=>{},now=Date.now}){Object.assign(this,{directory,encrypt,decrypt,service,onChange,now});this.items=[];this.persist=Promise.resolve();this.ticking=false;this.closed=false;this.dispatching=new Set();}
 async init(){try{const data=JSON.parse(this.decrypt(await readFile(join(this.directory,'schedules.secure'))));this.items=data.items||[];}catch(e){if(e.code!=='ENOENT')throw new Error('Could not unlock saved schedules.');}return this;}
 snapshot(conversationId){return structuredClone(this.items.filter(i=>!conversationId||i.conversationId===conversationId));}
 async save(){const body=JSON.stringify({version:1,items:this.items});const write=async()=>{await mkdir(this.directory,{recursive:true,mode:0o700});const tmp=join(this.directory,'.schedules-'+randomUUID());await writeFile(tmp,this.encrypt(body),{mode:0o600});await rename(tmp,join(this.directory,'schedules.secure'));};this.persist=this.persist.then(write,write);await this.persist;this.onChange();}
 get(id,conversationId){const item=this.items.find(i=>i.id===id&&i.conversationId===conversationId);if(!item)throw new Error('This schedule does not belong to this chat.');return item;}
 async create({conversationId,title,prompt,timing,sourceMessageId}){
  const c=this.service._conversation(conversationId);if(c.parentThreadId)throw new Error('Create schedules in the shared chat.');
  title=required(title,'a schedule name',120);prompt=required(prompt,'a task',16000);timing=validateTiming(timing);
  if(this.items.filter(i=>i.conversationId===conversationId).length>=30)throw new Error('This chat already has 30 schedules.');
  const prior=sourceMessageId&&this.items.find(i=>i.conversationId===conversationId&&i.sourceMessageId===sourceMessageId&&i.prompt===prompt&&JSON.stringify(i.timing)===JSON.stringify(timing));if(prior)return structuredClone(prior);
  const item={id:randomUUID(),conversationId,botId:c.botId,title,prompt,timing,sourceMessageId,enabled:true,nextRunAt:nextRun(timing,this.now()),createdAt:this.now(),runs:[]};this.items.push(item);await this.save();return structuredClone(item);
 }
 async update({id,conversationId,enabled,title,prompt,timing}){
  const item=this.get(id,conversationId),editing=title!==undefined||prompt!==undefined||timing!==undefined;
  if(editing&&item.runs.some(r=>['starting','running'].includes(r.status)))throw new Error('Wait for the current run to finish before editing this schedule.');
  const next={};if(title!==undefined)next.title=required(title,'a schedule name',120);if(prompt!==undefined)next.prompt=required(prompt,'a task',16000);if(timing!==undefined)next.timing=validateTiming(timing);
  if(enabled!==undefined){if(typeof enabled!=='boolean')throw new Error('Invalid schedule state.');next.enabled=enabled;}
  if(timing!==undefined||enabled===true)next.nextRunAt=nextRun(next.timing||item.timing,this.now());
  Object.assign(item,next);if(enabled===true)delete item.error;await this.save();return structuredClone(item);
 }
 async remove({id,conversationId}){const item=this.get(id,conversationId);if(item.runs.some(r=>['starting','running'].includes(r.status)))throw new Error('Stop the running chat before deleting its schedule.');this.items=this.items.filter(i=>i!==item);await this.save();}
 async runNow({id,conversationId}){const item=this.get(id,conversationId),c=this.service._conversation(conversationId);if(this.busy(c)||item.runs.some(r=>['starting','running'].includes(r.status)))throw new Error('This chat is busy. Wait for it to finish.');await this.startRun(item,this.now());return this.snapshot(conversationId);}
 busy(c){return this.service.closing||this.service.teams.busy(c)||this.service.teams.waiting(c)||c.queue?.length||c.queuePaused||c.computerPause||c.pendingComputerHelp||this.service.changingThreads.has(c.id);}
 async startRun(item,scheduledFor){
  const c=this.service._conversation(item.conversationId),run={id:randomUUID(),scheduledFor,startedAt:this.now(),status:'starting'};
  this.dispatching.add(run.id);
  try{
  item.runs.push(run);item.runs=item.runs.slice(-30);item.nextRunAt=nextRun(item.timing,this.now(),scheduledFor);await this.save();
  if(this.closed||this.busy(c)){run.status='deferred';item.nextRunAt=scheduledFor;await this.save();return;}
  try{await this.service._deliver(c,item.prompt,[],{scheduled:{id:item.id,runId:run.id,title:item.title,scheduledFor}});run.status='running';await this.save();}
  catch(error){run.status='needs_review';run.error=error.message;item.enabled=false;item.error='A scheduled run could not start. Review it before resuming.';await this.save();}
  }finally{this.dispatching.delete(run.id);}
 }
 async tick(){if(this.ticking||this.closed)return;this.ticking=true;try{
  let changed=false;
  for(const item of this.items){
   const c=this.service.state.conversations.find(c=>c.id===item.conversationId);
   if(!c){if(item.enabled){item.enabled=false;item.error='The chat was deleted.';changed=true;}continue;}
   for(const run of item.runs.filter(r=>['starting','running'].includes(r.status))){
    if(this.dispatching.has(run.id))continue;
    const index=c.messages.findIndex(m=>m.sourceScheduleRunId===run.id);
    if(index<0){run.status='needs_review';run.error='The app stopped before delivery was confirmed.';item.enabled=false;changed=true;continue;}
    if(this.service.teams.busy(c)||this.service.teams.waiting(c)||c.pendingComputerHelp||c.computerPause)continue;
    const end=c.messages.findIndex((m,i)=>i>index&&m.role==='user');
    const replies=c.messages.slice(index+1,end<0?undefined:end).filter(m=>m.role==='assistant');
    const failed=replies.find(m=>['error','cancelled'].includes(m.status));
    run.status=failed||!replies.length?'needs_review':'completed';run.finishedAt=this.now();
    if(run.status==='needs_review'){run.error=failed?.error||'No completed reply was recorded.';item.enabled=false;item.error='Review the last run, then resume this schedule.';}changed=true;
   }
   if(!item.enabled||item.nextRunAt>this.now()||this.busy(c)||item.runs.some(r=>['starting','running'].includes(r.status)))continue;
   // Coalesce missed intervals to one fresh check. Never replay a backlog.
   await this.startRun(item,item.nextRunAt);
  }
  if(changed)await this.save();
 }finally{this.ticking=false;}}
 start(){this.timer=setInterval(()=>void this.tick().catch(()=>{}),5000);this.timer.unref?.();void this.tick().catch(()=>{});}
 async close(){this.closed=true;clearInterval(this.timer);await this.persist;}
}
