import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
test('public write executes inside the actual Workers runtime',async t=>{
 let Miniflare,convertV4MiniflareOptions;try{({Miniflare,convertV4MiniflareOptions}=await import('miniflare'))}catch{t.skip('Run from the main repository after npm ci for the workerd integration check');return}
 let calls=0;
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:fileURLToPath(new URL('../worker/index.js',import.meta.url)),compatibilityDate:'2026-10-01',d1Databases:{DB:'test'},bindings:{PEBBLE_API_ORIGIN:'https://api.example.com',PEBBLE_DEVICE_ID:'pebble',PEBBLE_WRITER_TOKEN:'test-writer'},outboundService:async request=>{
  assert.equal(request.method,'POST');assert.equal(request.headers.get('Authorization'),'Bearer test-writer');const body=await request.json();
  if(new URL(request.url).pathname==='/v1/render') {assert.deepEqual(body,{message:'Runtime check',state:{kind:'public-message'}});return Response.json({face:'hearts'});}
  calls++;assert.equal(new URL(request.url).pathname,'/v1/devices/pebble/messages');assert.deepEqual(body,{message:'Runtime check',state:{kind:'public-message'},face:'hearts'});
  return Response.json({queued:true,id:calls},{status:202});
 }}));
 try{
  const db=await mf.getD1Database('DB');await db.prepare(await readFile(new URL('../drizzle/0000_nosy_puff_adder.sql',import.meta.url),'utf8')).run();
  const response=await mf.dispatchFetch('https://preview.test/api/moments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'Runtime check'})});
  assert.equal(response.status,202,await response.clone().text());assert.equal((await response.json()).queued,true);assert.equal(calls,1);
  assert.equal((await mf.dispatchFetch('https://preview.test/api/moments',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"message":"Runtime check"}'})).status,202);
 }finally{await mf.dispose()}
});
