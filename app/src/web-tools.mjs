import https from 'node:https';
import {lookup} from 'node:dns/promises';
import {DOMParser} from 'linkedom';

export function publicAddress(address){const a=address.split('.').map(Number);return a.length===4&&a.every(n=>Number.isInteger(n)&&n>=0&&n<256)&&![0,10,127].includes(a[0])&&a[0]<224&&!(a[0]===169&&a[1]===254)&&!(a[0]===172&&a[1]>=16&&a[1]<=31)&&!(a[0]===192&&a[1]===168)&&!(a[0]===100&&a[1]>=64&&a[1]<=127);}
export function publicURL(value){const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443')||!url.hostname.includes('.')||/^(?:localhost|127\.|0\.|10\.|192\.168\.|169\.254\.)|\.(?:local|internal|localhost)$/i.test(url.hostname)||url.hostname.includes(':')){const error=new Error('Only public HTTPS webpages are allowed.');error.code='URL_BLOCKED';throw error;}return url;}
async function fetchText(value,signal,redirects=0){
 const url=publicURL(value);if(redirects>5)throw new Error('Too many redirects.');
 const addresses=await lookup(url.hostname,{family:4,all:true});if(!addresses.length||addresses.some(a=>!publicAddress(a.address))){const error=new Error('Private network destinations are blocked.');error.code='URL_BLOCKED';throw error;}
 // Pin the validated DNS result to this request; redirects are checked anew.
 const address=addresses[0];
 return new Promise((resolve,reject)=>{
  const request=https.get(url,{signal,timeout:15000,lookup:(_hostname,_options,callback)=>callback(null,[address]),headers:{'User-Agent':'Gratis/0.9 (personal research assistant)','Accept':'text/html,application/xml,text/plain','Accept-Encoding':'identity'}},response=>{
   if(response.statusCode>=300&&response.statusCode<400&&response.headers.location){response.resume();resolve(fetchText(new URL(response.headers.location,url).href,signal,redirects+1));return;}
   if(response.statusCode!==200){response.resume();reject(new Error(`Webpage returned HTTP ${response.statusCode}.`));return;}
   let size=0;const chunks=[];response.on('data',chunk=>{size+=chunk.length;if(size>2000000)response.destroy(new Error('Webpage exceeds the 2 MB reading limit.'));else chunks.push(chunk);});response.on('error',reject);response.on('end',()=>resolve({url:url.href,text:Buffer.concat(chunks).toString('utf8'),contentType:response.headers['content-type']||''}));
  });request.on('timeout',()=>request.destroy(new Error('Webpage request timed out.')));request.on('error',reject);
 });
}
export async function searchWeb(query,signal){if(typeof query!=='string'||!query.trim()||query.length>1000)throw new Error('Enter a search query under 1000 characters.');const result=await fetchText('https://www.bing.com/search?format=rss&q='+encodeURIComponent(query),signal);const doc=new DOMParser().parseFromString(result.text,'text/xml');return [...doc.querySelectorAll('item')].slice(0,8).map(item=>({title:item.querySelector('title')?.textContent,url:item.querySelector('link')?.textContent,snippet:item.querySelector('description')?.textContent}));}
export function extractWebpage(response){
 const type=String(response.contentType||'').split(';')[0].trim().toLowerCase();
 if(type==='application/pdf')throw new Error('This link is a PDF. Use the browser to inspect it or attach the PDF to read its contents.');
 if(type==='text/plain'||type==='application/json'||type.endsWith('+json')||(!/<(?:!doctype|html|head|body|main|article|div|p)(?:\s|>)/i.test(response.text)&&!type.includes('html'))){return{url:response.url,title:new URL(response.url).hostname,text:response.text.trim().slice(0,35000)};}
 const doc=new DOMParser().parseFromString(response.text,'text/html');for(const element of doc.querySelectorAll('script,style,noscript,svg,iframe,nav,footer'))element.remove();
 const root=doc.querySelector('main,article,body')||doc.documentElement||doc;
 const text=(root.textContent||'').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim().slice(0,35000);
 return{url:response.url,title:doc.querySelector('title')?.textContent||'',text};
}
export async function readWebpage(url,signal){return extractWebpage(await fetchText(url,signal));}
