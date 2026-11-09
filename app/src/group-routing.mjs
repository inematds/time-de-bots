// Routing is deterministic only for an explicit address. Otherwise the lead
// decides whether a concrete delegation adds enough value to interrupt a peer.
export function groupRecipients(input,members,primaryId){
 const source=String(input).replace(/```[\s\S]*?```|`[^`]*`/g,' ');
 if(/(?:^|\s)@(?:everyone|all)\b/i.test(source)||/\b(?:everyone|all of you)\s+(?:please\s+)?(?:answer|respond|weigh in|review|share|give|contribute)\b/i.test(source))return members.map(b=>b.id);
 const matched=members.filter(b=>{
  const name=b.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return new RegExp('(?:^|[\\s,(])@'+name+'(?=$|[\\s,.:;!?])','iu').test(source)||new RegExp('^\\s*'+name+'\\s*[:,]','iu').test(source);
 });
 return matched.length?matched.map(b=>b.id):[primaryId];
}
