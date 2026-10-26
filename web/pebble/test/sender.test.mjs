import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { senderMetadata } from '../worker/index.js';

const env = { PEBBLE_API_ORIGIN: 'https://api.example.com', PEBBLE_DEVICE_ID: 'pebble', PEBBLE_WRITER_TOKEN: 'writer', PEBBLE_SENDER_HASH_KEY: 'test-key-'.repeat(8) };
const date = new Date('2026-10-26T12:00:00Z');
function request(path = '/api/moments', headers = {}, body = { message: 'Hello', face: 'hearts' }) {
  const req = new Request('https://preview.test' + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0) Firefox/100.0', ...headers }, body: JSON.stringify(body),
  });
  Object.defineProperty(req, 'cf', { value: { country: 'HR', asn: 13335, city: 'Not retained' } });
  return req;
}
test('keyed daily sender grouping is stable within a day and scoped to device', async () => {
  const a = await senderMetadata(request(), env, date);
  assert.match(a.fingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(await senderMetadata(request(), env, date), a);
  for (const b of [
    await senderMetadata(request(), env, new Date('2026-10-27T00:00:00Z')),
    await senderMetadata(request(), { ...env, PEBBLE_DEVICE_ID: 'other' }, date),
    await senderMetadata(request(), { ...env, PEBBLE_SENDER_HASH_KEY: 'other-key-'.repeat(8) }, date),
    await senderMetadata(request('/api/moments', { 'CF-Connecting-IP': '192.0.2.2' }), env, date),
  ]) assert.notEqual(a.fingerprint, b.fingerprint);
  assert.equal(a.country, 'HR'); assert.equal(a.asn, 13335);
  assert.equal(a.browser, 'Firefox'); assert.equal(a.device, 'desktop');
  assert.ok(!JSON.stringify(a).includes('192.0.2.1'));
  assert.ok(!JSON.stringify(a).includes('Mozilla'));
  assert.ok(!JSON.stringify(a).includes('Not retained'));
});
test('no key, no edge IP, or GPC never falls back to a raw or unkeyed identifier', async () => {
  for (const [req, config] of [
    [request(), { ...env, PEBBLE_SENDER_HASH_KEY: undefined }],
    [request(), { ...env, PEBBLE_SENDER_HASH_KEY: 'short' }],
    [request('/api/moments', { 'CF-Connecting-IP': '' }), env],
    [request('/api/moments', { 'Sec-GPC': '1' }), env],
  ]) {
    const sender = await senderMetadata(req, config, date);
    assert.equal(sender.fingerprint, null); assert.equal(sender.fingerprintDay, null);
  }
});
test('metadata is recomputed, forwarded only on send, and excluded from public responses and classifier input', async () => {
  const original = globalThis.fetch;
  let sends = 0;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    assert.equal('sender' in body, false);
    assert.deepEqual(body.state, { kind: 'public-message' });
    if (new URL(url).pathname === '/v1/render') {
      assert.equal(init.headers['X-Pebble-Sender'], undefined);
      return Response.json({ face: 'hearts' });
    }
    const sender = JSON.parse(init.headers['X-Pebble-Sender']);
    assert.match(sender.fingerprint, /^[a-f0-9]{64}$/);
    assert.equal(sender.country, 'HR');
    assert.ok(!JSON.stringify(init).includes('192.0.2.1'));
    sends++;
    return Response.json({ queued: true, id: sends, sender });
  };
  try {
    const preview = await worker.fetch(request('/api/preview', {}, { message: 'Hello' }), env);
    assert.deepEqual(await preview.json(), { face: 'hearts' });
    const response = await worker.fetch(request('/api/moments', { 'X-Pebble-Sender': '{"ip":"spoof"}' }, { message: 'Hello' }), env);
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { queued: true, id: 1, face: 'hearts' });
    assert.equal(response.headers.get('Set-Cookie'), null);
    assert.equal((await worker.fetch(request('/api/moments', {}, { message: 'Hello', sender: {} }), env)).status, 400);
    const page = await (await worker.fetch(new Request('https://preview.test/'), env)).text();
    assert.match(page, /href="\/privacy"/);
    const policy = await (await worker.fetch(new Request('https://preview.test/privacy'), env)).text();
    assert.match(policy, /latest 64/); assert.match(policy, /Global Privacy Control/);
  } finally { globalThis.fetch = original; }
});
