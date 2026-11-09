import {computerPoint} from './workspace-layout.mjs';

// One ordered input stream, fenced to a conversation and ownership generation.
// The text sink lets Chromium deliver paste, Unicode and IME composition normally.
export function setupComputerInput({image,sink,context,send,takeControl,onError=()=>{}}){
 let inputError=null;
 let generation=0,owner=null,tail=Promise.resolve(),text='',textTimer,pressed=null,hover=null,hoverBusy=false,composing=false,lastClick={at:0,x:0,y:0,count:0};
 image.draggable=false;
 const current=()=>{const c=context();return !!c.id&&c.human;};
 function enqueue(name,args){
  const id=context().id,epoch=generation;
  const job=tail.then(async()=>{if(epoch!==generation||id!==context().id||!current())return;return send(name,args,id);});
  tail=job.catch(error=>{if(epoch===generation&&!(name==='pointer_event'&&args.type==='move'&&!args.buttons)){inputError=error;onError(error);}});return job;
 }
 function flushText(){clearTimeout(textTimer);if(!text)return tail;const value=text;text='';return enqueue('type_text',{text:value});}
 function insert(value){if(!current()||context().blocked||!value)return;text+=value;if(text.length>=1000)void flushText().catch(()=>{});else{clearTimeout(textTimer);textTimer=setTimeout(()=>void flushText().catch(()=>{}),30);}}
 function focus(){sink.focus({preventScroll:true});sink.value='';}
 async function flush(){await flushText().catch(()=>{});if(pressed){const p=pressed;pressed=null;await enqueue('pointer_event',{type:'up',...p}).catch(()=>{});}hover=null;await tail;if(inputError){const cause=inputError;inputError=null;throw new Error('An input did not complete. Check the current page, then Give control back again. '+cause.message);}}
 function sync(){const c=context(),next=c.human?c.id:null;if(next!==owner){generation++;owner=next;inputError=null;text='';hover=null;pressed=null;clearTimeout(textTimer);sink.value='';}image.dataset.control=c.human?'human':'bot';}
 function point(e){return computerPoint(image,e.clientX,e.clientY);}
 image.addEventListener('dragstart',e=>e.preventDefault());
 image.addEventListener('pointerdown',async e=>{
  if(![0,1,2].includes(e.button)||context().blocked)return;const p=point(e);if(!p)return;e.preventDefault();
  if(!context().human){try{await takeControl();sync();if(current()){focus();await enqueue('click_screen',{...p,button:e.button===2?'right':'left'});}}catch(error){onError(error);}return;}
  focus();void flushText().catch(()=>{});if(!current())return;
  const now=Date.now(),count=now-lastClick.at<450&&Math.hypot(p.x-lastClick.x,p.y-lastClick.y)<6?Math.min(lastClick.count+1,3):1;
  lastClick={at:now,...p,count};pressed={...p,button:e.button===2?'right':e.button===1?'middle':'left',clickCount:count};
  image.setPointerCapture(e.pointerId);void enqueue('pointer_event',{type:'down',...pressed}).catch(()=>{});
 });
 image.addEventListener('pointermove',e=>{
  if(!current()||context().blocked)return;const p=point(e);if(!p)return;
  if(pressed){Object.assign(pressed,p);hover={...pressed,buttons:pressed.button==='left'?1:pressed.button==='right'?2:4};}else hover={...p,buttons:0};
  pumpPointer();
 });
 function pumpPointer(){if(hoverBusy||!hover||!current())return;const p=hover;hover=null;hoverBusy=true;void enqueue('pointer_event',{type:'move',...p}).catch(()=>{}).finally(()=>{hoverBusy=false;if(hover)pumpPointer();});}
 async function release(e){if(!pressed)return;e.preventDefault();const p=point(e)||pressed;const last={...pressed,...p};pressed=null;hover=null;void enqueue('pointer_event',{type:'move',...last,buttons:last.button==='left'?1:last.button==='right'?2:4}).catch(()=>{});void enqueue('pointer_event',{type:'up',...last}).catch(()=>{});if(image.hasPointerCapture(e.pointerId))image.releasePointerCapture(e.pointerId);}
 image.addEventListener('pointerup',release);image.addEventListener('pointercancel',release);
 image.addEventListener('contextmenu',e=>e.preventDefault());
 image.addEventListener('click',e=>{e.preventDefault();if(current())focus();});
 let wheel={x:640,y:400,deltaX:0,deltaY:0},wheelTimer;
 image.addEventListener('wheel',e=>{if(!current()||context().blocked)return;const p=point(e);if(!p)return;e.preventDefault();wheel={...p,deltaX:wheel.deltaX+e.deltaX,deltaY:wheel.deltaY+e.deltaY};clearTimeout(wheelTimer);wheelTimer=setTimeout(()=>void flushWheel(),24);},{passive:false});
 function flushWheel(){clearTimeout(wheelTimer);if(!wheel.deltaX&&!wheel.deltaY)return tail;const value=wheel;wheel={...wheel,deltaX:0,deltaY:0};return enqueue('wheel_input',value).catch(()=>{});}
 sink.addEventListener('compositionstart',()=>{composing=true;});sink.addEventListener('compositionend',e=>{composing=false;insert(e.data);sink.value='';});
 sink.addEventListener('beforeinput',e=>{if(composing||e.isComposing)return;if(e.inputType==='insertText'||e.inputType==='insertFromPaste'){e.preventDefault();insert(e.data);}else if(e.inputType==='insertLineBreak'){e.preventDefault();void key('Enter');}});
 sink.addEventListener('input',()=>{if(!composing)sink.value='';});
 sink.addEventListener('paste',e=>{if(!current())return;e.preventDefault();insert(e.clipboardData?.getData('text/plain'));});
 function key(value){void flushText().catch(()=>{});return enqueue('press_key',{key:value}).catch(()=>{});}
 const special=new Set(['Enter','Tab','Escape','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Backspace','Delete','Home','End','PageUp','PageDown','Insert']);
 sink.addEventListener('keydown',e=>{
  if(!current()||context().blocked||composing||e.isComposing)return;
  if(['Meta','Control','Alt','Shift','AltGraph','CapsLock','NumLock','Fn','Dead','Process','Unidentified'].includes(e.key))return;
  const command=e.metaKey||e.ctrlKey;
  if(e.altKey&&!command&&e.key.length===1)return; // Let macOS compose Option characters in the text sink.
  if(command&&e.key.toLowerCase()==='v')return; // Native paste event supplies the actual clipboard text.
  if(command&&e.key.toLowerCase()==='c'){e.preventDefault();void flushText().catch(()=>{});void enqueue('copy_selection',{}).catch(()=>{});return;}
  if(command||special.has(e.key)||e.altKey){e.preventDefault();const mods=[...(command?['Control']:[]),...(e.altKey?['Alt']:[]),...(e.shiftKey?['Shift']:[])];void key([...mods,e.key.length===1?e.key.toUpperCase():e.key].join('+'));}
 });
 image.addEventListener('keydown',e=>{if(current()){focus();if(special.has(e.key)){e.preventDefault();void key(e.key);}}});
 return{sync,focus,async flush(){await flushWheel();await flush();},dispose(){generation++;clearTimeout(textTimer);clearTimeout(wheelTimer);},get pending(){return tail;}};
}
