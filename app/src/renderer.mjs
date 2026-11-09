import {setupMentions} from './mentions-ui.mjs';
import {sidebarItems} from './sidebar-items.mjs';
import {setupThreads} from './threads-ui.mjs';
import {setupComposerMenu} from './composer-menu.mjs';
import {setupWorkspace} from './workspace-ui.mjs';
import {renderMarkdown} from './markdown.mjs';
import { initialCrop, cropRect, normalizeCrop, panCrop, resizeDimensions, OUTPUT_SIZE, MAX_IMAGE_BYTES } from './crop.mjs';
import {renderIcon} from './assets/icons.mjs';
import { avatarAppearance } from './avatar.mjs';
import { animatedAvatar } from './avatar-motion.mjs';
import { createBotTile } from './bot-tile.mjs';
import { setupVoiceInput } from './voice-ui.mjs';
import { setupCreateBot } from './create-bot-ui.mjs';
import { setupSelects } from './select-ui.mjs';
const $ = id => document.getElementById(id);
const api = window.orbit;
const selects = setupSelects();

document.querySelector('#attach-menu [data-icon]').dataset.icon='plus-filled';
document.querySelectorAll('[data-icon]').forEach(node => { renderIcon(node,node.dataset.icon); });
let voiceInput, workspaceUI,threadUI;
let state, editingBot = null, draftTimer, dirtyDraft = null, previousConversation = null;
let homeVisible = true;
const messageViews=new Map();
let claudeConnection = null, codexConnection=null, codexModels=[],codexLoading=null;
let pendingProfileAvatar = null, profilePhotoSequence = 0, avatarTarget = null;
let avatarSource = null, avatarImage = null, avatarCrop = null, imageSequence = 0, pointer = null;
const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
function notice(error) { $('notice').textContent = error?.message || String(error); $('notice').hidden = false; }
async function run(fn) { try { const result = await fn(); if (result?.bots) render(result); return result; } catch (error) { notice(error); return null; } }
const currentConversation = () => state?.conversations.find(c => c.id === state.activeConversationId);
const currentBot = () => state?.bots.find(b => b.id === state.activeBotId);
function makeAvatar(bot,user=false,location='sidebar') {
 const a=el('span','avatar');
 if(user){a.textContent='Y';return a;}
 const appearance=avatarAppearance(bot,bot?.id===state?.bots[0]?.id,document.documentElement.dataset.theme||'dark');
 const busy=state?.conversations.some(c=>c.messages.some(m=>m.status==='streaming'&&(m.botId||c.botId)===bot.id));
 a.append(animatedAvatar(`${location}-${bot.id}`,{...appearance,follow:'global',mode:busy?'streaming':'idle'}));
 if(!bot.avatarDataUrl)a.classList.add('generated-avatar');return a;
}
function isStreaming() { return currentConversation()?.messages.some(m => m.status === 'streaming'); }
function renderBotTile(b,surface='tile') {
  const messages=state.conversations.filter(c=>c.botId===b.id).flatMap(c=>c.messages),busy=messages.some(m=>m.status==='streaming');
  const isClaude=state.settings.provider==='claude',isCodex=state.settings.provider==='codex';
  const unconfigured=(state.settings.provider==='local'&&!state.settings.model)||(isClaude&&!claudeConnection?.signedIn)||(isCodex&&!codexConnection?.signedIn);
  const status=busy?'busy':unconfigured?'unconfigured':'ready';
  const statusLabel=busy?'Responding':isClaude?(claudeConnection?.signedIn?'Claude ready':'Check Claude sign-in in Settings'):isCodex?(codexConnection?.signedIn?'Codex ready':'Check Codex sign-in in Settings'):unconfigured?'Choose a local model in Settings':state.settings.provider==='demo'?'Local demo ready':'Local AI configured';
  return createBotTile(b,{primary:b.id===state.bots[0].id,status,statusLabel,surface,onSelect:selected=>navigate(()=>api.selectBot({id:selected.id})),onContextMenu:selected=>openBotMenu(selected.id)});
}
function refreshComposer() {
  const root=currentConversation(),waiting=!!root&&(root.pendingComputerHelp||root.computerPause||state.conversations.some(c=>c.parentThreadId===root.id&&(c.pendingComputerHelp||c.computerPause)));
  const busy = threadUI?.composing?false:isStreaming()||waiting, hasText = !!$('prompt').value.trim();
  $('send').hidden = !hasText; $('send').setAttribute('aria-label',busy?'Queue message':'Send message'); $('stop').hidden = !busy; $('voice-call').hidden = !!busy || hasText;
  $('send').disabled = !hasText;
  $('chat-model').disabled = !!busy;
  selects.sync();
  $('microphone').disabled = !!busy;
  $('prompt').style.height = 'auto'; $('prompt').style.height = Math.max(28,Math.min(164, $('prompt').scrollHeight)) + 'px';
  voiceInput?.sync();
}
function render(next) {
  state = next; setProfileImage($('profile-avatar'),state.settings.profileAvatarDataUrl); $('profile-name-label').textContent = state.settings.displayName || 'Local workspace'; $('workspace-profile').setAttribute('aria-label', state.settings.displayName ? `Profile and settings for ${state.settings.displayName}` : 'Profile and settings'); const bot = currentBot(), conversation = currentConversation();
  const query = $('bot-filter').value.trim().toLowerCase();
  const filteredBots = state.bots.filter(b => (b.name+' '+state.conversations.filter(c=>c.botId===b.id).map(c=>c.messages.map(m=>m.content).join(' ')).join(' ')).toLowerCase().includes(query)).sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned));
  const sidebar=sidebarItems(state,query);
  const focusedSidebar=document.activeElement?.closest('#bots button'),focusedKey=focusedSidebar?.dataset.conversationId||focusedSidebar?.dataset.botId;
  const pinned=sidebar.filter(item=>item.kind==='bot'&&item.pinned),pinnedGrid=el('div','pinned-bots');pinnedGrid.id='pinned-bots';pinnedGrid.setAttribute('aria-label','Pinned bots');
  for(const item of pinned){const tile=renderBotTile(item.bot,'pinned');tile.classList.add('pinned-bot');tile.setAttribute('aria-pressed',String(item.bot.id===bot?.id&&conversation?.kind!=='group'));pinnedGrid.append(tile);}
  $('bots').replaceChildren(...(pinned.length?[pinnedGrid]:[]),...sidebar.filter(item=>item.kind!=='bot'||!item.pinned).map(item=>{
    if(item.kind==='group')return threadUI.sidebarRow(item.conversation);
    const b=item.bot,button=el('button','bot-item'+(b.id===bot?.id&&conversation?.kind!=='group'?' active':''));button.type='button';
    button.dataset.botId=b.id;button.setAttribute('aria-pressed',String(b.id===bot?.id&&conversation?.kind!=='group'));
    const meta=el('span');meta.append(el('strong',null,(b.pinned?'⌁ ':'')+b.name),el('small',null,item.preview));button.append(makeAvatar(b),meta);
    button.onclick=()=>navigate(()=>api.selectBot({id:b.id}));button.oncontextmenu=event=>{event.preventDefault();void openBotMenu(b.id);};return button;
  }));
  if(focusedKey)[...$('bots').querySelectorAll('button')].find(row=>(row.dataset.conversationId||row.dataset.botId)===focusedKey)?.focus({preventScroll:true});
  $('sidebar-empty').hidden=sidebar.length>0;$('sidebar-empty').textContent=query?'No chats match your search.':'No bots or chats yet.';
  $('home-bots').replaceChildren(...filteredBots.map(b=>renderBotTile(b)));
  $('no-bots').hidden = filteredBots.length !== 0;
  $('no-bots').textContent = state.bots.length ? 'No bots match your search.' : 'No bots yet. Create one to start a conversation.';
  $('create-first-bot').hidden = state.bots.length !== 0;
  if (!bot || !conversation) {
    homeVisible = true; previousConversation = null;
    $('messages').replaceChildren(); $('conversations').replaceChildren(); $('prompt').value = '';
    $('bot-name').textContent = ''; $('bot-instructions').textContent = '';
    updateView(); return;
  }
  $('bot-name').textContent = conversation.kind==='group'?conversation.title:bot.name;document.querySelector('main').classList.toggle('team-chat',conversation.kind==='group');$('edit-bot').title=conversation.kind==='group'?'Chat details':'Bot settings and conversations'; $('bot-instructions').textContent = bot.instructions || 'Your personal bot';
  const head=conversation.kind==='group'?el('span','thread-avatar-stack thread-header-stack'):makeAvatar(bot,false,'header');if(conversation.kind==='group')for(const id of conversation.participantIds.slice(0,3)){const peer=state.bots.find(b=>b.id===id);if(peer)head.append(makeAvatar(peer,false,'header-team'));}head.id = 'header-avatar'; $('header-avatar').replaceWith(head);
  $('conversations').replaceChildren(...state.conversations.filter(c => c.botId === bot.id&&!c.parentThreadId&&c.kind!=='group').sort((a,b) => b.createdAt-a.createdAt).map(c => {
    const option = el('option', null, c.title); option.value = c.id; option.selected = c.id === conversation.id; return option;
  }));
  const local = state.settings.provider === 'local', claude = state.settings.provider === 'claude',codex=state.settings.provider==='codex';
  $('backend-label').textContent = claude ? `Claude · ${state.settings.model}` : codex?`Codex · ${state.settings.model}`:local ? `Local AI server · ${state.settings.model}` : 'Local demo · scripted responses, no AI model';
  $('footer-note').textContent = claude ? 'Claude uses your signed-in plan limits. Check important information.' : codex?'Codex uses your ChatGPT plan limits. Check important information.':local ? 'Responses come from your local AI server. Check important information.' : 'Demo mode illustrates the chat workflow. It does not use Grok or generate AI answers.';
  $('settings-button').title = `Settings · ${claude ? 'Claude' : codex?'Codex':local ? 'local AI server' : 'local demo'}`;
  $('chat-model').hidden = !claude&&!codex;
  syncChatModels(bot);
  selects.sync();
  if(!threadUI?.composing){
  if (previousConversation !== conversation.id) {
    $('prompt').value = dirtyDraft?.conversationId === conversation.id ? dirtyDraft.text : conversation.draft;
    previousConversation = conversation.id; $('notice').hidden = true;
  } else if (!dirtyDraft && document.activeElement !== $('prompt')) $('prompt').value = conversation.draft;
  }
  $('message-queue').hidden=!(conversation.queue||[]).length;
  $('message-queue').replaceChildren();
  if(conversation.queue?.length){
    const header=el('div','queue-header'),label=el('span',null,`${conversation.queue.length} queued ${conversation.queue.length===1?'message':'messages'}${conversation.queuePaused?' · Paused':''}`),toggle=el('button',null,conversation.queuePaused?'Resume':'Pause');
    toggle.onclick=()=>run(()=>api.updateQueue({conversationId:conversation.id,action:conversation.queuePaused?'resume':'pause'}));header.append(label,toggle);$('message-queue').append(header);
    for(const queued of conversation.queue){const row=el('div','queue-row'),text=el('span',null,queued.text),remove=el('button',null,'×');remove.setAttribute('aria-label','Remove queued message');remove.onclick=()=>run(()=>api.updateQueue({conversationId:conversation.id,id:queued.id,action:'remove'}));row.append(text,remove);$('message-queue').append(row);}
  }
  $('attachment-chips').replaceChildren(...(conversation.draftAttachments||[]).map(file=>{const chip=el('span','attachment-chip',file.name),remove=el('button',null,'×');remove.type='button';remove.setAttribute('aria-label',`Remove ${file.name}`);remove.onclick=()=>run(()=>api.removeAttachment({conversationId:conversation.id,path:file.path}));chip.append(remove);return chip;}));
  $('attachment-chips').hidden=!(conversation.draftAttachments||[]).length;
  renderAttention(conversation);
  renderMessages(bot, conversation); refreshComposer(); workspaceUI?.sync();threadUI?.sync();
  updateView();
}
function updateView() {
  const composing=!!threadUI?.composing;document.querySelector('main').classList.toggle('new-thread-composing',composing);document.querySelector('.topbar').hidden=composing;
  document.querySelector('.header-actions').hidden = homeVisible;
  $('bot-picker').hidden = !homeVisible;
  $('home-title').hidden = !homeVisible;
  $('edit-bot').hidden = homeVisible;
  $('share-conversation').hidden = homeVisible;
  $('messages').hidden = homeVisible||composing;
  document.querySelector('.composer-area').hidden = homeVisible;
  document.querySelector('main').classList.toggle('showing-bots', homeVisible);
  $('show-bots').setAttribute('aria-pressed', String(homeVisible));
}
function renderMessages(bot, conversation) {
  const container = $('messages'), stayBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 90;
  const focused = document.activeElement?.dataset?.questionId;
  const selection = focused ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
  if (!conversation.messages.length) {
    container.replaceChildren(); return;
  }
  const expanded=new Set([...container.querySelectorAll('details[open][data-activity-id]')].map(node=>node.dataset.activityId));
  const nodes = conversation.messages.map((m, index) => {
    const signature=JSON.stringify(m)+(m.question?JSON.stringify([isStreaming(),dirtyDraft?.text,conversation.draft,conversation.messages.length]):'');
    const cached=messageViews.get(m.id);if(cached?.signature===signature)return cached.node;
    const item = el('article', `message ${m.role}`); item.dataset.messageId = m.id; item.dataset.status = m.status; item.dataset.kind = m.kind || 'chat';
    const speaker=m.botId?state.bots.find(b=>b.id===m.botId)||bot:bot;const content = el('div', 'message-content'); const provider = m.provider === 'demo' ? ' · local demo' : '';
    content.append(el('div', 'byline', m.role === 'user' ? (m.sourceScheduleRunId?'Scheduled · '+(m.sourceScheduleTitle||'Task'):'You') : speaker.name + provider));
    if (m.question && Array.isArray(m.question.options)) {
      const question = el('div','question-card');
      question.append(el('h2',null,m.content));
      const options = el('div', 'question-options');
      const hasLegacyCustom = m.question.options.at(-1)?.toLowerCase() === 'something else';
      const choices = hasLegacyCustom ? m.question.options.slice(0, -1) : m.question.options;
      const answered = conversation.messages.slice(index+1).some(message=>message.role==='user');
      for (const [index, option] of choices.entries()) {
        const button = el('button','question-option');button.disabled=answered||isStreaming();
        button.append(el('span','option-key',String.fromCharCode(65+index)),el('span',null,option));
        button.onclick = () => run(() => api.send({conversationId:conversation.id,text:option}));
        options.append(button);
      }
      if (m.question.custom || hasLegacyCustom) {
        const form=el('form','question-option custom-option');
        const input=el('input');input.type='text';input.placeholder='Something else';input.setAttribute('aria-label','Other response');input.dataset.questionId=m.id;input.disabled=answered||isStreaming();
        input.value = answered ? '' : dirtyDraft?.conversationId===conversation.id ? dirtyDraft.text : conversation.draft;
        input.oninput=()=>{$('prompt').value=input.value;draftChanged();};
        form.append(el('span','option-key',String.fromCharCode(65+choices.length)),input);
        form.onsubmit=event=>{event.preventDefault();const value=input.value.trim();if(value){clearTimeout(draftTimer);dirtyDraft=null;run(()=>api.send({conversationId:conversation.id,text:value}));}};
        options.append(form);
      }
      question.append(options);
      content.append(question);
    } else {
      const text=m.content || '';
      if(text)content.append(m.role==='assistant'?renderMarkdown(text):el('div','message-body',text));
      if(m.content&&m.status!=='streaming'){
        const actions=el('div','message-actions'),copy=el('button',null,'Copy');copy.type='button';copy.setAttribute('aria-label','Copy message');
        copy.onclick=async()=>{await api.copyText(m.content);copy.textContent='Copied';};actions.append(copy);content.append(actions);
      }
    }
    if(m.attachments?.length){const attachments=el('div','attachment-chips');for(const f of m.attachments)attachments.append(el('span','attachment-chip',f.name));content.prepend(attachments);}
    if(m.activities?.some(a=>a.status==='approval'||a.status==='error')){const list=el('div','activity-list');for(const activity of m.activities.filter(a=>a.status==='approval'||a.status==='error')){const row=el('details','tool-activity');row.dataset.status=activity.status;row.dataset.activityId=activity.id;if(expanded.has(activity.id))row.open=true;const label=(activity.name||'Tool').replace(/^mcp__(?:gratis|composio)__/, '').replaceAll('_',' ');row.append(el('summary',null,`${label} · ${activity.status==='approval'?'Needs your approval':activity.status}`));if(activity.input)row.append(el('pre',null,JSON.stringify(activity.input,null,2)));if(activity.detail)row.append(el('p',null,activity.detail));if(activity.status==='approval'){row.open=true;const actions=el('div','approval-actions');for(const [text,allow] of [['Allow',true],['Deny',false]]){const button=el('button',allow?'primary':'quiet-button',text);button.onclick=()=>run(()=>api.respondApproval({id:activity.id,allow}));actions.append(button);}row.append(actions);}list.append(row);}content.append(list);}
    if (m.role === 'assistant' && m.status === 'complete' && ['claude','codex'].includes(m.provider) && m.usage) content.append(el('div', 'message-usage', `${m.provider==='codex'?'Codex':'Claude'} · ${m.usage.model} · ${m.usage.outputTokens.toLocaleString()} output tokens`));
    if(m.status==='streaming'){const working=el('div','bot-working');working.setAttribute('role','status');working.setAttribute('aria-label',`${speaker.name} is working`);working.append(makeAvatar(speaker,false,`working-${m.id}`));const label=el('span','sr-only',m.phase==='setup'?'Creating your bot instructions':'Working');working.append(label);content.append(working);}
    if (m.status !== 'complete'&&m.status!=='streaming') {
      const status = el('div', 'message-state' + (m.status === 'error' ? ' error' : ''), m.status === 'streaming' ? (m.phase==='setup'?'Creating system prompt from your first message…':'Responding…') : m.error || 'Stopped');
      content.append(status);
      const retrySeat=m.sourceConversationId&&state.conversations.find(c=>c.id===m.sourceConversationId),canRetry=conversation.kind!=='group'||(m.kind==='team-reply'?retrySeat&&!retrySeat.inactiveTeamMember:!m.botId||m.botId===conversation.botId);
      if (canRetry&&m.pauseReason!=='computer'&&['error','cancelled'].includes(m.status) && (index === conversation.messages.length - 1||conversation.kind==='group')&&index>conversation.messages.findLastIndex(m=>m.role==='user')) { const retry = el('button', 'retry', 'Retry response'); retry.onclick = () => run(() => api.retry({ conversationId: conversation.id,messageId:m.id })); content.append(retry); }
    }
    item.append(content);messageViews.set(m.id,{signature,node:item});return item;
  });
  const activeIds=new Set(conversation.messages.map(m=>m.id));for(const id of messageViews.keys())if(!activeIds.has(id))messageViews.delete(id);
  const date = new Date(conversation.messages[0].createdAt);
  const dateLabel = date.toDateString() === new Date().toDateString() ? 'Today' : date.toLocaleDateString(undefined,{month:'short',day:'numeric'});
  container.replaceChildren(el('div','date-separator',`${dateLabel} ${date.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}`),...nodes);
  if (focused) {const input=[...container.querySelectorAll('[data-question-id]')].find(input=>input.dataset.questionId===focused);if(input&&!input.disabled){input.focus({preventScroll:true});input.setSelectionRange(...selection);}}
  if (stayBottom || previousConversation !== conversation.id) container.scrollTop = container.scrollHeight;
}
function renderAttention(root){
  const banner=$('chat-attention'),chats=state.conversations.filter(c=>c.id===root.id||c.parentThreadId===root.id);
  const help=chats.find(c=>c.pendingComputerHelp||c.computerPause),approval=chats.find(c=>c.messages.some(m=>m.activities?.some(a=>a.status==='approval')));
  banner.replaceChildren();banner.hidden=!help&&!approval;if(banner.hidden)return;
  const bot=state.bots.find(b=>b.id===(help||approval).botId),label=el('span'),button=el('button','quiet-button');button.type='button';
  label.textContent=help?(help.computerPause?`${bot.name} is paused while you have control.`:`${bot.name} needs you: ${help.pendingComputerHelp.reason}`):`${bot.name} needs your approval.`;
  button.textContent=help?(help.computerPause?'Open computer':'Take control'):'Review';
  button.onclick=()=>{if(help)void workspaceUI.openComputerFor(help.id,{takeControl:!help.computerPause});else workspaceUI.openXray({reset:true});};banner.append(label,button);
}
function draftChanged() {
  if(threadUI?.composing){refreshComposer();return;}
  if (!state.activeConversationId) return;
  dirtyDraft = { conversationId: state.activeConversationId, text: $('prompt').value };
  clearTimeout(draftTimer); draftTimer = setTimeout(flushDraft, 300); refreshComposer();
}
async function flushDraft() {
  clearTimeout(draftTimer); const pending = dirtyDraft; if (!pending) return;
  dirtyDraft = null; await run(() => api.setDraft(pending));
}
async function navigate(fn) { if(workspaceUI&&await workspaceUI.beforeNavigate()===false)return;threadUI?.cancel();voiceInput?.cancel(); selects.close(); await flushDraft(); const result = await run(fn); if (!result) return; homeVisible = false; updateView(); $('messages').scrollTop = $('messages').scrollHeight; $('prompt').focus(); }
$('prompt').addEventListener('input', draftChanged);
$('prompt').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('composer').requestSubmit(); } });
$('composer').onsubmit = async e => {
  e.preventDefault(); const input = $('prompt').value.trim(); if (!input || voiceInput?.active) return;
  let conversationId=state.activeConversationId;if(threadUI?.composing){try{conversationId=await threadUI.commit();}catch(error){notice(error);return;}} clearTimeout(draftTimer); dirtyDraft = null;
  $('notice').hidden = true;
  const result = await run(() => api.send({ conversationId, text: input }));
  if (result) { $('prompt').value = ''; refreshComposer(); $('messages').scrollTop = $('messages').scrollHeight; }
};
$('stop').onclick = () => run(() => api.stop({ conversationId: state.activeConversationId }));
$('conversations').onchange = e => navigate(() => api.selectConversation({ id: e.target.value }));
$('new-chat').onclick = async () => { await navigate(() => api.newConversation({ botId: state.activeBotId })); $('bot-dialog').close(); };
$('show-bots').onclick = async () => {threadUI?.cancel(); await flushDraft(); voiceInput?.cancel(); selects.close(); homeVisible = true; updateView(); };
$('search-bots').onclick = () => { $('bot-filter').hidden = !$('bot-filter').hidden; if (!$('bot-filter').hidden) $('bot-filter').focus(); };
$('bot-filter').oninput = () => render(state);
$('workspace-profile').onclick = () => openSettings();
$('export-workspace').onclick = () => run(() => api.exportData('workspace'));
$('share-conversation').onclick = () => run(() => api.exportData('conversation'));
$('attach-menu').onclick = () => run(()=>api.attachFiles({conversationId:state.activeConversationId}));
$('chat-model').onchange = async () => {
  const previous = state.settings.model;
  const result = await run(() => api.updateBot({id:state.activeBotId,[state.settings.provider==='codex'?'codexModel':'model']:$('chat-model').value}));
  if (!result) $('chat-model').value = previous;
};
let sidebarDrag = null;
$('sidebar-resize').onpointerdown = e => { sidebarDrag = e.clientX; e.currentTarget.setPointerCapture(e.pointerId); };
$('sidebar-resize').onpointermove = e => { if(sidebarDrag !== null) document.documentElement.style.setProperty('--sidebar-width',`${Math.max(240,Math.min(400,e.clientX))}px`); };
$('sidebar-resize').onpointerup = () => { sidebarDrag=null; };
$('sidebar-resize').onpointercancel = () => { sidebarDrag=null; };
function openBotDialog(edit = true) {
  voiceInput?.cancel(); selects.close();
  editingBot = edit ? currentBot().id : null; const bot = edit ? currentBot() : null;
  $('bot-dialog-title').textContent = edit ? 'Edit bot' : 'Create a bot'; $('save-bot').textContent = edit ? 'Save bot' : 'Create bot';
  $('bot-title').value = bot?.name || ''; $('bot-system').value = bot?.instructions || '';
  $('bot-user-template').value = bot?.userPromptTemplate || '{{message}}'; $('bot-user-template').setCustomValidity('');
  fillModels($('bot-model'),modelsForProvider(),state.settings.provider==='codex'?bot?.codexModel||'':bot?.model||'',true); $('bot-memory').value=bot?.memory||''; for(const key of ['web','files','computer','connections'])$('bot-'+key).checked=bot?.capabilities?.[key]!==false;
  $('avatar-controls').hidden = !edit; $('bot-dialog').showModal(); selects.sync(); $('bot-title').focus();
}
const createBot = setupCreateBot({api,onCreated:next=>{homeVisible=false;render(next);workspaceUI?.openComputer();$('messages').scrollTop=$('messages').scrollHeight;$('prompt').focus();}});
$('new-bot').onclick = async () => {await flushDraft();voiceInput?.cancel();selects.close();createBot.open();}; $('edit-bot').onclick = () => {if(!threadUI?.showDetails())openBotDialog(true);};
$('bot-form').onsubmit = async e => { e.preventDefault(); const value = { name: $('bot-title').value.trim(), instructions: $('bot-system').value, userPromptTemplate: $('bot-user-template').value, [state.settings.provider==='codex'?'codexModel':'model']:$('bot-model').value, memory:$('bot-memory').value, capabilities:Object.fromEntries(['web','files','computer','connections'].map(key=>[key,$('bot-'+key).checked])) };
  if (value.userPromptTemplate.trim() && !value.userPromptTemplate.includes('{{message}}')) { $('bot-user-template').setCustomValidity('Include {{message}} where your message should go.'); $('bot-user-template').reportValidity(); return; }
  if (editingBot) value.id = editingBot;
  await flushDraft(); const result = await run(() => editingBot ? api.updateBot(value) : api.createBot(value));
  if (result) { $('bot-dialog').close(); homeVisible = false; updateView(); $('prompt').focus(); }
};
$('create-first-bot').onclick = () => $('new-bot').click();
let deletingBotId = null, deletionPending = false;
function confirmDeleteBot(botId) {
  const bot = state.bots.find(b => b.id === botId); if (!bot) return;
  voiceInput?.cancel(); selects.close(); deletingBotId = botId;
  $('delete-bot-title').textContent = `Delete ${bot.name}?`;
  const count = state.conversations.filter(c => c.botId === botId).length;
  $('delete-bot-description').textContent = `This will permanently delete this bot and ${count === 1 ? 'its conversation' : `all ${count} of its conversations`}. This cannot be undone.`;
  $('delete-bot-error').hidden = true; $('delete-bot-dialog').showModal();
  $('cancel-delete-bot').focus();
}
async function openBotMenu(botId) {
  const action = await run(() => api.botMenu({id:botId}));
  if (action === 'delete') confirmDeleteBot(botId);
  if (action === 'duplicate') await run(()=>api.duplicateBot({id:botId}));
  if (action === 'pin') await run(()=>api.updateBot({id:botId,pinned:!state.bots.find(b=>b.id===botId)?.pinned}));
  if (action === 'edit') { await flushDraft(); const selected = await run(() => api.selectBot({id:botId})); if (selected) openBotDialog(true); }
}
$('delete-bot').onclick = () => confirmDeleteBot(editingBot);
$('delete-bot-dialog').addEventListener('cancel', event => { if (deletionPending) event.preventDefault(); });
$('delete-bot-form').onsubmit = async event => {
  event.preventDefault(); if (deletionPending || !deletingBotId) return;
  deletionPending = true;
  const dialog = $('delete-bot-dialog'); dialog.querySelectorAll('button').forEach(button => button.disabled = true);
  try {
    await flushDraft();
    const next = await api.deleteBot({id:deletingBotId});
    if (editingBot === deletingBotId) { $('bot-dialog').close(); editingBot = null; }
    deletingBotId = null; homeVisible = true; render(next); dialog.close();
  } catch (error) { $('delete-bot-error').textContent = error.message; $('delete-bot-error').hidden = false; }
  finally { deletionPending = false; dialog.querySelectorAll('button').forEach(button => button.disabled = false); }
};
$('bot-user-template').oninput = () => $('bot-user-template').setCustomValidity('');
document.querySelectorAll('.close-dialog').forEach(button => button.onclick = () => button.closest('dialog').close());
function openSettings() {
  voiceInput?.cancel(); selects.close();
  pendingProfileAvatar = state.settings.profileAvatarDataUrl || null; profilePhotoSequence++; renderProfilePhoto();
  $('profile-photo-error').hidden = true;
  $('profile-name').value = state.settings.displayName || '';
  $('provider').value = state.settings.provider; $('base-url').value = state.settings.baseUrl; $('model').value = state.settings.model;
  $('claude-model').value = state.settings.provider === 'claude' ? state.settings.model : state.settings.providerDefaults?.claude?.model||'sonnet';
  fillModels($('codex-model'),codexModels,state.settings.provider==='codex'?state.settings.model:state.settings.providerDefaults?.codex?.model);
  $('claude-effort').value = state.settings.provider==='claude'?state.settings.effort||'medium':state.settings.providerDefaults?.claude?.effort||'medium';
  syncCodexEffort(state.settings.provider==='codex'?state.settings.effort:state.settings.providerDefaults?.codex?.effort);
  $('voice-language').value = state.settings.voiceLanguage || 'en';
  $('claude-model').onchange();
  $('appearance').value = localStorage.getItem('orbit-appearance') || 'system'; $('provider').onchange(); $('settings-dialog').showModal(); selects.sync();
}
$('provider').onchange = () => { $('codex-options').hidden=$('provider').value!=='codex';if($('provider').value==='codex')void checkCodexConnection(); $('local-options').hidden = $('provider').value !== 'local'; $('claude-options').hidden = $('provider').value !== 'claude'; $('model').required = $('provider').value === 'local'; if ($('provider').value === 'claude') void checkClaudeConnection(); };
$('claude-model').onchange = () => { $('claude-effort').disabled = $('claude-model').value === 'haiku'; selects.sync(); };
async function checkClaudeConnection() {
  $('claude-status').textContent = 'Checking Claude sign-in…'; $('check-claude').disabled = true;
  try { claudeConnection = await api.claudeStatus(); $('claude-status').textContent = claudeConnection.message; if (state) render(state); }
  catch { $('claude-status').textContent = 'Could not check Claude. Try again.'; }
  finally { $('check-claude').disabled = false; }
}
$('check-claude').onclick = checkClaudeConnection;
function modelsForProvider(){return state.settings.provider==='codex'?codexModels:[{id:'haiku',name:'Haiku'},{id:'sonnet',name:'Sonnet'},{id:'opus',name:'Opus'}];}
function fillModels(select,models,selected,inherit=false){
 const choices=[...(inherit?[{id:'',name:'Use app default'}]:[]),...models];
 if(selected&&!choices.some(m=>m.id===selected))choices.push({id:selected,name:selected});
 if(!choices.length)choices.push({id:'',name:'Check connection to load models'});
 const key=JSON.stringify(choices);if(select.dataset.models!==key){select.replaceChildren(...choices.map(m=>{const option=el('option',null,m.name);option.value=m.id;return option;}));select.dataset.models=key;}
 select.value=choices.some(m=>m.id===selected)?selected:(models.find(m=>m.isDefault)?.id||choices[0].id);select.disabled=!models.length&&!inherit;
}
function syncChatModels(bot){const codex=state.settings.provider==='codex';fillModels($('chat-model'),modelsForProvider(),(codex?bot.codexModel:bot.model)||state.settings.model);$('chat-model').disabled=isStreaming()||!modelsForProvider().length;}
function syncCodexEffort(preferred){
 const model=codexModels.find(m=>m.id===$('codex-model').value),efforts=model?.efforts?.length?model.efforts:['low','medium','high'];const selected=preferred||$('codex-effort').value||model?.defaultEffort;
 fillModels($('codex-effort'),efforts.map(id=>({id,name:{xhigh:'Extra high',max:'Maximum',ultra:'Ultra'}[id]||id[0].toUpperCase()+id.slice(1)})),efforts.includes(selected)?selected:model?.defaultEffort||efforts[0]);selects.sync();
}
$('codex-model').onchange=()=>syncCodexEffort();
async function checkCodexConnection(){
 if(codexLoading)return codexLoading;
 $('codex-status').textContent='Checking ChatGPT sign-in…';$('check-codex').disabled=true;
 codexLoading=(async()=>{try{codexConnection=await api.codexStatus();$('codex-status').textContent=codexConnection.message;if(codexConnection.signedIn){codexModels=await api.codexModels();const selected=$('codex-model').value|| (state.settings.provider==='codex'?state.settings.model:state.settings.providerDefaults?.codex?.model);fillModels($('codex-model'),codexModels,selected);syncCodexEffort();}if(state)render(state);}catch(error){$('codex-status').textContent=error.message||'Could not check Codex. Try again.';}finally{$('check-codex').disabled=false;codexLoading=null;selects.sync();}})();return codexLoading;
}
$('check-codex').onclick=checkCodexConnection;
$('settings-button').onclick = openSettings; $('configure-backend').onclick = openSettings;
$('settings-form').onsubmit = async e => { e.preventDefault();
  const result = await run(() => api.updateSettings({ profileAvatarDataUrl: pendingProfileAvatar, displayName: $('profile-name').value.trim(), provider: $('provider').value, baseUrl: $('base-url').value.trim(), model: $('provider').value === 'claude' ? $('claude-model').value : $('provider').value==='codex'?$('codex-model').value:$('model').value.trim(), effort: $('provider').value==='codex'?$('codex-effort').value:$('claude-effort').value, voiceCleanup: true, voiceLanguage: $('voice-language').value }));
  if (result) { localStorage.setItem('orbit-appearance', $('appearance').value); applyTheme(await api.systemDark()); $('settings-dialog').close(); }
};
function applyTheme(systemDark) { const choice = localStorage.getItem('orbit-appearance') || 'system'; document.documentElement.dataset.theme = choice === 'system' ? (systemDark ? 'dark' : 'light') : choice; if (state) render(state); }
api.onTheme(applyTheme); applyTheme(await api.systemDark());
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === ',') { e.preventDefault(); openSettings(); }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); navigate(() => api.newConversation({botId:state.activeBotId})); }
});
window.addEventListener('blur', flushDraft);
api.onClosing(async () => { voiceInput?.cancel(); try { await flushDraft(); } finally { await api.readyToClose(); } });
voiceInput = setupVoiceInput({
  api, notice, isBusy: isStreaming, onStateChange: refreshComposer,
  getContext: () => ({ conversationId: state.activeConversationId, start: $('prompt').selectionStart, end: $('prompt').selectionEnd }),
  insertText: (text, context) => {
    if (state.activeConversationId !== context.conversationId) { notice('The conversation changed before dictation finished.'); return false; }
    const input = $('prompt'), before = input.value.slice(0, context.start), after = input.value.slice(context.end);
    const inserted = `${before && !/\s$/.test(before) ? ' ' : ''}${text}${after && !/^\s/.test(after) ? ' ' : ''}`;
    input.value = before + inserted + after; draftChanged();
    setTimeout(() => { input.focus(); input.setSelectionRange(before.length + inserted.length, before.length + inserted.length); }, 0);
    return true;
  },
});

