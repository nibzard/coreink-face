import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
const temp = await mkdtemp(join(tmpdir(), 'coreink-test-'));
const listener = createServer();
await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const base = `http://127.0.0.1:${port}`;
let child;
let output = '';
async function start() {
  child = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', '--port', String(port), '--persist-to', temp, '--var', 'API_TOKEN:runtime-test-writer', '--var', 'DEVICE_TOKEN:runtime-test-reader', '--var', 'FACE_PROVIDER:rules'], { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', data => { output = (output + data).slice(-12000); });
  child.stderr.on('data', data => { output = (output + data).slice(-12000); });
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`Wrangler exited: ${output}`);
    try { if ((await fetch(base + '/health')).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`Wrangler did not start: ${output}`);
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  await new Promise(resolve => { child.once('exit', resolve); child.kill('SIGTERM'); });
}
const call = (path, { method = 'GET', token = 'runtime-test-writer', body, headers = {} } = {}) => fetch(base + path, {
  method, headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
  ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
});
try {
  await start();
  assert.equal((await call('/v1/faces', { token: 'bad' })).status, 401);
  assert.equal((await (await call('/v1/faces')).json()).faces.length, 35);
  assert.equal((await call('/v1/devices/other/face')).status, 404);
  assert.equal((await call('/v1/decide', { method: 'POST', body: { state: [] } })).status, 400);
  assert.equal((await call('/v1/decide', { method: 'POST', body: '{' })).status, 400);
  assert.equal((await call('/v1/decide', { method: 'POST', body: { state: { text: 'x'.repeat(17000) } } })).status, 413);
  assert.equal((await call('/v1/decide', { method: 'POST', token: 'runtime-test-reader', body: { state: {} } })).status, 401);
  for (const message of [123, null, 'x'.repeat(121), 'bad\u0000text']) {
    assert.equal((await call('/v1/decide', { method: 'POST', body: { message } })).status, 400);
  }
  const onlyMessage = await call('/v1/decide', { method: 'POST', body: { message: 'Hello 🌱' } });
  assert.equal(onlyMessage.status, 200);
  assert.equal((await onlyMessage.json()).message, 'Hello 🌱');
  assert.equal((await call('/v1/decide', { method: 'POST', body: { message: '🌱'.repeat(120) } })).status, 200);
  const first = await call('/v1/devices/room/state', { method: 'PUT', body: { state: { expression: 'curious' }, message: 'Hello 🌱' } });
  assert.equal(first.status, 200);
  assert.equal((await first.json()).decision.face, 'curious');
  assert.equal((await (await call('/v1/devices/room/face')).json()).message, 'Hello 🌱');
  const read = await call('/v1/devices/room/face', { token: 'runtime-test-reader' });
  assert.equal(read.status, 200);
  assert.equal((await call('/v1/devices/room/face', { headers: { 'If-None-Match': read.headers.get('ETag') } })).status, 304);
  assert.equal((await call('/v1/devices/room/face', { headers: { 'If-None-Match': `W/${read.headers.get('ETag')}` } })).status, 304);
  assert.equal((await call('/v1/devices/room/face', { headers: { 'If-None-Match': `\"old\", W/${read.headers.get('ETag')}` } })).status, 304);
  const second = await (await call('/v1/devices/room/state', { method: 'PUT', body: { state: { expression: 'hearts' } } })).json();
  assert.equal(second.message, 'Hello 🌱');
  assert.equal(second.decision.reason, 'minimum-hold');
  assert.equal(second.decision.face, 'curious');
  assert.equal(second.decision.candidate, 'hearts');
  // Restart to verify SQLite persistence and pending alarm recovery.
  await stop(); await start();
  assert.equal((await (await call('/v1/devices/room/face')).json()).revision, second.revision);
  for (let i = 0; i < 40; i++) {
    const result = await (await call('/v1/devices/room/face')).json();
    assert.equal(result.message, 'Hello 🌱');
    if (result.decision.face === 'hearts') break;
    if (i === 39) throw new Error('Pending expression did not settle after hold');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.equal((await call('/v1/devices/other/face')).status, 404);
  const beforeMessage = await call('/v1/devices/room/face');
  const messageOnly = await call('/v1/devices/room/state', { method: 'PUT', body: { message: 'See you soon!' } });
  assert.equal(messageOnly.status, 200);
  const messageUpdate = await messageOnly.json();
  assert.equal(messageUpdate.message, 'See you soon!');
  assert.equal(messageUpdate.decision.face, 'hearts'); // Face is held; message updates immediately.
  assert.equal((await call('/v1/devices/room/face', { headers: { 'If-None-Match': beforeMessage.headers.get('ETag') } })).status, 200);
  const cleared = await (await call('/v1/devices/room/state', { method: 'PUT', body: { state: { expression: 'hearts' }, message: '' } })).json();
  assert.equal(cleared.message, '');
  assert.equal((await (await call('/v1/devices/room/face')).json()).message, '');
  console.log('Runtime checks passed: authentication, validation, catalog, device isolation, ETags, SQLite restart persistence, delayed face updates.');
} finally { await stop(); await rm(temp, { recursive: true, force: true }); }
