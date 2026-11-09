import {readdir,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const excluded=new Set(['.git','node_modules','.cache','release','data','test-results','playwright-report']);
async function walk(dir='.') {const result=[];for(const entry of await readdir(dir,{withFileTypes:true})){if(excluded.has(entry.name)||dir==='./assets'&&['composio-cli','models'].includes(entry.name))continue;const p=dir+'/'+entry.name;if(entry.isDirectory())result.push(...await walk(p));else result.push(p.replace(/^\.\//,''));}return result;}
let files;try{files=execFileSync('git',['ls-files','--cached','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);if(!files.length)files=await walk();}catch{files=await walk();}
const problems=[];
for(const file of files){
 if(/(^|\/)(?:data|evidence|release|node_modules|\.cache|\.wrangler)(?:\/|$)|\.(?:secure|db|sqlite|woff2?|ttf|otf)$|(^|\/)\.env(?:\.|$)/i.test(file))problems.push(file+': runtime data or unapproved binary asset');
 const bytes=await readFile(file);if(bytes.includes(0)||bytes.length>2000000)continue;const text=bytes.toString();
 if(/\/Users\/[a-z0-9_.-]+\//i.test(text))problems.push(file+': machine-specific home path');
 if(/(?:gh[pousr]_[A-Za-z0-9]{30,}|sk-ant-[A-Za-z0-9_-]{40,}|AKIA[A-Z0-9]{16})/.test(text))problems.push(file+': possible credential');
 if(/"account_id"\s*:\s*"[a-f0-9]{32}"/i.test(text))problems.push(file+': configured hosting account');
}
if(problems.length){console.error(problems.join('\n'));process.exitCode=1;}else console.log(`Checked ${files.length} distribution files: no forbidden runtime data, home paths or credential patterns.`);
