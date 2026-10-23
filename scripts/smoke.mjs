import assert from 'node:assert/strict';
const base = process.env.FACE_API_URL;
if (!base || !process.env.API_TOKEN || !process.env.DEVICE_TOKEN) throw new Error('Set FACE_API_URL, API_TOKEN and DEVICE_TOKEN');
const request = (path, token, method = 'GET', body, headers = {}) => fetch(base.replace(/\/$/, '') + path, {
  method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json', ...headers },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
assert.equal((await request('/health')).status, 200);
assert.equal((await request('/v1/faces')).status, 401);
const catalog = await (await request('/v1/faces', process.env.DEVICE_TOKEN)).json();
assert.equal(catalog.faces.length, 35);
assert.equal((await request('/v1/decide', process.env.DEVICE_TOKEN, 'POST', { state: {} })).status, 401);
const response = await request('/v1/devices/pebble-demo/state', process.env.API_TOKEN, 'PUT', {
  state: { character: 'A small curious stone creature', event: 'Discovered a shiny pebble while exploring', expression: 'stars' },
});
assert.equal(response.status, 200);
const written = await response.json();
assert.ok(catalog.faces.some(face => face.id === written.decision.face));
assert.notEqual(written.decision.reason, 'provider-unavailable');
const read = await request('/v1/devices/pebble-demo/face', process.env.DEVICE_TOKEN);
assert.equal(read.status, 200);
assert.equal((await read.json()).revision, written.revision);
assert.equal((await request('/v1/devices/pebble-demo/face', process.env.DEVICE_TOKEN, 'GET', undefined, { 'If-None-Match': read.headers.get('ETag') })).status, 304);
console.log(JSON.stringify({ status: 'passed', base, checks: ['health', 'authentication', 'read-only device access', 'catalog', 'classification', 'persistence', 'ETag'], decision: written.decision }, null, 2));
