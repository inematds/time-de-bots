import test from 'node:test';import assert from 'node:assert/strict';
import {publicURL,publicAddress} from '../src/web-tools.mjs';
test('web tools reject local addresses, credentials and alternate protocols',()=>{
 for(const url of ['http://example.com','https://localhost','https://127.0.0.1','https://2130706433','https://192.168.1.2','https://10.0.0.1','https://machine.internal','https://[::1]','https://user:pass@example.com','https://example.com:4433'])assert.throws(()=>publicURL(url));
 assert.equal(publicURL('https://example.org/docs?q=1').hostname,'example.org');
 for(const address of ['0.0.0.0','127.0.0.1','10.2.3.4','172.16.0.1','192.168.0.1','169.254.169.254','100.64.0.1','224.0.0.1','::1'])assert.equal(publicAddress(address),false,address);
 assert.equal(publicAddress('93.184.216.34'),true);
});
test('web reading handles plain text and JSON sources without an HTML document root',async()=>{const{extractWebpage}=await import('../src/web-tools.mjs');assert.match(extractWebpage({url:'https://www.rfc-editor.org/rfc/rfc2606.txt',contentType:'text/plain; charset=UTF-8',text:'RFC 2606\n\nexample.com is reserved.'}).text,/RFC 2606\n\nexample.com/);assert.equal(extractWebpage({url:'https://example.org/data',contentType:'application/json',text:'{"value":42}'}).text,'{"value":42}');assert.equal(extractWebpage({url:'https://example.org',contentType:'text/html',text:'<main><p>Useful content</p><script>hidden()</script></main>'}).text,'Useful content');});
