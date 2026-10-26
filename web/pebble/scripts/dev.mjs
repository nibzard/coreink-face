import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {pathToFileURL} from 'node:url';
import worker from '../worker/index.js';
export function createDevServer(env, port=8807) {
const server=createServer(async(req,res)=>{try{
 const request=new Request('http://'+(req.headers.host||'127.0.0.1:'+port)+req.url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Readable.toWeb(req),duplex:'half'}:{})});
 const response=await worker.fetch(request,env);res.writeHead(response.status,Object.fromEntries(response.headers));
 if(response.body)Readable.fromWeb(response.body).pipe(res);else res.end();
}catch{res.writeHead(500);res.end('Preview server error')}});
return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
const secretPath=process.env.PEBBLE_SECRETS_FILE||new URL('../../../.deployment-secrets.json',import.meta.url);
const secrets=JSON.parse(await readFile(secretPath,'utf8'));
const env={PEBBLE_API_ORIGIN:'https://coreink-face-api.nikola-balic.workers.dev',PEBBLE_DEVICE_ID:'pebble',PEBBLE_WRITER_TOKEN:secrets.API_TOKEN,PEBBLE_SENDER_HASH_KEY:process.env.PEBBLE_SENDER_HASH_KEY||secrets.PEBBLE_SENDER_HASH_KEY};
const port=Number(process.env.PORT||8807);
createDevServer(env,port).listen(port,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:'+port));
}
