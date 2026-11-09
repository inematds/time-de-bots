import {marked} from '../node_modules/marked/lib/marked.esm.js';
import DOMPurify from '../node_modules/dompurify/dist/purify.es.mjs';

const tags = ['p','br','strong','em','del','h1','h2','h3','h4','h5','h6','ul','ol','li','blockquote','pre','code','hr','table','thead','tbody','tr','th','td','a'];
export function renderMarkdown(source) {
  const body = document.createElement('div');
  body.className = 'message-body markdown';
  body.innerHTML = DOMPurify.sanitize(marked.parse(source || '', {gfm:true,breaks:true,async:false}), {
    ALLOWED_TAGS:tags, ALLOWED_ATTR:['href','title','class','start','align'], ALLOW_DATA_ATTR:false,
  });
  for (const link of body.querySelectorAll('a')) {
    const href = link.getAttribute('href') || '';
    if (!/^https?:\/\//i.test(href)) { link.removeAttribute('href'); continue; }
    link.addEventListener('click', event => { event.preventDefault(); void window.orbit.openExternal(href); });
    link.rel = 'noreferrer noopener';
  }
  for (const table of body.querySelectorAll('table')) {
    const scroll = document.createElement('div');scroll.className='table-scroll';table.replaceWith(scroll);scroll.append(table);
  }
  for (const pre of body.querySelectorAll('pre')) {
    const code=pre.querySelector('code');if(!code)continue;
    const header=document.createElement('div');header.className='code-header';
    const language=document.createElement('span');language.textContent=[...code.classList].find(c=>c.startsWith('language-'))?.slice(9)||'Text';
    const copy=document.createElement('button');copy.type='button';copy.textContent='Copy';copy.setAttribute('aria-label','Copy code');
    copy.onclick=async()=>{try{await window.orbit.copyText(code.textContent);copy.textContent='Copied';setTimeout(()=>{if(copy.isConnected)copy.textContent='Copy';},1600);}catch{copy.textContent='Try again';}};
    header.append(language,copy);pre.prepend(header);
  }
  return body;
}
