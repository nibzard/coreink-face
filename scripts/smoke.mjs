import { createClient } from 'coreink-face/client';
import assert from 'node:assert/strict';
const base = process.env.FACE_API_URL;
if (!base || !process.env.API_TOKEN || !process.env.DEVICE_TOKEN) throw new Error('Set FACE_API_URL, API_TOKEN and DEVICE_TOKEN');
const request = (path, token, method = 'GET', body, headers = {}) => fetch(base.replace(/\/$/, '') + path, {
  method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json', ...headers },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
assert.equal((await request('/health')).status, 200);
assert.equal((await request('/openapi.json')).status, 200);
assert.match(await (await request('/llms.txt')).text(), /createFace/);
assert.equal((await request('/v1/faces')).status, 401);
const catalog = await (await request('/v1/faces', process.env.DEVICE_TOKEN)).json();
assert.equal(catalog.faces.length, 35);
assert.equal((await request('/v1/decide', process.env.DEVICE_TOKEN, 'POST', { state: {} })).status, 401);
const response = await request('/v1/devices/pebble-demo/state', process.env.API_TOKEN, 'PUT', {
  message: 'Found a shiny pebble!',
  state: { character: 'A small curious stone creature', event: 'Discovered a shiny pebble while exploring', expression: 'stars' },
});
assert.equal(response.status, 200);
const written = await response.json();
assert.equal(written.message, 'Found a shiny pebble!');
assert.ok(catalog.faces.some(face => face.id === written.decision.face));
assert.notEqual(written.decision.reason, 'provider-unavailable');
const read = await request('/v1/devices/pebble-demo/face', process.env.DEVICE_TOKEN);
assert.equal(read.status, 200);
const stored = await read.json();
assert.equal(stored.revision, written.revision);
assert.equal(stored.message, written.message);
assert.equal((await request('/v1/devices/pebble-demo/face', process.env.DEVICE_TOKEN, 'GET', undefined, { 'If-None-Match': read.headers.get('ETag') })).status, 304);
console.log(JSON.stringify({ status: 'passed', base, checks: ['health', 'authentication', 'read-only device access', 'catalog', 'classification', 'persistence', 'ETag'], decision: written.decision }, null, 2));

const writer = createClient({ baseUrl: base, token: process.env.API_TOKEN });
const reader = createClient({ baseUrl: base, token: process.env.DEVICE_TOKEN });
const canonical = await writer.device('library-demo').update({ face: 'hearts', message: 'Hello from the typed client!' });
assert.equal(canonical.face, 'hearts');
assert.equal(canonical.selection.source, 'explicit');
const polled = await reader.device('library-demo').read();
assert.equal(polled.status, 'modified');
assert.equal(polled.display.message, canonical.message);
assert.equal((await reader.device('library-demo').read({ etag: polled.etag })).status, 'not-modified');
const inferred = await writer.render({ message: 'A wonderful little discovery!' });
assert.notEqual(inferred.selection.reason, 'provider-unavailable');
console.log('Canonical SDK, explicit provider bypass, message delivery, conditional polling, and stateless inference checks passed.');
