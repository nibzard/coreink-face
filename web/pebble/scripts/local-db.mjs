import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
export function database(path=':memory:'){
 const db=new DatabaseSync(path);
 for(const name of readdirSync(new URL('../drizzle/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort()){
  // Local preview has a single initial migration. Production uses the hosting migration runner.
  if(!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='send_gate'").get())db.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
 }
 return {prepare(sql){let args=[];return {bind(...values){args=values;return this},async first(){return db.prepare(sql).get(...args)||null}}},close(){db.close()}};
}