function setProfileImage(container,url) {
  if(url){const image=el('img');image.alt='';image.src=url;container.replaceChildren(image);}
  else {const icon=el('i');icon.dataset.icon='person';renderIcon(icon,'person');container.replaceChildren(icon);}
}
function renderProfilePhoto(){setProfileImage($('profile-photo-preview'),pendingProfileAvatar);$('remove-profile-photo').hidden=!pendingProfileAvatar;}
async function chooseProfilePhoto(){
  const sequence=++profilePhotoSequence;$('profile-photo-error').hidden=true;
  try {
    const image=await api.pickImage({kind:'profile'});
    if(!image||sequence!==profilePhotoSequence||!$('settings-dialog').open)return;
    avatarTarget={kind:'profile'};resetAvatar();await chooseSource(image.dataUrl,image.fileName);
    if(sequence!==profilePhotoSequence||!$('settings-dialog').open)return;
    if(!avatarImage)throw new Error($('avatar-error').textContent||'Could not open that image.');
    $('avatar-dialog-title').textContent='Profile photo';$('apply-avatar').textContent='Use photo';$('avatar-dialog').showModal();
  }catch(error){if(sequence===profilePhotoSequence){$('profile-photo-error').textContent=error.message;$('profile-photo-error').hidden=false;}}
}
$('profile-photo').onclick=chooseProfilePhoto;$('change-profile-photo').onclick=chooseProfilePhoto;
$('remove-profile-photo').onclick=()=>{pendingProfileAvatar=null;renderProfilePhoto();};
$('settings-dialog').addEventListener('close',()=>{profilePhotoSequence++;if(avatarTarget?.kind==='profile'&&$('avatar-dialog').open)$('avatar-dialog').close();});

