const $=id=>document.getElementById(id);
export function setupSchedulesUI({api,getState}){
 let rows=[],scope=null,refreshId=0,pendingDelete=null;
 const context=()=>({conversationId:getState()?.activeConversationId});
 const fail=e=>{$('schedules-error').textContent=e.message;$('schedules-error').hidden=false;};
 const format=(time,zone)=>new Intl.DateTimeFormat(undefined,{timeZone:zone,dateStyle:'medium',timeStyle:'short'}).format(time);
 const button=(label,action)=>{const b=document.createElement('button');b.type='button';b.className='quiet-button';b.textContent=label;b.onclick=async()=>{b.disabled=true;try{await action();await refresh();}catch(e){fail(e);}finally{b.disabled=false;}};return b;};
 function render(){
  $('schedules-empty').hidden=rows.length>0;
  $('schedules-list').replaceChildren(...rows.map(item=>{
   const card=document.createElement('article');card.className='schedule-card';
   const title=document.createElement('h3');title.textContent=item.title;
   const prompt=document.createElement('p');prompt.textContent=item.prompt;prompt.className='schedule-prompt';
   const next=document.createElement('p');next.className='schedule-meta';next.textContent=item.enabled?'Next: '+format(item.nextRunAt,item.timing.timezone)+' · '+item.timing.timezone:'Paused';
   const last=item.runs.at(-1);const result=document.createElement('p');result.className='schedule-meta';result.textContent=last?'Last run: '+last.status.replaceAll('_',' ')+(last.finishedAt?' · '+format(last.finishedAt,item.timing.timezone):''):'';
   if(item.error||last?.error){result.textContent+=' · '+(item.error||last.error);}
   const actions=document.createElement('div');actions.className='schedule-actions';
   actions.append(button(item.enabled?'Pause':'Resume',()=>api.schedulesUpdate({...context(),id:item.id,enabled:!item.enabled})),button('Run now',()=>api.schedulesRun({...context(),id:item.id})),button('Edit',async()=>{edit(item);}),button(pendingDelete===item.id?'Confirm delete':'Delete',async()=>{if(pendingDelete===item.id){await api.schedulesRemove({...context(),id:item.id});pendingDelete=null;}else pendingDelete=item.id;}));
   card.append(title,next,prompt,result,actions);return card;
  }));
 }
 function edit(item){$('schedule-editor').open=true;$('schedule-editor').querySelector('summary').textContent='Edit schedule';$('schedule-form').dataset.editId=item.id;$('schedule-title').value=item.title;$('schedule-prompt').value=item.prompt;$('schedule-timezone').value=item.timing.timezone;$('schedule-frequency').value=item.timing.kind==='interval'?'interval':JSON.stringify(item.timing.days)==='[1,2,3,4,5]'?'weekdays':item.timing.days.length===7?'daily':'weekly';$('schedule-time').value=item.timing.time||'09:00';$('schedule-day').value=String(item.timing.days?.[0]??1);$('schedule-minutes').value=item.timing.minutes||60;$('schedule-save').textContent='Save changes';controls();}
 function controls(){const f=$('schedule-frequency').value;$('schedule-time-row').hidden=f==='interval';$('schedule-day-row').hidden=f!=='weekly';$('schedule-interval-row').hidden=f!=='interval';}
 function reset(){ $('schedule-editor').querySelector('summary').textContent='New schedule';$('schedule-form').reset();delete $('schedule-form').dataset.editId;$('schedule-timezone').value=Intl.DateTimeFormat().resolvedOptions().timeZone;$('schedule-save').textContent='Create schedule';controls();}
 async function refresh(){const id=context().conversationId,seq=++refreshId;const result=await api.schedulesView(context());if(context().conversationId!==id||seq!==refreshId)return;if(scope!==id){scope=id;pendingDelete=null;reset();}rows=result;render();}
 $('schedule-frequency').onchange=controls;$('schedule-cancel').onclick=reset;
 $('schedule-form').onsubmit=async e=>{e.preventDefault();const f=$('schedule-frequency').value,timing=f==='interval'?{kind:'interval',minutes:Number($('schedule-minutes').value)}:{kind:'weekly',time:$('schedule-time').value,days:f==='daily'?[0,1,2,3,4,5,6]:f==='weekdays'?[1,2,3,4,5]:[Number($('schedule-day').value)]};timing.timezone=$('schedule-timezone').value;
  const input={...context(),title:$('schedule-title').value,prompt:$('schedule-prompt').value,timing};const editId=$('schedule-form').dataset.editId;$('schedule-save').disabled=true;$('schedules-error').hidden=true;try{await(editId?api.schedulesUpdate({...input,id:editId}):api.schedulesCreate(input));reset();$('schedule-editor').open=false;await refresh();}catch(error){fail(error);}finally{$('schedule-save').disabled=false;}
 };
 api.onSchedulesChanged?.(()=>{if(!$('workspace-schedules').hidden)void refresh().catch(fail);});reset();return{refresh,sync(){if(scope!==context().conversationId&&!$('workspace-schedules').hidden)void refresh().catch(fail);}};
}
