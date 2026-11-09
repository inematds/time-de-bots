import test from 'node:test';import assert from 'node:assert/strict';import {groupRecipients} from '../src/group-routing.mjs';
const members=[{id:'a',name:'Lead'},{id:'b',name:'Research partner'},{id:'c',name:'C++ expert'}];
test('routing respects exact names, multi-word names and explicit everyone, not quoted mentions',()=>{
 for(const message of ['hey guys','hello everyone','Tell me about @Research partnership','`@Lead` is a handle','person@Lead.com'])assert.deepEqual(groupRecipients(message,members,'a'),['a']);
 assert.deepEqual(groupRecipients('@Research partner can you check?',members,'a'),['b']);
 assert.deepEqual(groupRecipients('@Research partner and @C++ expert, help',members,'a'),['b','c']);
 assert.deepEqual(groupRecipients('Research partner: check it',members,'a'),['b']);
 assert.deepEqual(groupRecipients('@everyone weigh in',members,'a'),['a','b','c']);
 assert.deepEqual(groupRecipients('Everyone please respond to this',members,'a'),['a','b','c']);
});
