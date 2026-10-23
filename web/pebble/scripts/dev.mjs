import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import worker from '../worker/index.js';
import {database} from './local-db.mjs';
import {mkdirSync} from 'node:fs';
mkdirSync(new URL('../.local',import.meta.url),{recursive:true});
const secretPath=process.env.PEBBLE_SECRETS_FILE||new URL('../../../.deployment-secrets.json',import.meta.url);
const secrets=JSON.parse(await readFile(secretPath,'utf8'));
const env={DB:database(new URL('../.local/inbox.sqlite',import.meta.url).pathname),PEBBLE_API_ORIGIN:'https://coreink-face-api.nikola-balic.workers.dev',PEBBLE_DEVICE_ID:'pebble',PEBBLE_READER_TOKEN:secrets.DEVICE_TOKEN,PEBBLE_WRITER_TOKEN:secrets.API_TOKEN};
const port=Number(process.env.PORT||8807);
const server=createServer(async(req,res)=>{try{
 const request=new Request('http://127.0.0.1:'+port+req.url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Readable.toWeb(req),duplex:'half'}:{})});
 const response=await worker.fetch(request,env);res.writeHead(response.status,Object.fromEntries(response.headers));
 if(response.body)Readable.fromWeb(response.body).pipe(res);else res.end();
}catch{res.writeHead(500);res.end('Preview server error')}});
server.listen(port,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:'+port));
