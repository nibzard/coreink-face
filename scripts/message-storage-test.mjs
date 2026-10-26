import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const dir = await mkdtemp(join(tmpdir(), 'coreink-message-storage-'));
let mf;
try {
  // Only this isolated harness exposes SQL inspection. Production has no history/debug endpoint.
  await build({ entryPoints: [resolve('src/cloudflare/worker.ts')], bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'], outfile: join(dir, 'worker.mjs'),
    plugins: [{ name: 'local-storage-inspection', setup(build) {
      build.onLoad({ filter: /src\/cloudflare\/(device|worker)\.ts$/ }, async ({ path }) => {
        let contents = await readFile(path, 'utf8');
        if (path.endsWith('/device.ts')) {
          contents = contents.replace('super(ctx, env);', `super(ctx, env);
            const exists = ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE name='messages'").toArray().length;
            if (!exists) {
              ctx.storage.sql.exec('CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, decision TEXT NOT NULL, message TEXT NOT NULL, delivered INTEGER NOT NULL DEFAULT 0)');
              ctx.storage.sql.exec("INSERT INTO messages (decision,message,delivered) VALUES (?, ?, 1)", JSON.stringify({face:'hearts',decidedAt:'2020-01-01T00:00:00.000Z'}), 'Legacy full message...');
            }
          `).replace('  private row()', "  inspect() { return this.ctx.storage.sql.exec('SELECT * FROM messages ORDER BY id').toArray(); }\n  private row()");
        } else {
          contents = contents.replace('  const path = new URL(request.url).pathname;', `
            const path = new URL(request.url).pathname;
            if (path === '/test-inspect') return Response.json(await env.DEVICES.getByName('test').inspect());
          `);
        }
        return { contents, loader: 'ts' };
      });
    } }],
  });
  const script = await readFile(join(dir, 'worker.mjs'), 'utf8');
  const start = () => new Miniflare({ ...convertV4MiniflareOptions({
    name: 'message-storage-test', modules: true, script, compatibilityDate: '2026-10-23',
    durableObjects: { DEVICES: { className: 'Device', useSQLite: true } },
    bindings: { API_TOKEN: 'writer', DEVICE_TOKEN: 'reader', FACE_PROVIDER: 'rules', JEV_MODEL: 'jev-latest' },
  }), resourcePersistencePath: join(dir, 'storage') });
  mf = start();
  const call = (path, body, token = 'writer', extra = {}) => mf.dispatchFetch('https://test.invalid' + path, {
    method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const inspect = async () => (await call('/test-inspect')).json();
  let rows = await inspect();
  assert.equal(rows[0].message, 'Legacy full message...');
  assert.equal(rows[0].received_at, null);
  assert.equal(rows[0].delivered_at, null);
  assert.equal(rows[0].sender, null);
  const sender = { source: 'pebble-inbox', fingerprint: 'a'.repeat(64), fingerprintDay: '2026-10-26', country: 'HR', asn: 13335, browser: 'Firefox', device: 'desktop' };
  const headers = { 'X-Pebble-Sender': JSON.stringify(sender) };
  const input = { face: 'hearts', message: 'Exact full message...\n🌱' };
  assert.equal((await call('/v1/devices/test/messages', input, 'reader', headers)).status, 401);
  assert.equal((await call('/v1/devices/test/messages', input, 'writer', { 'X-Pebble-Sender': '{"ip":"192.0.2.1"}' })).status, 400);
  const before = Date.now();
  assert.equal((await call('/v1/devices/test/messages', input, 'writer', headers)).status, 202);
  rows = await inspect();
  assert.equal(rows.length, 2);
  const saved = rows[1];
  assert.equal(saved.message, input.message);
  assert.deepEqual(JSON.parse(saved.sender), sender);
  assert.ok(Date.parse(saved.received_at) >= before && Date.parse(saved.received_at) <= Date.now());
  assert.equal(saved.delivered_at, null);
  assert.equal(saved.delivered, 0);
  // An operator read must not promote the queue; device reads never reveal sender metadata.
  assert.equal((await call('/v1/devices/test/display')).status, 404);
  const display = await (await call('/v1/devices/test/display', undefined, 'reader')).json();
  assert.equal(display.message, input.message);
  for (const key of ['sender', 'received_at', 'delivered_at', 'fingerprint']) assert.equal(key in display, false);
  assert.equal((await call('/v1/devices/test/display/ack', { revision: display.revision + 1 }, 'reader')).status, 409);
  assert.equal((await inspect())[1].delivered_at, null);
  assert.equal((await call('/v1/devices/test/display/ack', { revision: display.revision }, 'reader')).status, 204);
  const deliveredAt = (await inspect())[1].delivered_at;
  assert.ok(Date.parse(deliveredAt) >= Date.parse(saved.received_at));
  assert.equal((await call('/v1/devices/test/display/ack', { revision: display.revision }, 'reader')).status, 204);
  assert.equal((await inspect())[1].delivered_at, deliveredAt);
  await mf.dispose(); mf = start();
  rows = await inspect();
  assert.equal(rows[1].received_at, saved.received_at);
  assert.equal(rows[1].delivered_at, deliveredAt);
  assert.equal(rows[1].sender, saved.sender);
  // Metadata is pruned with the bounded delivered archive; it has no separate shadow history.
  for (let i = 0; i < 65; i++) {
    assert.equal((await call('/v1/devices/test/messages', { face: 'hearts', message: `Retention ${i}` })).status, 202);
    const frame = await (await call('/v1/devices/test/display', undefined, 'reader')).json();
    assert.equal((await call('/v1/devices/test/display/ack', { revision: frame.revision }, 'reader')).status, 204);
  }
  rows = await inspect();
  assert.equal(rows.length, 64);
  assert.ok(rows.every(row => row.delivered === 1 && row.delivered_at && row.received_at && row.sender === null));
  assert.ok(!rows.some(row => row.id === saved.id));
  console.log('Message storage checks passed: legacy migration, timestamps, metadata boundaries, ACKs, restart, retention.');
} finally {
  await mf?.dispose();
  await rm(dir, { recursive: true, force: true });
}
