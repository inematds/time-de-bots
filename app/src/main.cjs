const { app, BrowserWindow, ipcMain, dialog, nativeTheme, Menu, systemPreferences, shell, clipboard, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const { pathToFileURL } = require('node:url');

const edition=require('../edition.json');
app.setName(edition.name);
const dataOverride = process.env.GRATIS_DATA_DIR;
const dataDir = dataOverride || (app.isPackaged
  ? path.join(app.getPath('appData'), edition.dataFolder, 'data') : path.resolve(__dirname, '../data'));
app.setPath('userData', path.join(dataDir, 'electron'));
require('node:fs').mkdirSync(app.getPath('userData'), { recursive: true, mode: 0o700 });
if (!app.requestSingleInstanceLock()) app.exit(0);
const humanComputers=new Set(),computerControlEpochs=new Map(),computerControlRevisions=new Map();
function setHumanControl(id,human){if(humanComputers.has(id)!==human){human?humanComputers.add(id):humanComputers.delete(id);computerControlRevisions.set(id,(computerControlRevisions.get(id)||0)+1);}}
const controlState=value=>({...value,control:humanComputers.has(value.conversationId)?'human':'bot',controlRevision:computerControlRevisions.get(value.conversationId)||0});
const computerSnapshot=id=>{const snapshot=cloud.snapshot(id);return {...snapshot,state:controlState(snapshot.state)};};
let window, service, connections, files, cloud, signIn, memory, t3Connection, t3Tasks, t3Host, schedules, closing = false, finishDraftFlush, voiceTask;
app.on('activate',()=>{if(window&&!window.isDestroyed()){window.show();window.focus();}});
app.on('second-instance', () => { if (window && !window.isDestroyed()) { window.show(); window.focus(); } });
async function shutdown() {
  if (closing) return;
  closing = true;
  if (window && !window.isDestroyed()) {
    await new Promise(resolve => {
      const timer = setTimeout(resolve, 2000);
      finishDraftFlush = () => { clearTimeout(timer); resolve(); };
      window.webContents.send('orbit:closing');
    });
  }
  const activeVoice = voiceTask;
  activeVoice?.controller.abort(new DOMException('App closed', 'AbortError'));
  try { await activeVoice?.promise?.catch(() => {}); await signIn?.cancel({preserve:true}); await schedules?.close(); await t3Tasks?.close(); await t3Connection?.close(); await service?.close(); await cloud?.close(); } finally { app.exit(0); }
}
const actions = ['createBot', 'deleteBot', 'selectBot', 'newConversation', 'selectConversation', 'setDraft',
  'createThread','renameThread','updateThreadMembers','pinThread','deleteThread','updateSettings', 'updateBot', 'duplicateBot', 'respondApproval', 'updateQueue', 'send', 'stop', 'retry'];
function authorized(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame)
    throw new Error('Unknown renderer');
}
function broadcast(snapshot) {
  if (window && !window.isDestroyed()) window.webContents.send('orbit:state', snapshot);
}
app.whenReady().then(async () => {
  const { ChatService } = await import('./chat-service.mjs');
  const [{Connections},{WorkspaceFiles},{CloudComputer},{agentRuntime},{ComposioSignIn}] = await Promise.all([import('./connections.mjs'),import('./workspace-files.mjs'),import('./cloud-computer.mjs'),import('./agent-tools.mjs'),import('./composio-signin.mjs')]);
  connections=await new Connections({directory:dataDir,encrypt:text=>{if(!safeStorage.isEncryptionAvailable())throw new Error('Secure storage is unavailable.');return safeStorage.encryptString(text);},decrypt:buffer=>safeStorage.decryptString(buffer)}).init();
  signIn=new ComposioSignIn({directory:dataDir,binary:app.isPackaged?path.join(process.resourcesPath,'composio-cli','composio'):path.join(__dirname,'../assets/composio-cli/composio'),connections,openExternal:url=>shell.openExternal(url),onState:state=>{if(window&&!window.isDestroyed())window.webContents.send('orbit:signin-state',state);}});
  connections.onChange=()=>{if(window&&!window.isDestroyed())window.webContents.send('orbit:connections-changed');};
  const [{T3Connection},{T3Tasks},{T3LocalHost}]=await Promise.all([import('./t3-connection.mjs'),import('./t3-tasks.mjs'),import('./t3-local.mjs')]);
  const t3Changed=()=>{if(window&&!window.isDestroyed())window.webContents.send('orbit:t3-changed');};
  t3Connection=await new T3Connection({directory:dataDir,encrypt:connections.encrypt,decrypt:connections.decrypt,openExternal:url=>shell.openExternal(url),onState:t3Changed}).init();
  t3Host=new T3LocalHost({home:dataOverride?path.join(dataDir,'t3-host'):path.join(app.getPath('appData'),edition.dataFolder,'t3'),installer:path.join(__dirname,'assets/t3-install.sh'),onProgress:message=>t3Connection.update('installing',message)});
  t3Tasks=await new T3Tasks({directory:dataDir,encrypt:connections.encrypt,decrypt:connections.decrypt,connection:t3Connection,onChange:t3Changed,onResult:async job=>{
    if(closing||!service?.state)return;const c=service.state.conversations.find(c=>c.id===job.conversationId);if(!c)return;
    if(!c.messages.some(m=>m.sourceT3JobId===job.id)){c.messages.push({id:require('node:crypto').randomUUID(),role:'assistant',kind:'t3-result',botId:job.botId,status:'complete',createdAt:Date.now(),sourceT3JobId:job.id,content:'**T3 task '+(job.status==='completed'?'finished':job.status)+': '+job.title+'**\n\n'+(job.result||job.error||'Open Tasks to review the T3 run.')});c.updatedAt=Date.now();await service._changed();}
  }}).init();
  const scheduleAgent=args=>{
    const c=service._conversation(args.conversationId),root=c.parentThreadId?service._conversation(c.parentThreadId):c;
    const source=service.promptMessages(root).findLast(m=>m.role==='user');
    return {list:()=>schedules.snapshot(root.id),create:input=>{if(c.parentThreadId||source?.sourceScheduleRunId)throw new Error('Only a user request to the primary bot can create a schedule.');return schedules.create({...input,conversationId:root.id,sourceMessageId:source?.id});},update:input=>{if(c.parentThreadId||source?.sourceScheduleRunId)throw new Error('Schedules can only be changed by a user request to the primary bot.');return schedules.update({...input,conversationId:root.id});},remove:input=>{if(c.parentThreadId||source?.sourceScheduleRunId)throw new Error('Schedules can only be removed by a user request to the primary bot.');return schedules.remove({...input,conversationId:root.id});}};
  };
  const t3Agent=args=>{
    const binding=t3Connection.data.bindings?.[args.bot.id];if(!binding||!t3Connection.data.endpoint)return undefined;
    const conversationId=service._conversation(args.conversationId).parentThreadId||args.conversationId;
    return{binding,submit:input=>t3Tasks.submit({...input,...binding,conversationId,botId:args.bot.id,sourceMessageId:args.sourceMessageId}),read:id=>t3Tasks.refresh({id,conversationId}).then(jobs=>jobs.find(j=>j.id===id)),send:(id,message)=>t3Tasks.followup({id,message,conversationId}),stop:id=>t3Tasks.cancel({id,conversationId})};
  };
  files=new WorkspaceFiles(dataDir);
  cloud=new CloudComputer(connections,{onFrame:frame=>{if(window&&!window.isDestroyed())window.webContents.send('orbit:computer-frame',frame);},onState:state=>{if(window&&!window.isDestroyed())window.webContents.send('orbit:computer-state',controlState(state));}});
  const {MemoryService}=await import('./memory-service.mjs'),{MemoryEmbeddings}=await import('./memory-embeddings.mjs'),{memoryKeyring}=await import('./memory-keyring.mjs');
  const embeddings=new MemoryEmbeddings({modelPath:(app.isPackaged?path.join(process.resourcesPath,'models','sentence-encoder'):path.join(__dirname,'../assets/models/sentence-encoder'))+path.sep});
  memory=await new MemoryService({directory:dataDir,...memoryKeyring(safeStorage),embeddings,onChange:value=>{if(window&&!window.isDestroyed())window.webContents.send('orbit:memory-changed',value);}}).init();
  service = new ChatService({ dataDir, memory, workspaceFiles:files, onChange: broadcast,
    onGroupMembersChanging:async({retired,retained})=>{
      for(const seat of [...retired,...retained])computerControlEpochs.set(seat.conversationId,(computerControlEpochs.get(seat.conversationId)||0)+1);
      const results=await Promise.allSettled([
        ...retired.map(async seat=>{if(connections.status().cloud)await cloud.dispose(seat.botId,seat.conversationId);setHumanControl(seat.conversationId,false);}),
        ...retained.map(async seat=>{if(connections.status().cloud&&(humanComputers.has(seat.conversationId)||cloud.serverOwners.get(seat.conversationId))){await cloud.whenIdle(seat.conversationId);await cloud.control(seat.botId,seat.conversationId,false);}setHumanControl(seat.conversationId,false);if(window&&!window.isDestroyed())window.webContents.send('orbit:computer-state',computerSnapshot(seat.conversationId).state);}),
      ]);
      if(results.some(r=>r.status==='rejected'))throw new Error('Could not finish stopping a group computer. Your member changes have not been saved. Try again.');
    },runtimeFactory:args=>agentRuntime({...args,files,cloud,connections,canUseComputer:()=>!humanComputers.has(args.conversationId),t3:t3Agent(args),schedules:scheduleAgent(args)}) });
  await service.init();
  await (await import('./edition-setup.mjs')).applyEdition(service,edition);
  const {Schedules}=await import('./schedules.mjs');
  schedules=await new Schedules({directory:dataDir,encrypt:connections.encrypt,decrypt:connections.decrypt,service,onChange:()=>{if(window&&!window.isDestroyed())window.webContents.send('orbit:schedules-changed');}}).init();
  schedules.start();
  t3Tasks.start();
  for(const c of service.snapshot().conversations)if(c.computerPause)setHumanControl(c.id,true);
  if (app.isPackaged && !dataOverride) {
    const primary = service.snapshot().bots[0];
    if (primary?.name === 'Personal assistant' && primary.instructions === 'Be helpful, clear, and concise.')
      await service.updateBot({ id: primary.id, name: 'Assistente' });
  }
  window = new BrowserWindow({ width: 1496, height: 938, minWidth: 512, minHeight: 520, show: false,
    title: edition.name, backgroundColor: '#121212', titleBarStyle: 'hiddenInset', trafficLightPosition: { x:16,y:15 },
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true } });
  let workspaceFullscreen=false,priorFullscreen=false,priorSimpleFullscreen=false;
  function setWorkspaceFullscreen(enabled){
    if(enabled===workspaceFullscreen)return enabled;
    if(enabled){priorFullscreen=window.isFullScreen();priorSimpleFullscreen=process.platform==='darwin'&&window.isSimpleFullScreen();}
    workspaceFullscreen=enabled;
    if(process.platform==='darwin'){
      if(!priorFullscreen)window.setSimpleFullScreen(enabled||priorSimpleFullscreen);
      window.setWindowButtonVisibility(!enabled);
    }else if(!priorFullscreen)window.setFullScreen(enabled);
    window.webContents.send('orbit:workspace-fullscreen',enabled);return enabled;
  }
  ipcMain.handle('orbit:edition',e=>{authorized(e);return {id:edition.id,name:edition.name};});
  ipcMain.handle('orbit:workspace-fullscreen',(e,enabled)=>{authorized(e);if(typeof enabled!=='boolean')throw new Error('Invalid fullscreen mode.');return setWorkspaceFullscreen(enabled);});
  window.webContents.on('before-input-event',(event,input)=>{if(workspaceFullscreen&&input.type==='keyDown'&&['Escape','Esc'].includes(input.key)){event.preventDefault();setWorkspaceFullscreen(false);}});
  window.on('close', e => { e.preventDefault(); if(schedules.items.some(i=>i.enabled)){window.hide();}else void shutdown(); });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const pageURL = pathToFileURL(path.join(__dirname, 'index.html')).href;
  window.webContents.on('will-navigate', (e, url) => { if (url !== pageURL) e.preventDefault(); });
  window.webContents.session.setPermissionRequestHandler((wc, permission, cb, details) => cb(wc === window.webContents && (permission === 'fullscreen' || permission === 'media' && details.mediaTypes?.includes('audio') && details.mediaTypes.every(type => type === 'audio'))));
  window.webContents.session.setPermissionCheckHandler((wc, permission, _origin, details) => wc === window.webContents && (permission === 'fullscreen' || permission === 'media' && details.mediaType === 'audio'));
  window.webContents.session.webRequest.onBeforeRequest((details, cb) => {
    cb({ cancel: !['file:', 'data:', 'devtools:'].some(p => details.url.startsWith(p)) });
  });
  ipcMain.handle('orbit:snapshot', e => { authorized(e); return service.snapshot(); });
  ipcMain.handle('orbit:open-external', async (e,value) => {authorized(e);const url=new URL(value);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new Error('Only web links can be opened.');await shell.openExternal(url.href);});
  ipcMain.handle('orbit:copy-text', (e,value) => {authorized(e);if(typeof value!=='string'||value.length>2000000)throw new Error('Invalid clipboard text.');clipboard.writeText(value);});
  ipcMain.handle('orbit:bot-menu', (e, value) => {
    authorized(e);
    if (!service.snapshot().bots.some(bot => bot.id === value?.id)) throw new Error('Bot not found.');
    return new Promise(resolve => {
      const menu = Menu.buildFromTemplate([
        { id: 'edit', label: 'Edit bot', click: () => resolve('edit') },
        { label: 'Duplicate bot', click: () => resolve('duplicate') },
        { label: service.snapshot().bots.find(b=>b.id===value.id)?.pinned?'Unpin bot':'Pin bot', click: () => resolve('pin') },
        { type: 'separator' },
        { id: 'delete', label: 'Delete bot…', click: () => resolve('delete') },
      ]);
      menu.popup({ window, callback: () => resolve(null) });
    });
  });
  ipcMain.handle('orbit:thread-menu',(e,value)=>{
    authorized(e);const chat=service._conversation(value?.conversationId);service._threadOpen(chat);
    if(chat.kind!=='group'||chat.parentThreadId)throw new Error('Group chat not found.');
    return new Promise(resolve=>{const menu=Menu.buildFromTemplate([
      {id:'rename',label:'Rename chat…',click:()=>resolve('rename')},
      {id:'members',label:'Edit members…',click:()=>resolve('members')},
      {id:'pin',label:chat.pinned?'Unpin chat':'Pin chat',click:()=>resolve('pin')},
      {type:'separator'},
      {id:'delete',label:'Delete chat…',click:()=>resolve('delete')},
    ]);menu.popup({window,callback:()=>resolve(null)});});
  });
  ipcMain.handle('orbit:memory-view',async(e,{conversationId})=>{authorized(e);return memory.view(conversationId);});
  ipcMain.handle('orbit:memory-search',async(e,{conversationId,...value})=>{authorized(e);return memory.search(conversationId,{...value,view:true});});
  for(const [name,operation]of Object.entries({add:(id,v)=>memory.learn(id,v,{manual:true}),edit:(id,v)=>memory.edit(id,v),confirm:(id,v)=>memory.confirm(id,v.id),forget:(id,v)=>memory.remove(id,v.id),retry:id=>memory.retry(id)}))ipcMain.handle('orbit:memory-'+name,async(e,{conversationId,...value})=>{authorized(e);await operation(conversationId,value);return memory.view(conversationId);});
  ipcMain.handle('orbit:memory-enable',async(e,{enabled,conversationId})=>{authorized(e);await memory.enable(enabled);return memory.view(conversationId);});
  ipcMain.handle('orbit:memory-export',async(e,{conversationId})=>{authorized(e);const view=await memory.view(conversationId),result=await dialog.showSaveDialog(window,{title:'Export these memories',defaultPath:'gratis-memory.json',filters:[{name:'JSON',extensions:['json']}]});if(result.canceled||!result.filePath)return false;await fs.writeFile(result.filePath,JSON.stringify({exportedAt:new Date().toISOString(),profile:view.profile,facts:view.facts,history:view.history,episodes:view.episodes},null,2),{mode:0o600});return true;});
  ipcMain.handle('orbit:signin-start', e=>{authorized(e);return signIn.start();});
  ipcMain.handle('orbit:signin-state', e=>{authorized(e);return signIn.state();});
  ipcMain.handle('orbit:signin-cancel', e=>{authorized(e);return signIn.cancel();});
  ipcMain.handle('orbit:signin-open', e=>{authorized(e);return signIn.reopen();});
  ipcMain.handle('orbit:connections', async e => {authorized(e);return connections.status();});
  ipcMain.handle('orbit:configure-connections', async (e,value) => {authorized(e);return connections.configure(value);});
  ipcMain.handle('orbit:connection-catalog', async (e,search) => {authorized(e);return connections.catalog(search);});
  ipcMain.handle('orbit:connect-app', async (e,slug) => {authorized(e);const url=await connections.connect(slug);await shell.openExternal(url);return true;});
  const t3Scope=value=>{const c=service._conversation(value?.conversationId);service._threadOpen(c);return c;};
  for(const [name,operation]of Object.entries({view:v=>schedules.snapshot(v.conversationId),create:v=>schedules.create(v),update:v=>schedules.update(v),remove:v=>schedules.remove(v),run:v=>schedules.runNow(v)}))ipcMain.handle('orbit:schedules-'+name,async(e,value)=>{authorized(e);service._conversation(value?.conversationId);return operation(value);});
  ipcMain.handle('orbit:t3-view',(e,value)=>{authorized(e);const c=t3Scope(value);return{connection:t3Connection.snapshot(),binding:t3Connection.data.bindings?.[c.botId]||null,jobs:t3Tasks.snapshot(c.id)};});
  ipcMain.handle('orbit:t3-connect',async(e,value)=>{authorized(e);return t3Connection.connect({endpoint:value?.endpoint});});
  ipcMain.handle('orbit:t3-local',async e=>{authorized(e);throw new Error('Connect a T3 environment using its address. This edition does not install or replace a system T3 service.');});
  ipcMain.handle('orbit:t3-options',async(e,value)=>{authorized(e);t3Scope(value);const [projects,capabilities]=await Promise.all([t3Connection.call('t3_project_list',{limit:100}),t3Connection.call('orchestrator_capabilities',{})]);return{projects:projects.projects,providers:capabilities.providers};});
  ipcMain.handle('orbit:t3-threads',async(e,value)=>{authorized(e);t3Scope(value);if(typeof value.projectId!=='string')throw new Error('Choose a project.');const result=await t3Connection.call('t3_thread_list',{projectId:value.projectId,includeSubagents:false,limit:100});return result.threads.map(({threadId,title,status})=>({threadId,title,status}));});
  ipcMain.handle('orbit:t3-project',async(e,value)=>{authorized(e);t3Scope(value);if(!t3Connection.data.local)throw new Error('Add remote folders in T3, then refresh projects.');const picked=await dialog.showOpenDialog(window,{title:'Choose a project folder for T3',properties:['openDirectory']});if(picked.canceled)return null;const folder=await fs.realpath(picked.filePaths[0]);let result=await t3Connection.call('t3_project_list',{limit:100});let project=result.projects.find(p=>p.workspaceRoot===folder);if(!project){await t3Host.registerProject(t3Connection.data.local,folder);result=await t3Connection.call('t3_project_list',{limit:100});project=result.projects.find(p=>p.workspaceRoot===folder);}if(!project)throw new Error('T3 registered the folder, but it is not visible yet. Refresh projects.');return project;});
  ipcMain.handle('orbit:t3-bind',async(e,value)=>{authorized(e);const c=t3Scope(value);if(!value.projectId){delete t3Connection.data.bindings?.[c.botId];await t3Connection.save();return null;}const project=await t3Connection.call('t3_project_read',{projectId:value.projectId});if(value.threadId){const thread=await t3Connection.call('t3_thread_read',{threadId:value.threadId,limit:1});if(thread.thread.projectId!==project.id)throw new Error('Choose a thread from this project.');}const binding={projectId:project.id,...(value.threadId?{threadId:value.threadId}:{}),...(value.modelSelection?{modelSelection:value.modelSelection}:{})};(t3Connection.data.bindings??={})[c.botId]=binding;await t3Connection.save();return binding;});
  ipcMain.handle('orbit:t3-open',async(e,value)=>{authorized(e);const c=t3Scope(value),job=t3Tasks.get(value.id,c.id);if(job.endpoint===t3Connection.data.endpoint&&t3Connection.data.local){await shell.openExternal(await t3Host.browserLink(t3Connection.data.local,job.threadId));return true;}const url=new URL(job.link);if(url.protocol!=='https:')throw new Error('The T3 thread link is not secure.');await shell.openExternal(url.href);return true;});
  ipcMain.handle('orbit:t3-submit',async(e,value)=>{authorized(e);const c=t3Scope(value),binding=t3Connection.data.bindings?.[c.botId];if(!binding)throw new Error('Choose a T3 project first.');return t3Tasks.submit({...binding,conversationId:c.id,botId:c.botId,title:value.title,prompt:value.prompt});});
  for(const [name,operation]of Object.entries({refresh:v=>t3Tasks.refresh(v),retry:v=>t3Tasks.retry(v),stop:v=>t3Tasks.cancel(v),send:v=>t3Tasks.followup(v)}))ipcMain.handle('orbit:t3-'+name,async(e,value)=>{authorized(e);t3Scope(value);return operation(value);});
  ipcMain.handle('orbit:cloud-health', async e => {authorized(e);return cloud.health();});
  ipcMain.handle('orbit:computer-frame', async (e,{conversationId}) => {authorized(e);return cloud.frames.get(conversationId)||null;});
  ipcMain.handle('orbit:computer-state', (e,{conversationId}) => {authorized(e);service._threadOpen(service._conversation(conversationId));return computerSnapshot(conversationId);});
  ipcMain.handle('orbit:computer-start', async(e,{conversationId,restart=false})=>{authorized(e);const c=service._conversation(conversationId);service._threadOpen(c);const bot=service._bot(c.botId);if(bot.capabilities?.computer===false)throw new Error('Enable Computer in this bot’s settings first.');if(restart&&service.tasks.has(c.id))throw new Error('Stop the bot before restarting its computer.');await cloud.start({botId:bot.id,conversationId:c.id,restart});if(cloud.serverOwners.get(c.id))setHumanControl(c.id,true);return computerSnapshot(c.id);});
  ipcMain.handle('orbit:computer-action', async (e,{conversationId,name,args}) => {authorized(e);const conversation=service._conversation(conversationId);service._threadOpen(conversation);if(service.tasks.has(conversationId)&&!humanComputers.has(conversationId))throw new Error('Use Take control to pause the bot before using its computer.');const revision=computerControlRevisions.get(conversationId);const live=humanComputers.has(conversationId)?cloud.manualInput({conversationId,name,args,canUse:()=>humanComputers.has(conversationId)&&computerControlRevisions.get(conversationId)===revision}):null;if(live){const result=await live;if(result.clipboardText!==undefined){clipboard.writeText(result.clipboardText);return{live:true};}return result;}if(['pointer_event','wheel_input','copy_selection'].includes(name))throw new Error('Live controls are reconnecting. Wait a moment and try again.');if(name==='move_pointer')return {live:false};return cloud.execute({botId:conversation.botId,conversationId,name,args,humanControl:true});});
  ipcMain.handle('orbit:computer-watch',(e,{conversationId,visible})=>{authorized(e);const c=service._conversation(conversationId);if(visible)service._threadOpen(c);cloud.watch(c.botId,conversationId,!!visible);return true;});
  ipcMain.handle('orbit:computer-control', async(e,{conversationId,human})=>{
    authorized(e);service._threadOpen(service._conversation(conversationId));if(typeof human!=='boolean')throw new Error('Choose who controls the computer.');
    const epoch=(computerControlEpochs.get(conversationId)||0)+1;computerControlEpochs.set(conversationId,epoch);
    if(human){setHumanControl(conversationId,true);const pausing=service.pauseForComputer({conversationId});try{await cloud.control(service._conversation(conversationId).botId,conversationId,true);await pausing;}catch(error){await pausing;setHumanControl(conversationId,false);throw error;}}
    else{
      await cloud.whenIdle(conversationId);
      const c=service._conversation(conversationId);let current=computerSnapshot(conversationId).frame;
      if(c.computerPause){try{const observed=await cloud.execute({botId:c.botId,conversationId,name:'inspect_page',args:{mode:'both',limit:60},humanControl:true});current=observed.observation||current;}catch(error){throw new Error('Could not inspect your current page. You still have control. Try Give control back again. '+error.message);}}
      if(computerControlEpochs.get(conversationId)!==epoch)return computerSnapshot(conversationId);
      await cloud.control(c.botId,conversationId,false);if(computerControlEpochs.get(conversationId)!==epoch)return computerSnapshot(conversationId);
      setHumanControl(conversationId,false);
      await service.resumeAfterComputer({conversationId,computerState:current?{...current,dataUrl:undefined}:undefined});
    }
    const snapshot=computerSnapshot(conversationId);window.webContents.send('orbit:computer-state',snapshot.state);return snapshot;
  });
  ipcMain.handle('orbit:computer-stop', async (e,{conversationId}) => {authorized(e);const c=service._conversation(conversationId);await service.stop({conversationId});await cloud.dispose(c.botId,conversationId);setHumanControl(conversationId,false);return true;});
  ipcMain.handle('orbit:files', async(e,{botId})=>{authorized(e);service._bot(botId);return files.list(botId);});
  ipcMain.handle('orbit:attach-files', async(e,{conversationId})=>{authorized(e);const c=service._conversation(conversationId);const result=await dialog.showOpenDialog(window,{properties:['openFile','multiSelections'],title:'Attach files to this bot'});if(result.canceled)return service.snapshot();const added=await files.import(c.botId,result.filePaths);c.draftAttachments=[...(c.draftAttachments||[]),...added].slice(0,10);return service._changed();});
  ipcMain.handle('orbit:remove-attachment', async(e,{conversationId,path:attachment})=>{authorized(e);const c=service._conversation(conversationId);c.draftAttachments=(c.draftAttachments||[]).filter(f=>f.path!==attachment);return service._changed();});
  ipcMain.handle('orbit:export-file', async(e,{botId,path:relative})=>{authorized(e);service._bot(botId);const source=await files.target(botId,relative);const result=await dialog.showSaveDialog(window,{defaultPath:path.basename(source)});if(!result.canceled&&result.filePath)await fs.copyFile(source,result.filePath);});
  ipcMain.handle('orbit:codex-status', async e=>{authorized(e);return (await import('./codex-client.mjs')).getCodexStatus();});
  ipcMain.handle('orbit:codex-models', async e=>{authorized(e);return (await import('./codex-client.mjs')).getCodexModels();});
  ipcMain.handle('orbit:claude-status', async e => { authorized(e); const { getClaudeStatus } = await import('./claude-backend.mjs'); return getClaudeStatus(); });
  ipcMain.handle('orbit:microphone-permission', async e => {
    authorized(e);
    return process.platform !== 'darwin' || systemPreferences.getMediaAccessStatus('microphone') === 'granted' || await systemPreferences.askForMediaAccess('microphone');
  });
  ipcMain.handle('orbit:transcribe-audio', async (e, value) => {
    authorized(e);
    if (!value || !/^[a-f0-9-]{36}$/i.test(value.requestId || '')) throw new Error('Invalid recording request.');
    if (voiceTask) throw new Error('Finish or cancel the current transcription first.');
    const { transcribeAudio } = await import('./voice.mjs');
    const job = { id: value.requestId, controller: new AbortController(), promise: null };
    voiceTask = job;
    job.promise = transcribeAudio(value, { dataDir, settings: service.snapshot().settings, signal: job.controller.signal, onProgress: message => {
      if (window && !window.isDestroyed()) window.webContents.send('orbit:voice-progress', { requestId: job.id, message });
    } });
    try { return await job.promise; } finally { if (voiceTask === job) voiceTask = null; }
  });
  ipcMain.handle('orbit:cancel-transcription', e => { authorized(e); voiceTask?.controller.abort(new DOMException('Cancelled', 'AbortError')); });
  ipcMain.handle('orbit:ready-to-close', e => { authorized(e); finishDraftFlush?.(); });
  for (const action of actions) ipcMain.handle('orbit:' + action, async (e, value) => {
    authorized(e);const before=['deleteBot','deleteThread'].includes(action)?service.snapshot().conversations:[];const result=await service[action](value);
    const retained=new Set(result.conversations.map(c=>c.id)),removed=before.filter(c=>!retained.has(c.id));
    if(removed.length)void Promise.allSettled(removed.map(c=>{setHumanControl(c.id,false);computerControlRevisions.delete(c.id);return cloud.dispose(c.botId,c.id);}));
    if(['createBot','duplicateBot'].includes(action)&&connections.status().cloud){const bot=result.bots.find(b=>b.id===result.activeBotId);if(bot?.capabilities?.computer!==false)void cloud.start({botId:bot.id,conversationId:result.activeConversationId}).catch(()=>{});}
    return result;
  });
  ipcMain.handle('orbit:pick-image', async (e, options) => {
    authorized(e);
    const result = await dialog.showOpenDialog(window, { title: options?.kind === 'profile' ? 'Choose a profile photo' : 'Choose a bot avatar',
      properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    const filename = result.filePaths[0];
    const handle = await fs.open(filename, 'r');
    try {
      if ((await handle.stat()).size > 26214400) throw new Error('Choose an image smaller than 25 MB.');
      const bytes = await handle.readFile();
      if (bytes.length > 26214400) throw new Error('Choose an image smaller than 25 MB.');
      const ext = path.extname(filename).toLowerCase().slice(1);
      const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp' }[ext];
      if (!mime) throw new Error('Choose a PNG, JPEG, WebP, GIF, or BMP image.');
      return { dataUrl: `data:${mime};base64,${bytes.toString('base64')}`, fileName: path.basename(filename) };
    } finally { await handle.close(); }
  });
  ipcMain.handle('orbit:export-image', async (e, dataUrl) => {
    authorized(e);
    if (typeof dataUrl !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(dataUrl) || dataUrl.length > 2097152)
      throw new Error('Invalid PNG');
    const result = await dialog.showSaveDialog(window, { title: 'Export avatar', defaultPath: 'bot-avatar.png',
      filters: [{ name: 'PNG image', extensions: ['png'] }] });
    if (result.canceled || !result.filePath) return false;
    await fs.writeFile(result.filePath, Buffer.from(dataUrl.split(',')[1], 'base64'));
    return true;
  });
  ipcMain.handle('orbit:export-data', async (e, kind) => {
    authorized(e);
    if (!['conversation','workspace'].includes(kind)) throw new Error('Unknown export type');
    const snapshot = service.snapshot();
    const conversation = snapshot.conversations.find(c => c.id === snapshot.activeConversationId);
    const json = kind === 'workspace';
    const result = await dialog.showSaveDialog(window,{title:json?'Export local workspace':'Export conversation',defaultPath:json?'gratis-workspace.json':'conversation.txt',filters:[{name:json?'JSON':'Text',extensions:[json?'json':'txt']}]});
    if(result.canceled || !result.filePath) return false;
    const content = json ? JSON.stringify(snapshot,null,2) : conversation.messages.map(m => `${m.role.toUpperCase()}\n${m.content}`).join('\n\n');
    await fs.writeFile(result.filePath,content,'utf8'); return true;
  });
  nativeTheme.on('updated', () => { if (!window.isDestroyed()) window.webContents.send('orbit:theme', nativeTheme.shouldUseDarkColors); });
  ipcMain.handle('orbit:theme', e => { authorized(e); return nativeTheme.shouldUseDarkColors; });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: edition.name, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] }
  ]));
  await window.loadURL(pageURL);
  window.webContents.setZoomFactor(1.2);
  if (process.env.GRATIS_TEST_HIDDEN !== '1') window.show();
}).catch(async error => {
  console.error(error);
  dialog.showErrorBox('Gratis could not start', error.message);
  app.exit(1);
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', e => {
  if (closing || !service) return;
  e.preventDefault(); void shutdown();
});
