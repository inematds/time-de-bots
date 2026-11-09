// An edition may supply generic starter roles for a brand-new profile only.
export async function applyEdition(service,edition){
 if(!Array.isArray(edition.starterBots)||!edition.starterBots.length||service.state.editionSetup)return;
 const empty=service.state.bots.length===1&&service.state.conversations.every(c=>c.messages.length===0);
 if(empty){for(const [index,template]of edition.starterBots.entries()){if(index===0)await service.updateBot({id:service.state.bots[0].id,...template,promptMode:'manual'});else await service.createBot({...template,promptMode:'manual'});}await service.selectBot({id:service.state.bots[0].id});}
 service.state.editionSetup=true;await service._changed();
}
