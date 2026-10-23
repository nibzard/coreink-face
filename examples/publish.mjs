import { readFile } from 'node:fs/promises';
import { createClient } from 'coreink-face/client';
const [filename = 'examples/message.json', device = 'pebble'] = process.argv.slice(2);
if (!process.env.API_TOKEN) throw new Error('Set API_TOKEN or run node --env-file=.dev.vars examples/publish.mjs.');
const api = createClient({ baseUrl: process.env.FACE_API_URL ?? 'http://localhost:8787', token: process.env.API_TOKEN });
const input = JSON.parse(await readFile(filename, 'utf8'));
console.log(JSON.stringify(await api.device(device).update(input), null, 2));
