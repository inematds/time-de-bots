import {BOT_SHAPES,BOT_COLORS,avatarColor} from './avatar.mjs';
import {animatedAvatar,pulseAvatar} from './avatar-motion.mjs';
export function setupCreateBot({api,onCreated}) {
 const $=id=>document.getElementById(id),dialog=$('create-bot-dialog');
 let shape='flower',color='orange',pending=false;
 const shapeButtons=new Map(),colorButtons=new Map();
 $('create-shapes').replaceChildren(...[BOT_SHAPES.slice(0,5),BOT_SHAPES.slice(5,10),BOT_SHAPES.slice(10)].map(row=>{
  const group=document.createElement('div');group.className='create-shape-row';
  for(const option of row){const button=document.createElement('button');button.type='button';button.className='create-shape';button.setAttribute('aria-label',`${option.id} character shape`);button.onclick=()=>{shape=option.id;paint();pulseAvatar('create-preview');pulseAvatar(`shape-${shape}`);};shapeButtons.set(option.id,button);group.append(button);}return group;
 }));
 $('create-colors').replaceChildren(...BOT_COLORS.map(option=>{const button=document.createElement('button');button.type='button';button.className='create-color';button.setAttribute('aria-label',`${option.label} character color`);button.append(document.createElement('span'));button.onclick=()=>{color=option.id;paint();pulseAvatar('create-preview');};colorButtons.set(option.id,button);return button;}));
 function paint(){
  const theme=document.documentElement.dataset.theme||'dark',ink=avatarColor(color,theme),selected=BOT_SHAPES.find(s=>s.id===shape);
  const preview=animatedAvatar('create-preview',{shape:selected.shape,color:ink,front:true,follow:'global',mode:'idle'});
  if($('create-avatar-preview').firstChild!==preview)$('create-avatar-preview').replaceChildren(preview);
  for(const option of BOT_SHAPES){const button=shapeButtons.get(option.id);button.disabled=pending;button.setAttribute('aria-pressed',String(option.id===shape));const artwork=animatedAvatar(`shape-${option.id}`,{shape:option.shape,color:ink,follow:'global',mode:'idle',outlined:option.id===shape});artwork.classList.add('shape-art');if(button.firstChild!==artwork)button.replaceChildren(artwork);}
  for(const option of BOT_COLORS){const button=colorButtons.get(option.id);button.disabled=pending;button.setAttribute('aria-pressed',String(option.id===color));button.firstChild.style.backgroundColor=option[theme];}
  $('create-bot-submit').disabled=pending||!$('new-bot-name').value.trim();$('create-bot-submit').textContent=pending?'Creating…':'Create';$('new-bot-name').disabled=pending;$('cancel-create-bot').disabled=pending;dialog.querySelector('.create-close').disabled=pending;
 }
 function open(){const random=crypto.getRandomValues(new Uint32Array(2));shape=BOT_SHAPES[random[0]%BOT_SHAPES.length].id;color=BOT_COLORS[random[1]%BOT_COLORS.length].id;pending=false;$('new-bot-name').value='';$('create-error').hidden=true;paint();dialog.showModal();$('new-bot-name').focus();}
 $('new-bot-name').oninput=()=>{$('create-bot-submit').disabled=pending||!$('new-bot-name').value.trim();};
 $('cancel-create-bot').onclick=()=>{if(!pending)dialog.close();};
 dialog.addEventListener('cancel',event=>{if(pending)event.preventDefault();});
 dialog.addEventListener('click',event=>{if(event.target===dialog&&!pending){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
 $('create-bot-form').onsubmit=async event=>{event.preventDefault();const name=$('new-bot-name').value.trim();if(!name||pending)return;pending=true;$('create-error').hidden=true;paint();try{const state=await api.createBot({name,avatarShape:shape,avatarColor:color,promptMode:'auto'});dialog.close();onCreated(state);}catch(error){$('create-error').textContent=error.message;$('create-error').hidden=false;}finally{pending=false;paint();}};
 return {open};
}
