import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import worker from '../worker/index.js';

const request=path=>new Request('https://preview.test'+path);
const app=await(await worker.fetch(request('/app.js'),{})).text();
const device=await(await worker.fetch(request('/device.js'),{})).text();
const {renderFrame}=await import('data:text/javascript;base64,'+Buffer.from(device).toString('base64'));
const importLine="import {renderFrame} from '/device.js';";
assert.ok(app.includes(importLine));
const storage=()=>{const values=new Map();return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}};
function browser(localStorage=storage(),respond=async(path,body)=>({ok:true,json:async()=>path==='/api/preview'?{face:'hearts'}:{queued:true,id:1,face:body.face}})){
 const timers=new Map(),requests=[],frames=[];let timerId=0;
 function node(tag){return {tag,value:'',textContent:'',children:[],events:{},disabled:false,
  addEventListener(event,handler){this.events[event]=handler},setAttribute(){},focus(){},
  append(...items){this.children.push(...items)},replaceChildren(...items){this.children=items},
  getContext(){return {createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(image){}}}
 }}
 const ids=['message','send','feedback','count','send-label','moment-form','display','preview-status','sent-list','history-empty','history-note','clear-history'];
 const elements=Object.fromEntries(ids.map(id=>[id,node(id)]));
 runInNewContext(app.replace(importLine,''),{
  document:{querySelector:selector=>elements[selector.slice(1)],createElement:node},
  renderFrame:(canvas,face,message)=>{frames.push({canvas,face,message});renderFrame(canvas,face,message)},
  localStorage,window:{addEventListener(){}},
  setTimeout:callback=>{timers.set(++timerId,callback);return timerId},clearTimeout:id=>timers.delete(id),
  fetch:async(path,init)=>{const body=JSON.parse(init.body);requests.push({path,body});return respond(path,body)}
 });
 return {elements,requests,frames,localStorage,
  input(message){elements.message.value=message;elements.message.events.input()},
  async settle(){const callbacks=[...timers.values()];timers.clear();await Promise.all(callbacks.map(fn=>fn()))},
  async submit(){await elements['moment-form'].events.submit({preventDefault(){}})}
 };
}

test('draft uses its selected face; send preserves that face and records only successful sends',async()=>{
 let success=false;
 const b=browser(storage(),async(path,body)=>({ok:path==='/api/preview'||success,json:async()=>path==='/api/preview'?{face:'hearts'}:success?{queued:true,id:1,face:body.face}:{error:'Try again'}}));
 assert.equal(b.frames[0].face,'small-dots');
 b.input('I love you');await b.settle();
 assert.equal(b.frames.at(-1).face,'hearts');
 await b.submit();
 assert.equal(b.elements.message.value,'I love you');assert.equal(b.elements['sent-list'].children.length,0);
 success=true;await b.submit();
 assert.equal(b.elements.message.value,'');
 assert.equal(b.elements['sent-list'].children.length,1);
 assert.deepEqual(b.requests.at(-1),{path:'/api/moments',body:{message:'I love you',face:'hearts'}});
 assert.equal(b.requests.filter(r=>r.path==='/api/preview').length,1);
});

test('history persists in its own browser and is absent in another browser',async()=>{
 const a=browser();a.input('<img src=x onerror=alert(1)>');await a.submit();
 const reloaded=browser(a.localStorage),other=browser();
 assert.equal(reloaded.elements['sent-list'].children.length,1);
 assert.equal(other.elements['sent-list'].children.length,0);
 assert.equal(reloaded.requests.length,0);assert.equal(other.requests.length,0);
 const message=reloaded.elements['sent-list'].children[0].children[1].children[0];
 assert.equal(message.textContent,'<img src=x onerror=alert(1)>');
 assert.equal(message.children.length,0,'message is rendered as text, never HTML');
 reloaded.elements['clear-history'].events.click();
 assert.equal(browser(a.localStorage).elements['sent-list'].children.length,0);
});

test('older preview responses cannot replace a newer draft expression',async()=>{
 const resolve=new Map();
 const b=browser(storage(),async(path,body)=>new Promise(done=>resolve.set(body.message,face=>done({ok:true,json:async()=>({face})}))));
 b.input('old');const old=b.settle();
 b.input('new');const current=b.settle();
 resolve.get('new')('stars');await current;
 resolve.get('old')('sleepy');await old;
 assert.equal(b.frames.at(-1).face,'stars');assert.equal(b.frames.at(-1).message,'new');
});

test('editing during a send retains the new draft and records the submitted message',async()=>{
 let complete;
 const b=browser(storage(),async(path)=>path==='/api/preview'?{ok:true,json:async()=>({face:'hearts'})}:new Promise(resolve=>complete=resolve));
 b.input('First');await b.settle();const sending=b.submit();
 await Promise.resolve();await Promise.resolve();
 b.input('Next draft');complete({ok:true,json:async()=>({queued:true,id:1})});await sending;
 assert.equal(b.elements.message.value,'Next draft');
 assert.equal(JSON.parse(b.localStorage.getItem('pebble.sent.v1'))[0].message,'First');
});

test('unavailable or corrupt storage never prevents sending',async()=>{
 for(const store of [{getItem(){throw Error()},setItem(){throw Error()},removeItem(){throw Error()}},{...storage(),getItem:()=>'{bad json'}]){
  const b=browser(store);b.input('Hello');await b.submit();
  assert.equal(b.elements['sent-list'].children.length,1);assert.equal(b.elements.message.value,'');
 }
});

test('history is limited to the most recent twenty sends',async()=>{
 let id=0;
 const b=browser(storage(),async path=>({ok:true,json:async()=>path==='/api/preview'?{face:'stars'}:{queued:true,id:++id}}));
 for(let i=0;i<24;i++){b.input('Hello '+i);await b.submit()}
 assert.equal(b.elements['sent-list'].children.length,20);
 assert.equal(JSON.parse(b.localStorage.getItem('pebble.sent.v1'))[0].message,'Hello 23');
});
