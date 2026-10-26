import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import worker,{frameBits} from '../worker/index.js';
const env={PEBBLE_API_ORIGIN:'https://api.example.com',PEBBLE_DEVICE_ID:'pebble',PEBBLE_WRITER_TOKEN:'test-writer'};
const snapshot={face:'hearts',message:'Hello, Pebble!',revision:3,nextPollSeconds:60,selection:{source:'jev',reason:'selected'}};
const request=(path,method='GET',body,headers={})=>new Request('https://preview.test'+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
async function mocked(callback,run){const saved=globalThis.fetch;globalThis.fetch=callback;try{await run()}finally{globalThis.fetch=saved}}

test('public queued sends have no cooldown or public history',async t=>{
 await t.test('preview classifies without enqueuing and reveals only the chosen face',()=>mocked(async(url,init)=>{
  assert.equal(new URL(url).pathname,'/v1/render');
  assert.deepEqual(JSON.parse(init.body),{message:'I love you',state:{kind:'public-message'}});
  return Response.json({face:'hearts',message:'I love you',selection:{reason:'selected'},private:'not public'});
 },async()=>{
  const r=await worker.fetch(request('/api/preview','POST',{message:'I love you'}),env);
  assert.equal(r.status,200);assert.deepEqual(await r.json(),{face:'hearts'});
  assert.equal((await worker.fetch(request('/api/preview','POST',{message:'hi',face:'hearts'}),env)).status,400);
  assert.equal((await worker.fetch(request('/api/preview','POST',{message:'hi'},{Origin:'https://bad.test'}),env)).status,403);
 }));
 await t.test('sending the previewed face queues it without reclassification',()=>mocked(async(url,init)=>{
  assert.equal(new URL(url).pathname,'/v1/devices/pebble/messages');
  assert.equal(JSON.parse(init.body).face,'sleepy');
  return Response.json({queued:true,id:1},{status:202});
 },async()=>{
  const r=await worker.fetch(request('/api/moments','POST',{message:'Good night',face:'sleepy'}),env);
  assert.equal(r.status,202);assert.equal((await r.json()).face,'sleepy');
 }));
 await t.test('static composer keeps the draft preview without cooldown or secrets',async()=>{
  for(const path of ['/','/app.js','/style.css']){const r=await worker.fetch(request(path),env);assert.equal(r.status,200);const body=await r.text();assert.ok(!body.includes('test-writer')&&!body.includes('test-reader'));for(const removed of ['Available in','Checks about once','One message per minute'])assert.ok(!body.includes(removed));}
  for(const path of ['/api/display','/api/status','/api/history','/api/moments'])assert.equal((await worker.fetch(request(path),env)).status,404);
  assert.equal((await worker.fetch(request('/api/message','DELETE'),env)).status,404);
 });
 await t.test('cross-origin and invalid input rejected',()=>mocked(async()=>{throw Error('unexpected call')},async()=>{
  assert.equal((await worker.fetch(request('/api/moments','POST',{message:'hi'},{Origin:'https://bad.test'}),env)).status,403);
  for(const value of [{message:'\ud800'},{message:'\udfff'.repeat(120)},{message:''},{message:'x'.repeat(121)},{message:'a\tb'},{message:'hello',face:'not-a-face'},{message:123}])assert.equal((await worker.fetch(request('/api/moments','POST',value),env)).status,400);
 }));
 await t.test('back-to-back and concurrent sends all enqueue',()=>{let id=0;return mocked(async(url,init)=>{
  if(new URL(url).pathname==='/v1/render')return Response.json({face:'hearts'});
  assert.equal(new URL(url).pathname,'/v1/devices/pebble/messages');assert.equal(init.method,'POST');assert.equal(init.redirect,'manual');assert.equal(init.headers.Authorization,'Bearer test-writer');assert.deepEqual(JSON.parse(init.body),{message:'Hello!',state:{kind:'public-message'},face:'hearts'});return Response.json({queued:true,id:++id},{status:202});
 },async()=>{const results=await Promise.all(Array.from({length:12},()=>worker.fetch(request('/api/moments','POST',{message:'Hello!'}),env)));assert.ok(results.every(r=>r.status===202));assert.equal(id,12)})});
 await t.test('upstream failure retains draft and has no client cooldown',()=>mocked(async()=>Response.json({error:'internal secret'},{status:500}),async()=>{for(let i=0;i<2;i++){const r=await worker.fetch(request('/api/moments','POST',{message:'Hi'}),env);assert.equal(r.status,502);assert.ok(!(await r.text()).includes('internal secret'))}}));
});

test('preview pixels match native firmware',async t=>{
 const preview=fileURLToPath(new URL('../../../firmware/build-host/ink-preview',import.meta.url));
 assert.equal(frameBits('hearts','Hello, Pebble!').length,5000);
 try{await readFile(preview)}catch{t.skip('Native firmware preview is not installed in this independent Site checkout');return}
 const dir=await mkdtemp(join(tmpdir(),'pebble-preview-'));
 try{
  for(const message of ['Hello, Pebble!','A small bright moment for you','','Čć Žž Šš Đđ','a\nb','😀','x'.repeat(120),'words with spaces   \n and lines']){
   const input=join(dir,'snapshot.json'),output=join(dir,'out.pbm');await writeFile(input,JSON.stringify({...snapshot,message}));
   execFileSync(preview,[input,output]);const pbm=await readFile(output);assert.deepEqual(Buffer.from(frameBits('hearts',message)),pbm.subarray(11),message);
  }
 }finally{await rm(dir,{recursive:true,force:true})}
});
