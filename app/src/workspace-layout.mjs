const expand='<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 3H3v4m10-4h4v4M3 13v4h4m10-4v4h-4M3 3l5 5m9-5-5 5M3 17l5-5m9 5-5-5"/></svg>';
const collapse='<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 7h4V3m6 0v4h4M7 17v-4H3m14 0h-4v4M3 3l4 4m10-4-4 4M3 17l4-4m10 4-4-4"/></svg>';
export function setupWorkspaceLayout({api,onError=()=>{}}={}){
 const main=document.querySelector('main'),panel=document.getElementById('work-panel'),handle=document.getElementById('workspace-resize'),button=document.getElementById('workspace-fullscreen');
 let preferred=null,drag=null,open=false,label='computer',expanded=false;
 try{const saved=Number(localStorage.getItem('gratis-workspace-width'));if(saved>=280&&saved<=1800)preferred=saved;}catch{}
 function limits(){const width=main.getBoundingClientRect().width;return{min:Math.min(280,width),max:Math.max(Math.min(280,width),width-320)};}
 function apply(value=preferred){const {min,max}=limits(),fallback=innerWidth<=1000?300:360,width=Math.round(Math.min(max,Math.max(min,value??fallback)));main.style.setProperty('--workspace-width',`${width}px`);handle.setAttribute('aria-valuemin',String(Math.round(min)));handle.setAttribute('aria-valuemax',String(Math.round(max)));handle.setAttribute('aria-valuenow',String(width));handle.setAttribute('aria-valuetext',`${width} pixels wide`);return width;}
 function save(){try{if(preferred===null)localStorage.removeItem('gratis-workspace-width');else localStorage.setItem('gratis-workspace-width',String(preferred));}catch{}}
 function finish(){drag=null;document.body.classList.remove('workspace-resizing');save();}
 handle.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();drag={id:e.pointerId,x:e.clientX,width:panel.getBoundingClientRect().width};handle.setPointerCapture(e.pointerId);document.body.classList.add('workspace-resizing');};
 handle.onpointermove=e=>{if(!drag||e.pointerId!==drag.id)return;preferred=apply(drag.width+drag.x-e.clientX);};
 handle.onpointerup=e=>{if(!drag)return;if(handle.hasPointerCapture(e.pointerId))handle.releasePointerCapture(e.pointerId);finish();};
 handle.onpointercancel=finish;handle.onlostpointercapture=finish;
 handle.ondblclick=()=>{preferred=null;apply();save();};
 handle.onkeydown=e=>{const {min,max}=limits(),width=panel.getBoundingClientRect().width;let next;if(e.key==='ArrowLeft')next=width+(e.shiftKey?50:10);else if(e.key==='ArrowRight')next=width-(e.shiftKey?50:10);else if(e.key==='Home')next=min;else if(e.key==='End')next=max;else return;e.preventDefault();preferred=apply(next);save();};
 function sync(){const full=expanded;panel.classList.toggle('is-fullscreen',full);button.innerHTML=full?collapse:expand;button.setAttribute('aria-label',`${full?'Exit':'Enter'} ${label} full screen`);button.title=full?'Exit full screen (Esc)':'Full screen';button.setAttribute('aria-pressed',String(full));handle.hidden=!open||full;document.body.classList.toggle('workspace-fullscreen',full);apply();}
 async function setFullscreen(value){try{expanded=await api.workspaceFullscreen(value);sync();}catch(error){onError(error);}}
 button.onclick=()=>void setFullscreen(!expanded);
 api.onWorkspaceFullscreen(value=>{expanded=value;sync();});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&expanded){e.preventDefault();e.stopPropagation();void setFullscreen(false);}},true);
 window.addEventListener('resize',()=>apply());apply();sync();
 return{async exit(){if(expanded)await setFullscreen(false);},sync(visible,kind='computer'){open=visible;label=kind;if(!open&&expanded)void setFullscreen(false);sync();}};
}

// object-fit:contain leaves letterboxing in full screen. Ignore the bars and
// translate clicks through the displayed image, not the surrounding rectangle.
export function computerPoint(image,clientX,clientY){
 const rect=image.getBoundingClientRect(),width=image.naturalWidth||1280,height=image.naturalHeight||800,scale=Math.min(rect.width/width,rect.height/height),paintWidth=width*scale,paintHeight=height*scale,left=rect.left+(rect.width-paintWidth)/2,top=rect.top+(rect.height-paintHeight)/2;
 if(clientX<left||clientX>=left+paintWidth||clientY<top||clientY>=top+paintHeight)return null;
 return{x:Math.min(1279,Math.max(0,Math.round((clientX-left)/paintWidth*1280))),y:Math.min(799,Math.max(0,Math.round((clientY-top)/paintHeight*800)))};
}
