import test from 'node:test';import assert from 'node:assert/strict';import{computerPoint}from'../src/workspace-layout.mjs';
test('full-screen clicks map through letterboxing and ignore the surrounding bars',()=>{
 const image={naturalWidth:1280,naturalHeight:800,getBoundingClientRect:()=>({left:100,top:50,width:1000,height:400})};
 assert.deepEqual(computerPoint(image,600,250),{x:640,y:400});assert.equal(computerPoint(image,110,250),null);assert.equal(computerPoint(image,1090,250),null);assert.deepEqual(computerPoint(image,280,50),{x:0,y:0});
});
test('portrait full-screen letterboxing preserves all four screenshot edges',()=>{
 const image={naturalWidth:1280,naturalHeight:800,getBoundingClientRect:()=>({left:10,top:20,width:640,height:800})};
 assert.equal(computerPoint(image,330,30),null);assert.deepEqual(computerPoint(image,10,220),{x:0,y:0});assert.deepEqual(computerPoint(image,649,619),{x:1278,y:798});
});