function resetAvatar() { avatarSource = null; avatarImage = null; avatarCrop = null; pointer = null; imageSequence++; $('drop-label').hidden = false; $('apply-avatar').disabled = true; $('avatar-error').textContent = ''; $('crop-canvas').getContext('2d').clearRect(0,0,288,288); }
$('edit-avatar').onclick = () => { avatarTarget={kind:'bot',botId:editingBot}; resetAvatar(); $('avatar-dialog-title').textContent='Bot avatar'; $('apply-avatar').textContent='Use avatar'; $('avatar-dialog').showModal(); };
$('remove-avatar').onclick = () => run(() => api.updateBot({ id: editingBot, avatarDataUrl: null }));
function loadImage(dataUrl) { return new Promise((resolve,reject) => { const image = new Image(); image.onload = () => image.naturalWidth && image.naturalHeight ? resolve(image) : reject(new Error('This image has no dimensions.')); image.onerror = () => reject(new Error('This image could not be decoded.')); image.src = dataUrl; }); }
async function chooseSource(dataUrl, fileName) {
  const seq = ++imageSequence; $('avatar-error').textContent = '';
  try {
    const source = await loadImage(dataUrl); if (seq !== imageSequence) return;
    const size = resizeDimensions(source.naturalWidth, source.naturalHeight), canvas = document.createElement('canvas'); canvas.width = size.width; canvas.height = size.height;
    const ctx = canvas.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(source,0,0,size.width,size.height);
    const image = await loadImage(canvas.toDataURL('image/png')); if (seq !== imageSequence) return;
    avatarImage = image; avatarSource = size; avatarCrop = initialCrop(size.width,size.height);
    $('image-info').textContent = `${fileName} · ${size.width} × ${size.height} working image · 256 × 256 PNG output`;
    $('drop-label').hidden = true; $('apply-avatar').disabled = false; drawAvatar();
  } catch (error) { if (seq === imageSequence) $('avatar-error').textContent = error.message; }
}
function drawAvatar() {
  if (!avatarImage) return; const ctx = $('crop-canvas').getContext('2d'), rect = cropRect(avatarSource.width,avatarSource.height,avatarCrop);
  ctx.clearRect(0,0,288,288); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(avatarImage,rect.x,rect.y,rect.width,rect.height,0,0,288,288);
  $('zoom').value = avatarCrop.zoom; $('zoom-value').value = `${Number(avatarCrop.zoom).toFixed(1)}×`;
}
function avatarPng() {
  if (!avatarImage) throw new Error('Choose an image first.'); const canvas = document.createElement('canvas'); canvas.width = canvas.height = OUTPUT_SIZE;
  const ctx = canvas.getContext('2d'), r = cropRect(avatarSource.width,avatarSource.height,avatarCrop); ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(avatarImage,r.x,r.y,r.width,r.height,0,0,OUTPUT_SIZE,OUTPUT_SIZE); return canvas.toDataURL('image/png');
}
$('choose-image').onclick = async () => { try { const image = await api.pickImage({kind:avatarTarget?.kind||'bot'}); if (image) await chooseSource(image.dataUrl,image.fileName); } catch (error) { $('avatar-error').textContent = error.message; } };
$('zoom').oninput = e => { if (!avatarSource) return; avatarCrop = normalizeCrop(avatarSource.width,avatarSource.height,{...avatarCrop,zoom:Number(e.target.value)}); drawAvatar(); };
$('center-image').onclick = () => { if (avatarSource) { avatarCrop = initialCrop(avatarSource.width,avatarSource.height); drawAvatar(); } };
$('export-avatar').onclick = async () => { try { await api.exportImage(avatarPng()); } catch (e) { $('avatar-error').textContent = e.message; } };
$('apply-avatar').onclick = async () => {
  if(avatarTarget?.kind==='profile') {
    if($('settings-dialog').open){pendingProfileAvatar=avatarPng();renderProfilePhoto();}
    $('avatar-dialog').close();$('change-profile-photo').focus();return;
  }
  const result=await run(()=>api.updateBot({id:avatarTarget?.botId||editingBot,avatarDataUrl:avatarPng()}));
  if(result)$('avatar-dialog').close();
};
$('dropzone').onpointerdown = e => { if (!avatarSource) return; pointer = { id:e.pointerId,x:e.clientX,y:e.clientY }; e.currentTarget.setPointerCapture(e.pointerId); };
$('dropzone').onpointermove = e => { if (!pointer || pointer.id !== e.pointerId) return; avatarCrop = panCrop(avatarSource.width,avatarSource.height,avatarCrop,e.clientX-pointer.x,e.clientY-pointer.y,288); pointer.x=e.clientX;pointer.y=e.clientY;drawAvatar(); };
$('dropzone').onpointerup = () => { pointer = null; }; $('dropzone').onpointercancel = () => { pointer = null; };
async function fromFile(file) {
  if (!file) return; if (!file.type.startsWith('image/')) { $('avatar-error').textContent = 'Choose an image file.'; return; }
  if (file.size > MAX_IMAGE_BYTES) { $('avatar-error').textContent = 'Choose an image smaller than 25 MB.'; return; }
  try { const dataUrl = await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); }); await chooseSource(dataUrl,file.name); } catch { $('avatar-error').textContent = 'Could not read this image.'; }
}
$('dropzone').ondragover = e => { e.preventDefault(); $('dropzone').classList.add('dragover'); };
$('dropzone').ondragleave = () => $('dropzone').classList.remove('dragover');
$('dropzone').ondrop = e => { e.preventDefault(); $('dropzone').classList.remove('dragover'); fromFile(e.dataTransfer.files[0]); };
$('avatar-dialog').addEventListener('paste', e => { if (e.target.matches('input,textarea')) return; const item = [...e.clipboardData.items].find(x => x.type.startsWith('image/')); if (item) { e.preventDefault(); fromFile(item.getAsFile()); } });
$('avatar-dialog').addEventListener('close', () => { imageSequence++; pointer = null; });
workspaceUI=setupWorkspace({api,getState:()=>state,run,avatar:bot=>makeAvatar(bot,false,'workspace'),onOpenSource:id=>navigate(()=>api.selectConversation({id}))});
selects.refresh();
threadUI=setupThreads({api,getState:()=>state,navigate,avatar:(bot,location='thread')=>makeAvatar(bot,false,location),onCreated:render,onDeleted:render,beforeDelete:async conversationId=>{if(conversationId===state.activeConversationId){voiceInput?.cancel();selects.close();}await flushDraft();},beforeCompose:async()=>{voiceInput?.cancel();selects.close();await flushDraft();return workspaceUI.beforeNavigate();},onModeChange:()=>{homeVisible=false;updateView();refreshComposer();},onError:notice});
setupMentions({getState:()=>state});
setupComposerMenu({api:{...api,attachFiles:async value=>{const conversationId=threadUI.composing?await threadUI.commit():value.conversationId;return api.attachFiles({conversationId});}},getState:()=>state,run,workspace:{...workspaceUI,openSchedules:async()=>{try{if(threadUI.composing)await threadUI.commit();workspaceUI.openSchedules();}catch(error){notice(error);}},openComputer:async options=>{try{if(threadUI.composing)await threadUI.commit();workspaceUI.openComputer(options);}catch(error){notice(error);}}}});
const edition=await api.edition();$('home-title').textContent=edition.name;document.title=edition.name;document.documentElement.dataset.edition=edition.id;
api.onState(render); await run(async () => api.snapshot()); if (state.settings.provider === 'claude') void checkClaudeConnection();if(state.settings.provider==='codex')void checkCodexConnection(); $('prompt').focus();
