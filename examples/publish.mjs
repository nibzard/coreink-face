import { readFile } from 'node:fs/promises';
const [filename = 'examples/room.json', device = 'room-companion'] = process.argv.slice(2);
const base = process.env.FACE_API_URL ?? 'http://localhost:8787';
if (!process.env.API_TOKEN) throw new Error('Set API_TOKEN (or run node --env-file=.dev.vars examples/publish.mjs).');
const payload = JSON.parse(await readFile(filename, 'utf8'));
const response = await fetch(`${base.replace(/\/$/, '')}/v1/devices/${encodeURIComponent(device)}/state`, {
  method: 'PUT', headers: { Authorization: `Bearer ${process.env.API_TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});
const result = await response.json();
if (!response.ok) throw new Error(JSON.stringify(result));
console.log(JSON.stringify(result, null, 2));
