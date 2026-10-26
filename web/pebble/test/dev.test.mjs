import test from 'node:test';
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {createDevServer} from '../scripts/dev.mjs';

test('local adapter preserves localhost and numeric loopback origins', async () => {
 const server=createDevServer({});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const port=server.address().port;
 try {
  for(const host of ['localhost','127.0.0.1']) {
   const status=await new Promise((resolve,reject)=>{
    const req=request({hostname:'127.0.0.1',port,path:'/api/preview',method:'POST',headers:{Host:host+':'+port,Origin:'http://'+host+':'+port,'Content-Type':'application/json'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode))});
    req.on('error',reject);req.end('{}');
   });
   // Input validation proves the request passed the origin check; no upstream call.
   assert.equal(status,400);
  }
 } finally { await new Promise(resolve=>server.close(resolve)); }
});
