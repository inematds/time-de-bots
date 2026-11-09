// Bots and group chats share one activity-ordered sidebar. Hidden teammate
// conversations never become separate entries or reorder a bot's personal chat.
export function sidebarItems(state,query=''){
 const roots=state.conversations.filter(c=>!c.parentThreadId).sort((a,b)=>b.updatedAt-a.updatedAt),needle=query.trim().toLowerCase();
 const bots=state.bots.map(bot=>{
  const chats=roots.filter(c=>c.botId===bot.id&&c.kind!=='group'),latest=chats[0];
  return{kind:'bot',key:bot.id,bot,pinned:!!bot.pinned,activity:Math.max(bot.createdAt,latest?.updatedAt||0),createdAt:bot.createdAt,preview:latest?.messages.findLast(m=>m.content)?.content||bot.instructions||'New conversation',search:[bot.name,...chats.flatMap(c=>[c.title,...c.messages.map(m=>m.content)])].join(' ')};
 });
 const groups=roots.filter(c=>c.kind==='group').map(conversation=>({kind:'group',key:conversation.id,conversation,pinned:!!conversation.pinned,activity:conversation.updatedAt,createdAt:conversation.createdAt,search:[conversation.title,...(conversation.participantIds||[]).map(id=>state.bots.find(b=>b.id===id)?.name||''),...conversation.messages.map(m=>m.content)].join(' ')}));
 return[...bots,...groups].filter(item=>!needle||item.search.toLowerCase().includes(needle)).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.activity-a.activity||Number(b.kind==='group')-Number(a.kind==='group')||b.createdAt-a.createdAt||a.key.localeCompare(b.key));
}
