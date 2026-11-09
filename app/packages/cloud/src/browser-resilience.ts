import type { Page } from '@cloudflare/playwright';

export class BrowserStepTimeout extends Error {
  constructor(readonly stage: string) { super(`The browser did not respond during ${stage}.`); this.name='BrowserStepTimeout'; }
}
export async function within<T>(stage:string, milliseconds:number, work:()=>Promise<T>):Promise<T>{
  let timer:ReturnType<typeof setTimeout>;
  try{return await Promise.race([Promise.resolve().then(work),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new BrowserStepTimeout(stage)),Math.max(1,milliseconds));})]);}
  finally{clearTimeout(timer!);}
}

// A document can be usable while a deferred script, frame or font never finishes.
// Wait for navigation to commit, then give hydration a bounded grace period.
export async function navigateResponsive(page:Page,url:string):Promise<string[]>{
  const before=page.url(),warnings:string[]=[];
  try{const response=await within('navigation',16000,()=>page.goto(url,{waitUntil:'commit',timeout:15000}));if(response&&response.status()>=400)warnings.push(`The website returned HTTP ${response.status()}. The current page is shown.`);}
  catch(error){
    if(!/timeout|did not respond/i.test(String(error)))throw error;
    if(!/^https?:/.test(page.url())||(page.url()===before&&page.url()!==url))throw error;
    warnings.push('Navigation is still loading; inspect the current screen before continuing.');
  }
  try{await within('document readiness',3500,()=>page.waitForLoadState('domcontentloaded',{timeout:3000}));}
  catch{warnings.push('The page has not finished loading. Available content is shown.');}
  return warnings;
}

// Prefer a normal painted screenshot, with a bounded compositor fallback for stuck fonts.
export async function captureResponsive(page:Page):Promise<Uint8Array<ArrayBuffer>>{
  try{return new Uint8Array(await within('painted screenshot',3500,()=>page.screenshot({type:'png',animations:'disabled',fullPage:false,timeout:3000})));}catch{/* Stalled fonts must not prevent the user from seeing the current screen. */}
  const cdp=await within('screenshot connection',2000,()=>page.context().newCDPSession(page));
  try{
    const result=await within('screenshot',5000,()=>cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false}));
    return Uint8Array.from(atob(result.data),character=>character.charCodeAt(0));
  }finally{await within('screenshot cleanup',500,()=>cdp.detach()).catch(()=>{});}
}
