import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import worker,{frameBits} from '../worker/index.js';
const env={PEBBLE_API_ORIGIN:'https://api.example.com',PEBBLE_DEVICE_ID:'pebble',PEBBLE_READER_TOKEN:'test-reader',PEBBLE_WRITER_TOKEN:'test-writer'};
const snapshot={face:'hearts',message:'Hello, Pebble!',revision:3,nextPollSeconds:60,selection:{source:'jev',reason:'selected'}};
const request=(path,method='GET',body,headers={})=>new Request('https://preview.test'+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
async function mocked(callback,run){const saved=globalThis.fetch;globalThis.fetch=callback;try{await run()}finally{globalThis.fetch=saved}}

test('public inbox privacy, validation, and atomic cooldown',async t=>{
 const {database}=await import('../scripts/local-db.mjs');
 env.DB=database();
 await t.test('static assets omit credentials and private history',async()=>{
  for(const path of ['/','/app.js','/device.js','/style.css']){const r=await worker.fetch(request(path),env);assert.equal(r.status,200);const body=await r.text();assert.ok(!body.includes('test-writer')&&!body.includes('test-reader'));}
  assert.equal((await worker.fetch(request('/api/display'),env)).status,404);
  assert.equal((await worker.fetch(request('/api/message','DELETE'),env)).status,404);
  assert.deepEqual(await(await worker.fetch(request('/api/status'),env)).json(),{retryAfterSeconds:0,intervalSeconds:60});
 });
 await t.test('invalid and cross-origin requests do not reserve or call API',()=>mocked(async()=>{throw Error('unexpected call')},async()=>{
  assert.equal((await worker.fetch(request('/api/moments','POST',{message:'hi'},{Origin:'https://bad.test'}),env)).status,403);
  for(const value of [{message:''},{message:'x'.repeat(121)},{message:'a\tb'},{message:'hello',face:'hearts'},{message:123},{message:'x'.repeat(3000)}])assert.equal((await worker.fetch(request('/api/moments','POST',value),env)).status,400);
 }));
 await t.test('concurrent sends admit exactly one writer',()=>{let calls=0;return mocked(async(url,init)=>{
  calls++;assert.equal(init.method,'PUT');assert.equal(init.headers.Authorization,'Bearer test-writer');assert.deepEqual(JSON.parse(init.body),{message:'Hello!',state:{kind:'public-message'}});return Response.json({...snapshot,message:'Hello!'});
 },async()=>{const results=await Promise.all(Array.from({length:12},()=>worker.fetch(request('/api/moments','POST',{message:'Hello!'}),env)));assert.equal(results.filter(r=>r.status===200).length,1);assert.equal(results.filter(r=>r.status===429).length,11);assert.equal(calls,1);assert.ok(Number(results.find(r=>r.status===429).headers.get('Retry-After'))>0);const status=await(await worker.fetch(request('/api/status'),env)).json();assert.ok(status.retryAfterSeconds>0);assert.ok(!JSON.stringify(status).includes('Hello!'))})});
 env.DB.close();env.DB=database();
 await t.test('Unicode accepted, upstream errors hidden, cooldown retained on failure',()=>mocked(async()=>Response.json({error:'secret internal data'},{status:500}),async()=>{const r=await worker.fetch(request('/api/moments','POST',{message:'😀'.repeat(120)}),env);assert.equal(r.status,502);assert.ok(!(await r.text()).includes('secret internal data'));assert.equal((await worker.fetch(request('/api/moments','POST',{message:'again'}),env)).status,429)}));
 env.DB.close();env.DB=database();
 await t.test('oversized upstream response rejected',()=>mocked(async()=>new Response('x'.repeat(9000)),async()=>{assert.equal((await worker.fetch(request('/api/moments','POST',{message:'Hello'}),env)).status,502)}));env.DB.close();
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
