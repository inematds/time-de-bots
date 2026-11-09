// This connection stays in the main process. Signed Live View URLs never enter IPC or storage.
export function liveSocketURL(value){
  try{
    const url=new URL(value);
    if(url.protocol!=='https:'||url.hostname!=='live.browser.run'||!url.pathname.startsWith('/ui/')||url.username||url.password||url.port)return null;
    const raw=url.searchParams.get('wss');if(!raw)return null;
    const ws=new URL(raw.startsWith('wss://')?raw:`wss://${raw}`);
    if(ws.protocol!=='wss:'||ws.hostname!=='live.browser.run'||ws.port||ws.username||ws.password||!/^\/api\/devtools\/browser\/[^/]+\/page\/[^/]+$/.test(ws.pathname)||!ws.searchParams.get('jwt'))return null;
    return ws.href;
  }catch{return null;}
}
export class ComputerLive {
  constructor({onFrame=()=>{},onState=()=>{},Socket=WebSocket}={}){this.Socket=Socket;this.onFrame=onFrame;this.onState=onState;this.pending=new Map();this.id=0;this.ready=false;this.closed=false;this.timer=null;this.latest=null;this.lastFrame=0;}
  async connect(value){
    const url=liveSocketURL(value);if(!url)throw new Error('Invalid live computer connection.');
    this.socket=new this.Socket(url);
    this.socket.addEventListener('message',event=>this.message(event.data));
    this.socket.addEventListener('close',()=>this.disconnected());
    this.socket.addEventListener('error',()=>this.disconnected());
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{reject(new Error('Live preview connection timed out.'));this.close();},8000);this.socket.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});this.socket.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('Live preview unavailable.'));},{once:true});this.socket.addEventListener('close',()=>{clearTimeout(timer);reject(new Error('Live preview disconnected.'));},{once:true});});
    await this.send('Page.enable');await this.send('Page.startScreencast',{format:'jpeg',quality:80,maxWidth:1280,maxHeight:800,everyNthFrame:1});
    if(this.closed)throw new Error('Live preview closed.');this.ready=true;this.onState(true);this.heartbeat=setInterval(()=>{if(this.ready)void this.send('Page.getFrameTree').catch(()=>{});},10000);return this;
  }
  send(method,params={}){
    if(this.closed||this.socket?.readyState!==1)return Promise.reject(new Error('Live preview disconnected.'));
    const id=++this.id;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('The live connection was interrupted. Check the page before retrying your last input.'));this.socket?.close();this.disconnected();},5000);this.pending.set(id,{resolve,reject,timer});this.socket.send(JSON.stringify({id,method,params}));});
  }
  message(raw){
    let event;try{event=JSON.parse(raw);}catch{return;}
    if(event.id){const job=this.pending.get(event.id);if(job){this.pending.delete(event.id);clearTimeout(job.timer);event.error?job.reject(new Error('Live computer command failed.')):job.resolve(event.result);}return;}
    if(event.method==='Page.screencastFrame'){
      // Acknowledge every frame immediately; render only the newest at up to 25 fps.
      if(this.socket?.readyState===1)this.socket.send(JSON.stringify({id:++this.id,method:'Page.screencastFrameAck',params:{sessionId:event.params.sessionId}}));
      const data=event.params.data;if(typeof data!=='string'||data.length>6000000)return;
      this.latest={dataUrl:`data:image/jpeg;base64,${data}`,at:Date.now(),live:true};
      if(!this.timer)this.timer=setTimeout(()=>{this.timer=null;this.lastFrame=Date.now();if(!this.closed&&this.latest){this.onFrame(this.latest);this.latest=null;}},Math.max(0,40-(Date.now()-this.lastFrame)));
    }else if(event.method==='Page.frameNavigated'&&!event.params?.frame?.parentId){this.url=event.params.frame.url;}
    else if(event.method==='Page.navigatedWithinDocument')this.url=event.params.url;
  }
  async input(name,args){
    const point=()=>{const {x,y}=args;if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||x>1280||y<0||y>800)throw new Error('Invalid pointer coordinates.');return{x,y};};
    if(name==='type_text'){
      if(typeof args.text!=='string'||args.text.length>10000)throw new Error('Invalid keyboard input.');await this.send('Input.insertText',{text:args.text});
    }else if(name==='pointer_event'){
      const p=point(),type={down:'mousePressed',up:'mouseReleased',move:'mouseMoved'}[args.type];if(!type)throw new Error('Invalid pointer event.');
      const button=['left','middle','right'].includes(args.button)?args.button:'none',buttons=Number.isInteger(args.buttons)?args.buttons:args.type==='down'?{left:1,right:2,middle:4}[button]||0:0;
      await this.send('Input.dispatchMouseEvent',{type,...p,button,buttons,clickCount:Math.min(3,Math.max(1,args.clickCount||1))});
    }else if(name==='click_screen'||name==='move_pointer'){
      const p=point(),button=args.button==='right'?'right':'left';await this.send('Input.dispatchMouseEvent',{type:'mouseMoved',...p});
      if(name==='click_screen'){await this.send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button,buttons:button==='left'?1:2,clickCount:args.clickCount||1});await this.send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button,buttons:0,clickCount:args.clickCount||1});}
    }else if(name==='scroll_page'||name==='wheel_input'){
      const x=Number.isFinite(args.x)?Math.min(1280,Math.max(0,args.x)):640,y=Number.isFinite(args.y)?Math.min(800,Math.max(0,args.y)):400;
      if(name==='scroll_page'&&(!['up','down'].includes(args.direction)||!Number.isFinite(args.amount)))throw new Error('Invalid scroll input.');
      const deltaX=name==='wheel_input'?Math.min(2000,Math.max(-2000,Number(args.deltaX)||0)):0,deltaY=name==='wheel_input'?Math.min(2000,Math.max(-2000,Number(args.deltaY)||0)):Math.min(1600,Math.abs(args.amount))*(args.direction==='up'?-1:1);
      await this.send('Input.dispatchMouseEvent',{type:'mouseWheel',x,y,deltaX,deltaY});
    }else if(name==='press_key'){
      const parts=String(args.key).split('+'),base=parts.pop(),modifiers=(parts.includes('Alt')?1:0)|(parts.includes('Control')?2:0)|(parts.includes('Meta')?4:0)|(parts.includes('Shift')?8:0);
      const codes={Enter:13,Tab:9,Escape:27,ArrowUp:38,ArrowDown:40,ArrowLeft:37,ArrowRight:39,Backspace:8,Delete:46,Home:36,End:35,PageUp:33,PageDown:34,Insert:45,Space:32};
      if(parts.some(p=>!['Shift','Control','Meta','Alt'].includes(p))||(!codes[base]&&!/^[A-Z0-9]$/.test(base)))throw new Error('Unsupported keyboard input.');
      const code=codes[base]||base.charCodeAt(0),params={key:base.length===1?base.toLowerCase():base,code:/^[A-Z]$/.test(base)?'Key'+base:/^[0-9]$/.test(base)?'Digit'+base:base,windowsVirtualKeyCode:code,modifiers};
      await this.send('Input.dispatchKeyEvent',{type:base==='Enter'?'keyDown':'rawKeyDown',...params,...(base==='Enter'?{text:'\r',unmodifiedText:'\r'}:{})});await this.send('Input.dispatchKeyEvent',{type:'keyUp',...params});
    }else if(name==='copy_selection'){
      const result=await this.send('Runtime.evaluate',{expression:`(()=>{const e=document.activeElement;if(e&&typeof e.selectionStart==='number')return e.value.slice(e.selectionStart,e.selectionEnd);return window.getSelection()?.toString()||''})()`,returnByValue:true});return{live:true,clipboardText:String(result.result?.value||'').slice(0,1000000)};
    }else throw new Error('Unsupported live input.');
    return {live:true};
  }
  disconnected(){if(this.disconnectedOnce)return;this.disconnectedOnce=true;clearInterval(this.heartbeat);this.ready=false;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('Live computer disconnected. Inspect the page before retrying input.'));}this.pending.clear();if(!this.closed)this.onState(false);}
  close(){this.closed=true;clearInterval(this.heartbeat);clearTimeout(this.timer);this.disconnected();this.socket?.close();}
}
