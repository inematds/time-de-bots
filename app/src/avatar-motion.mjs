import {avatarSvg} from './avatar.mjs';
const views=new Map();
export function animatedAvatar(key,config){let view=views.get(key);if(!view){const element=document.createElement('span'),image=document.createElement('img');element.className='avatar-motion';element.dataset.motionId=key;image.alt='';element.append(image);view={element,image};views.set(key,view);}
 view.image.src=config.photo||avatarSvg(config.name,config.color,config.shape);view.element.dataset.mode=config.mode||'idle';view.element.classList.toggle('avatar-photo',!!config.photo);view.element.classList.toggle('is-selected',!!config.outlined);return view.element;}
export function pulseAvatar(key){const view=views.get(key);if(view&&!matchMedia('(prefers-reduced-motion: reduce)').matches)view.element.animate([{transform:'scale(.96)'},{transform:'scale(1.04)'},{transform:'scale(1)'}],{duration:220,easing:'ease-out'});}
