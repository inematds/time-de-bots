import {ComputerLive,liveSocketURL} from './computer-live.mjs';
import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
const canonical=value=>Array.isArray(value)?`[${value.map(canonical).join(',')}]`:value&&typeof value==='object'?`{${Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')}}`:JSON.stringify(value);
const digest=value=>createHash('sha256').update(value).digest('hex');
export const COMPUTER_ACTIONS=['browse_url','inspect_page','capture_screen','click_element','fill_field','press_key','select_option','scroll_page','wait_for','click_screen','type_text','run_command','list_files','read_file','create_file','edit_file'];
export class CloudComputer {
  constructor(connections,{fetcher=fetch,onFrame=()=>{},onState=()=>{}}={}){this.connections=connections;this.fetcher=fetcher;this.onFrame=onFrame;this.onState=onState;this.frames=new Map();this.seats=new Set();this.states=new Map();this.starts=new Map();this.epochs=new Map();this.operations=new Map();this.requests=new Map();this.liveLinks=new Map();this.live=new Map();this.watched=null;this.liveGeneration=0;this.observations=new Map();this.inputOperations=new Map();this.controlOperations=new Map();this.serverOwners=new Map();}
  async request(path,body,signal){
    const cloud=this.connections.value.cloud;if(!cloud?.token)throw new Error('Connect a cloud computer in Settings first.');
    const timeoutMs=path==='/heartbeat'?15000:path==='/execute'&&body.name==='run_command'?125000:60000;
    const controller=new AbortController(),id=body.auditContext?.conversationId||body.conversationId;
    if(id){const set=this.requests.get(id)||new Set();set.add(controller);this.requests.set(id,set);}
    try{
      const requestSignal=AbortSignal.any([controller.signal,AbortSignal.timeout(timeoutMs),...(signal?[signal]:[])]);
      const encoded=JSON.stringify(body),retryable=path==='/execute'||path==='/heartbeat';
      for(let attempt=0;attempt<3;attempt++){
        try{
          const response=await this.fetcher(cloud.endpoint+path,{method:'POST',headers:{Authorization:`Bearer ${cloud.token}`,'Content-Type':'application/json'},body:encoded,signal:requestSignal,redirect:'error'});
          if(response.ok)return await response.json();
          const problem=await response.json().catch(()=>({}));
          const transient=[502,503,504].includes(response.status)||(response.status===409&&/already in flight/i.test(problem.error||''));
          if(!retryable||!transient||attempt===2)throw new Error(`Cloud computer returned ${response.status}. ${problem.error||'Try Refresh to reconnect.'}`);
        }catch(error){
          if(requestSignal.aborted)throw requestSignal.reason;
          if(!retryable||attempt===2||!(error instanceof TypeError))throw error;
        }
        // Reuse the exact receipt ID and payload: the gateway never executes a retry twice.
        await delay(300*(attempt+1),undefined,{signal:requestSignal});
      }
      throw new Error('The cloud computer could not reconnect. Try Refresh.');
    }catch(error){if(error instanceof TypeError)throw new Error('Connection to the cloud computer was interrupted. Your last screen is preserved. Try Refresh.');if(error.name==='TimeoutError')throw new Error('The browser took too long to respond. Your last screen is preserved. Try Refresh or Restart browser.');throw error;}
    finally{if(id){const set=this.requests.get(id);set?.delete(controller);if(!set?.size)this.requests.delete(id);}}
  }
  async health(){return this.request('/heartbeat',{});}
  state(conversationId){const value=this.states.get(conversationId)||{conversationId,status:'idle'};return value.status==='ready'&&Date.now()-(this.frames.get(conversationId)?.at||0)>240000?{...value,status:'idle',liveStatus:this.watched?.conversationId===conversationId?(this.live.get(conversationId)?.ready?'live':this.live.has(conversationId)?'connecting':'reconnecting'):'inactive',live:!!this.live.get(conversationId)?.ready}:{...value,liveStatus:this.watched?.conversationId===conversationId?(this.live.get(conversationId)?.ready?'live':this.live.has(conversationId)?'connecting':'reconnecting'):'inactive',live:!!this.live.get(conversationId)?.ready};}
  snapshot(conversationId){return {state:this.state(conversationId),frame:this.frames.get(conversationId)||null};}
  setState(conversationId,status,error,notice){const state={conversationId,status,...(error?{error}:{}),...(notice?{notice}:{}),updatedAt:Date.now()};this.states.set(conversationId,state);this.onState(this.state(conversationId));}
  serialize(conversationId,operation){const epoch=this.epochs.get(conversationId)||0;const previous=this.operations.get(conversationId)||Promise.resolve();const next=previous.catch(()=>{}).then(()=>{if(epoch!==(this.epochs.get(conversationId)||0))throw new Error('Computer operation cancelled.');return operation();});this.operations.set(conversationId,next);next.finally(()=>{if(this.operations.get(conversationId)===next)this.operations.delete(conversationId);}).catch(()=>{});return next;}
  start({botId,conversationId,restart=false}){
    if(!this.connections.value.cloud?.token)throw new Error('Connect a cloud computer first.');
    if(this.starts.has(conversationId))return this.starts.get(conversationId).promise;
    const existing=this.frames.get(conversationId);
    if(!restart&&this.state(conversationId).status==='ready'&&existing&&Date.now()-existing.at<240000)return Promise.resolve(this.snapshot(conversationId));
    const controller=new AbortController(),epoch=this.epochs.get(conversationId)||0;
    this.setState(conversationId,'starting');
    const job={botId,controller,promise:null};
    job.promise=this.serialize(conversationId,async()=>{
      try{
        if(restart)await this.request('/restart-browser',{conversationId,agentComputerId:`gratis-${botId}`},controller.signal);
        const owner=await this.request('/browser-control',{conversationId,agentComputerId:`gratis-${botId}`},controller.signal);this.serverOwners.set(conversationId,!!owner.human);
        const first=await this._execute({botId,conversationId,name:'capture_screen',args:{},humanControl:true,signal:controller.signal});
        if(!first.observation?.url||first.observation.url==='about:blank')await this._execute({botId,conversationId,name:'browse_url',args:{url:this.connections.value.cloud.endpoint+'/start'},humanControl:true,signal:controller.signal});
        if(!this.frames.has(conversationId))throw new Error('The computer did not return a screen. Try starting it again.');
        if(epoch===(this.epochs.get(conversationId)||0))this.setState(conversationId,'ready');
        return this.snapshot(conversationId);
      }catch(error){if(epoch===(this.epochs.get(conversationId)||0))this.setState(conversationId,this.frames.has(conversationId)?'attention':'error',error.message);throw error;}
    }).finally(()=>{if(this.starts.get(conversationId)===job)this.starts.delete(conversationId);});
    this.starts.set(conversationId,job);return job.promise;
  }
  async execute(options){
    const {conversationId}=options;const starting=this.starts.get(conversationId);if(starting)await starting.promise;
    return this.serialize(conversationId,async()=>{
      const epoch=this.epochs.get(conversationId)||0;this.setState(conversationId,'working');
      try{const result=await this._execute(options);if(epoch===(this.epochs.get(conversationId)||0))this.setState(conversationId,this.frames.has(conversationId)?'ready':'idle',undefined,result.observation?.warnings?.join(' '));return result;}
      catch(error){if(epoch===(this.epochs.get(conversationId)||0))this.setState(conversationId,this.frames.has(conversationId)?'attention':'error',error.message);throw error;}
    });
  }
  async _execute({botId,conversationId,name,args={},signal,humanControl=false,finishStarted=false}){
    const epoch=this.epochs.get(conversationId)||0;
    if(name==='inspect_page'&&Number.isFinite(args.limit))args={...args,limit:Math.min(120,Math.max(1,Math.round(args.limit)))};
    if(!COMPUTER_ACTIONS.includes(name))throw new Error('Unsupported computer action.');
    signal?.throwIfAborted();
    const agentComputerId=`gratis-${botId}`,argumentDigest=digest(canonical(args));
    const value=await this.request('/execute',{name,args,mode:'workspace-write',allowCommands:true,approvedTarget:true,networkAllowlist:[],auditContext:{actionId:`gratis-${randomUUID()}`,conversationId,agentComputerId,humanControl,argumentDigest,expiresAt:Date.now()+120000}},finishStarted?undefined:signal);
    if(value.argumentDigest!==argumentDigest||!/^runner-[a-zA-Z0-9_-]{8,160}$/.test(value.receiptId||''))throw new Error('The computer returned an unverifiable action receipt.');
    if(value.output?.startsWith('Sandbox action failed:'))throw new Error(value.output.slice(0,800));
    if(name==='run_command'&&/^Exit code: (?!0\b)\d+/.test(value.output||''))throw new Error(value.output.slice(0,2000));
    if(epoch!==(this.epochs.get(conversationId)||0))throw new Error('Computer operation cancelled.');
    this.seats.add(`${botId}/${conversationId}`);
    if(value.browserObservation)this.observations.set(conversationId,value.browserObservation);
    if(value.visualArtifact?.liveViewUrl){const prior=this.liveLinks.get(conversationId)?.url,next=value.visualArtifact.liveViewUrl;if(prior&&liveSocketURL(prior)?.split('?')[0]!==liveSocketURL(next)?.split('?')[0]){this.live.get(conversationId)?.close();this.live.delete(conversationId);}this.liveLinks.set(conversationId,{url:value.visualArtifact.liveViewUrl,at:Date.now(),botId});if(this.watched?.conversationId===conversationId)void this.connectLive(conversationId);}
    if(value.visualArtifact){const f=value.visualArtifact;if(f.mimeType!=='image/png'||typeof f.dataBase64!=='string'||f.dataBase64.length>6000000||digest(Buffer.from(f.dataBase64,'base64'))!==f.sha256)throw new Error('The computer returned an invalid screenshot.');const frame={botId,conversationId,dataUrl:`data:image/png;base64,${f.dataBase64}`,url:f.currentUrl,title:f.pageTitle,at:Date.now()};const live=this.live.get(conversationId),previous=this.frames.get(conversationId);if(!live?.ready||!previous){this.frames.set(conversationId,frame);this.onFrame(frame);}else{const metadata={...previous,url:live.url||frame.url,title:frame.title};this.frames.set(conversationId,metadata);this.onFrame(metadata);}}
    return {output:value.output,observation:value.browserObservation,outcome:value.browserOutcome,receiptId:value.receiptId,...(value.visualArtifact?{image:value.visualArtifact.dataBase64}:{})};
  }
  watch(botId,conversationId,visible){
    if(!visible){if(this.watched?.conversationId===conversationId)this.unwatch();return;}
    if(this.watched?.conversationId!==conversationId){this.unwatch();this.watched={botId,conversationId};}
    void this.connectLive(conversationId);
  }
  unwatch(){this.liveGeneration++;clearTimeout(this.liveRetry);this.watched=null;for(const client of this.live.values())client.close();this.live.clear();}
  async connectLive(conversationId){
    if(this.watched?.conversationId!==conversationId||this.live.has(conversationId))return;
    const link=this.liveLinks.get(conversationId);if(!link||Date.now()-link.at>240000){
      if(this.refreshingLive)return;this.refreshingLive=true;
      try{await this.execute({botId:this.watched.botId,conversationId,name:'capture_screen',args:{},humanControl:true});}catch{}finally{this.refreshingLive=false;if(this.watched&&this.watched.conversationId!==conversationId)void this.connectLive(this.watched.conversationId);}
      return;
    }
    const generation=this.liveGeneration;
    const client=new ComputerLive({onFrame:value=>{
      if(this.watched?.conversationId!==conversationId||generation!==this.liveGeneration)return;
      const previous=this.frames.get(conversationId);const frame={...previous,botId:link.botId,conversationId,...value,url:client.url||previous?.url};this.frames.set(conversationId,frame);this.onFrame(frame);
    },onState:ready=>{
      if(this.watched?.conversationId!==conversationId||generation!==this.liveGeneration||this.live.get(conversationId)!==client)return;
      this.onState(this.state(conversationId));
      if(!ready){client.close();this.live.delete(conversationId);this.liveLinks.delete(conversationId);clearTimeout(this.liveRetry);this.liveRetry=setTimeout(()=>void this.connectLive(conversationId),2500);}
    }});
    this.live.set(conversationId,client);
    try{await client.connect(link.url);if(generation!==this.liveGeneration)client.close();}
    catch{if(this.live.get(conversationId)===client){client.close();this.live.delete(conversationId);this.liveLinks.delete(conversationId);if(this.watched?.conversationId===conversationId)this.liveRetry=setTimeout(()=>void this.connectLive(conversationId),5000);}}
  }
  control(botId,conversationId,human){
    const previous=this.controlOperations.get(conversationId)||Promise.resolve();
    const job=previous.catch(()=>{}).then(async()=>{const state=await this.request('/browser-control',{conversationId,agentComputerId:`gratis-${botId}`,human});this.serverOwners.set(conversationId,!!state.human);return state;});
    this.controlOperations.set(conversationId,job);job.finally(()=>{if(this.controlOperations.get(conversationId)===job)this.controlOperations.delete(conversationId);}).catch(()=>{});return job;
  }
  manualInput({conversationId,name,args,canUse}){
    const client=this.live.get(conversationId);
    if(!client?.ready||!['click_screen','type_text','scroll_page','press_key','move_pointer','pointer_event','wheel_input','copy_selection'].includes(name))return null;
    const previous=this.inputOperations.get(conversationId)||Promise.resolve();const job=previous.catch(()=>{}).then(()=>{if(!canUse())throw new Error('Computer control has been returned to the bot.');return client.input(name,args);});this.inputOperations.set(conversationId,job);job.finally(()=>{if(this.inputOperations.get(conversationId)===job)this.inputOperations.delete(conversationId);}).catch(()=>{});return job;
  }
  async whenIdle(conversationId){while(this.operations.has(conversationId)||this.inputOperations.has(conversationId))await Promise.allSettled([this.operations.get(conversationId),this.inputOperations.get(conversationId)]);}
  async dispose(botId,conversationId){
    if(this.watched?.conversationId===conversationId)this.unwatch();this.liveLinks.delete(conversationId);this.observations.delete(conversationId);
    this.epochs.set(conversationId,(this.epochs.get(conversationId)||0)+1);this.setState(conversationId,'stopping');
    this.starts.get(conversationId)?.controller.abort(new DOMException('Stopped','AbortError'));
    for(const controller of this.requests.get(conversationId)||[])controller.abort(new DOMException('Stopped','AbortError'));
    await this.operations.get(conversationId)?.catch(()=>{});
    try{await this.request('/dispose',{conversationId,agentComputerId:`gratis-${botId}`});this.frames.delete(conversationId);this.serverOwners.delete(conversationId);this.seats.delete(`${botId}/${conversationId}`);this.setState(conversationId,'stopped');}
    catch(error){this.setState(conversationId,this.frames.has(conversationId)?'attention':'error',error.message);throw error;}
  }
  async close(){this.unwatch();let timer;await Promise.race([Promise.allSettled([...new Set([...this.seats,...[...this.starts.keys()].map(id=>{const job=this.starts.get(id);return job?`${job.botId}/${id}`:null;}).filter(Boolean)])].map(key=>{const [botId,conversationId]=key.split('/');return this.dispose(botId,conversationId);})),new Promise(resolve=>{timer=setTimeout(resolve,5000);})]);clearTimeout(timer);}
}
