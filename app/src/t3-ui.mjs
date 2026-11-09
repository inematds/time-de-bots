import {renderMarkdown} from './markdown.mjs';
const $=id=>document.getElementById(id),labels={submitting:'Starting',queued:'Queued',running:'Working',completed:'Finished',failed:'Failed',interrupted:'Interrupted',cancelled:'Stopped',cancel_requested:'Stopping',needs_input:'Needs your input',needs_review:'Check in T3',disconnected:'Reconnecting',idle:'Ready'};
export function setupT3UI({api,getState,onOpenConnections}){
 let state=null,projects=[],providers=[],threads=[],loaded=false,refreshing=false,refreshAgain=false,scopeId=null,saving=false,layoutInitialized=false;
 const context=()=>({conversationId:getState()?.activeConversationId});
 const button=(label,action,klass='quiet-button')=>{const b=document.createElement('button');b.type='button';b.className=klass;b.textContent=label;b.onclick=()=>void action().catch(error);return b;};
 const error=e=>{$('t3-error').textContent=e.message||String(e);$('t3-error').hidden=false;};
 const selectedModel=()=>{const value=$('t3-model').value;if(!value)return undefined;const [instanceId,model]=JSON.parse(value);return{instanceId,model};};
 function options(select,items,value){select.replaceChildren(...items.map(([id,label])=>{const o=document.createElement('option');o.value=id;o.textContent=label;return o;}));select.value=value||'';}
 async function loadOptions(){const id=context().conversationId;const next=await api.t3Options(context());if(context().conversationId!==id)return;projects=next.projects;providers=next.providers;loaded=true;paintBinding();await loadThreads();}
 async function loadThreads(){const projectId=$('t3-project').value;if(!projectId){threads=[];paintThreads();return;}threads=await api.t3Threads({...context(),projectId});paintThreads();}
 function paintThreads(){options($('t3-thread'),[['','Start a new thread'],...threads.map(t=>[t.threadId,t.title])],state?.binding?.threadId);}
 function paintBinding(){options($('t3-project'),[['','Choose a project'],...projects.map(p=>[p.id,p.title||p.name||p.workspaceRoot])],state?.binding?.projectId);options($('t3-model'),[['','Use T3 project default'],...providers.filter(p=>p.canRunChildTask).flatMap(p=>p.models.map(m=>[JSON.stringify([p.providerInstanceId,m.id]),p.displayName+' · '+(m.label||m.id)]))],state?.binding?.modelSelection?JSON.stringify([state.binding.modelSelection.instanceId,state.binding.modelSelection.model]):'');}
 async function saveBinding(){if(saving)return;saving=true;try{state.binding=await api.t3Bind({...context(),projectId:$('t3-project').value,threadId:$('t3-thread').value,modelSelection:selectedModel()});$('t3-run').disabled=!state.binding?.projectId;}finally{saving=false;}}
 function render(){if(!state)return;const c=state.connection,connected=c.connected||c.status==='saved';$('t3-connect-area').hidden=connected;$('t3-project-area').hidden=!connected;
  $('t3-connection-status').textContent=c.status==='installing'?(c.error||'Setting up T3…'):c.status==='authorizing'?'Approve Gratis in the T3 sign-in page.':c.status==='connecting'?'Connecting to T3…':connected?'Connected to T3':'Run tasks in T3';
  $('t3-local').disabled=['installing','connecting','authorizing'].includes(c.status);$('t3-connect').disabled=$('t3-local').disabled;
  if(c.status==='error')error(c.error);if(c.endpoint&&!$('t3-endpoint').value)$('t3-endpoint').value=c.endpoint;
  $('t3-run').disabled=!state.binding?.projectId||saving;if(!layoutInitialized){$('t3-project-settings').open=!state.binding?.projectId;$('t3-new-task').open=!state.jobs.length;layoutInitialized=true;}
  const list=$('t3-task-list'),drafts=new Map([...list.querySelectorAll('.t3-followup')].map(form=>[form.dataset.jobId,form.querySelector('input').value]));
  const focused=document.activeElement?.closest('.t3-followup')?.dataset.jobId,selection=focused?[document.activeElement.selectionStart,document.activeElement.selectionEnd]:null;list.replaceChildren();
  for(const job of state.jobs){const card=document.createElement('article');card.className='t3-task';const head=document.createElement('div');head.className='t3-task-heading';const title=document.createElement('strong');title.textContent=job.title;const status=document.createElement('span');status.className='t3-status';status.dataset.status=job.status;status.textContent=labels[job.status]||job.status;head.append(title,status);card.append(head);
   const goal=document.createElement('p');goal.className='t3-task-goal';goal.textContent=job.prompt;card.append(goal);
   if(job.error){const note=document.createElement('p');note.className='t3-task-error';note.textContent=job.error;card.append(note);}
   const result=job.result||job.items?.filter(i=>i.text&&/assistant|agent_message|response/i.test(i.type)).map(i=>i.text).join('\n\n');if(result){const body=document.createElement('div');body.className='markdown t3-result';body.append(renderMarkdown(result));card.append(body);}
   const actions=document.createElement('div');actions.className='t3-task-actions';actions.append(button('Refresh',()=>api.t3Refresh({...context(),id:job.id}).then(refresh)));
   if(job.link)actions.append(button('Open in T3',()=>api.t3Open({...context(),id:job.id})));
   if(['disconnected','needs_review'].includes(job.status))actions.append(button('Retry',()=>api.t3Retry({...context(),id:job.id}).then(refresh)));
   if(job.threadId&&!['completed','cancelled','interrupted','failed'].includes(job.status))actions.append(button('Stop task',()=>api.t3Stop({...context(),id:job.id}).then(refresh)));
   card.append(actions);
   if(job.threadId){const form=document.createElement('form');form.className='t3-followup';form.dataset.jobId=job.id;const input=document.createElement('input');input.value=drafts.get(job.id)||'';input.placeholder='Follow up in this thread…';input.setAttribute('aria-label','Follow up on '+job.title);const send=button('Send',async()=>{});send.type='submit';form.append(input,send);form.onsubmit=async e=>{e.preventDefault();if(!input.value.trim())return;send.disabled=true;try{await api.t3Send({...context(),id:job.id,message:input.value});input.value='';await refresh();}catch(e){error(e);}finally{send.disabled=false;}};card.append(form);}
   list.append(card);
  }
  if(focused){const input=[...list.querySelectorAll('.t3-followup')].find(f=>f.dataset.jobId===focused)?.querySelector('input');input?.focus({preventScroll:true});if(input&&selection)input.setSelectionRange(...selection);}
  $('t3-empty').hidden=state.jobs.length>0;
 }
 async function refresh(){if(!context().conversationId)return;if(refreshing){refreshAgain=true;return;}refreshing=true;const id=context().conversationId;try{const next=await api.t3View(context());if(id!==context().conversationId)return;state=next;render();if((next.connection.connected||next.connection.status==='saved')&&!loaded)await loadOptions();}catch(e){error(e);}finally{refreshing=false;if(refreshAgain){refreshAgain=false;void refresh();}}}
 $('t3-local').onclick=async()=>{try{$('t3-error').hidden=true;$('t3-local').disabled=true;await api.t3Local();loaded=false;await refresh();}catch(e){error(e);$('t3-local').disabled=false;}};
 $('t3-connect').onclick=async()=>{try{$('t3-error').hidden=true;await api.t3Connect({endpoint:$('t3-endpoint').value});loaded=false;await refresh();}catch(e){error(e);}};
 $('t3-refresh-projects').onclick=()=>void loadOptions().catch(error);
 $('t3-add-project').onclick=async()=>{try{const project=await api.t3Project(context());if(project){await loadOptions();$('t3-project').value=project.id;await loadThreads();await saveBinding();}}catch(e){error(e);}};
 $('t3-project').onchange=async()=>{try{state.binding=null;await loadThreads();await saveBinding();}catch(e){error(e);}};
 $('t3-thread').onchange=()=>void saveBinding().catch(error);$('t3-model').onchange=()=>void saveBinding().catch(error);
 $('t3-task-form').onsubmit=async e=>{e.preventDefault();if(!$('t3-prompt').value.trim())return;$('t3-run').disabled=true;try{await api.t3Submit({...context(),prompt:$('t3-prompt').value,title:$('t3-title').value});$('t3-prompt').value='';$('t3-title').value='';$('t3-new-task').open=false;$('t3-project-settings').open=false;await refresh();}catch(e){error(e);}finally{$('t3-run').disabled=!state?.binding?.projectId;}};
 api.onT3Changed?.(()=>{if(!$('workspace-t3').hidden)void refresh();});
 return{refresh,sync(){if(scopeId!==context().conversationId){scopeId=context().conversationId;state=null;loaded=false;layoutInitialized=false;if(!$('workspace-t3').hidden)void refresh();}}};
}
