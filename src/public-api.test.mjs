import test from 'node:test';
import assert from 'node:assert/strict';
import {request,cosine,importDocument,clearDocuments} from './public-api.mjs';
import {consumeSSE} from './lib.mjs';
const original=globalThis.fetch;
function mockProvider({broken=false,reject=false}={}){
 globalThis.fetch=async(url,options)=>{
  assert.ok(url.startsWith('https://dashscope.aliyuncs.com/compatible-mode/v1/'));
  assert.equal(options.credentials,'omit');
  assert.ok(options.headers.Authorization.startsWith('Bearer '));
  if(reject)return new Response('',{status:401});
  const data=JSON.parse(options.body);
  if(url.endsWith('/embeddings'))return Response.json({data:data.input.map((_,index)=>({index,embedding:[1,0,0]}))});
  if(!data.stream)return Response.json({choices:[{message:{content:'OK'}}]});
  const body='data: '+JSON.stringify({choices:[{delta:{content:'公开体验回答'}}]})+'\n\n'+(broken?'':'data: [DONE]\n\n');
  const bytes=new TextEncoder().encode(body);return new Response(new ReadableStream({start(c){c.enqueue(bytes.slice(0,27));c.enqueue(bytes.slice(27));c.close();}}));
 };
}
async function clear(){await request('/api/v1/settings/visitor-key',{method:'DELETE'});clearDocuments();}
async function configure(){return request('/api/v1/settings/visitor-key',{method:'PUT',body:JSON.stringify({api_key:'test-only-visitor-key'})});}
test('public requests require a visitor key and never fall back',async()=>{await clear();const response=await request('/api/v1/chat/stream',{body:'{}'});assert.equal(response.status,403);});
test('validation, split streaming and key clearing close the public flow',async()=>{
 mockProvider();try{
  assert.equal((await configure()).status,200);
  const response=await request('/api/v1/chat/stream',{body:JSON.stringify({message:'体验功能？'})});
  const events=[];await consumeSSE(response,e=>events.push(e));
  assert.equal(events.at(-1).event,'done');assert.equal(events.at(-1).data.answer,'公开体验回答');
  await clear();assert.equal((await(await request('/api/v1/settings/model')).json()).configured,false);
 }finally{globalThis.fetch=original;}
});
test('failed replacement retains the previously validated key',async()=>{
 mockProvider();try{await configure();mockProvider({reject:true});assert.equal((await configure()).status,400);assert.equal((await(await request('/api/v1/settings/model')).json()).configured,true);}finally{await clear();globalThis.fetch=original;}
});
test('truncated provider stream becomes explicit error, never successful answer',async()=>{
 mockProvider();try{await configure();mockProvider({broken:true});const response=await request('/api/v1/chat/stream',{body:JSON.stringify({message:'测试'})});await assert.rejects(consumeSSE(response,()=>{}),/未完整结束/);}finally{await clear();globalThis.fetch=original;}
});
test('imports reject binaries and oversized or invalid UTF8, cosine is validated',async()=>{
 await assert.rejects(importDocument(new File(['x'],'secret.pdf')),/TXT/);
 await assert.rejects(importDocument(new File([new Uint8Array([255])],'sample.txt')),/UTF-8/);
 await assert.rejects(importDocument(new File(['\0'],'sample.md')),/有效文本/);
 await assert.rejects(importDocument(new File([new Uint8Array(205000)],'sample.txt')),/200KB/);
 assert.throws(()=>cosine([1],[1,2]),/维度/);assert.equal(cosine([1,0],[1,0]),1);
});
