export function setupComposerMenu({api,getState,run,workspace}){
  const trigger=document.getElementById('attach-menu'),menu=document.createElement('div');
  menu.id='composer-menu';menu.className='composer-menu';menu.popover='auto';menu.setAttribute('role','menu');menu.setAttribute('aria-label','Add to chat');document.body.append(menu);
  trigger.setAttribute('aria-label','Add files, apps or computer');trigger.setAttribute('aria-haspopup','menu');trigger.setAttribute('aria-controls',menu.id);trigger.title='Add files, apps or computer';
  function close(){menu.hidePopover();}
  function row(label,description,action){const button=document.createElement('button');button.type='button';button.setAttribute('role','menuitem');const strong=document.createElement('strong');strong.textContent=label;const small=document.createElement('small');small.textContent=description;button.append(strong,small);button.onclick=()=>{close();action();};menu.append(button);}
  row('Add files','Attach documents and images',()=>run(()=>api.attachFiles({conversationId:getState().activeConversationId})));
  row('Scheduled tasks','Run daily checks with this bot and its apps',()=>workspace.openSchedules());
  row('T3 tasks','Run or continue an agent in your project',()=>workspace.openT3());
  row('Start computer','Open your bot’s cloud computer',()=>workspace.openComputer({start:true}));
  const divider=document.createElement('hr');menu.append(divider);
  row('Connected apps','Browse Composio apps and sign in',()=>workspace.openConnections());
  row('Sign in to Composio','Connect your accounts in your browser',()=>workspace.openConnections({signIn:true}));
  function show(){menu.showPopover();const r=trigger.getBoundingClientRect();menu.style.left=`${Math.max(8,Math.min(r.left,innerWidth-menu.offsetWidth-8))}px`;menu.style.top=`${Math.max(8,r.top-menu.offsetHeight-8)}px`;menu.querySelector('button').focus();}
  trigger.onclick=()=>menu.matches(':popover-open')?close():show();
  trigger.onkeydown=e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();show();}};
  menu.addEventListener('toggle',()=>trigger.setAttribute('aria-expanded',String(menu.matches(':popover-open'))));
  menu.addEventListener('keydown',event=>{const options=[...menu.querySelectorAll('button')],index=options.indexOf(document.activeElement);if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();options[event.key==='Home'?0:event.key==='End'?options.length-1:(index+(event.key==='ArrowDown'?1:-1)+options.length)%options.length].focus();}if(event.key==='Escape'){close();trigger.focus();}});
  return {close};
}
