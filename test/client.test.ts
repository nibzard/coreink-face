import { it, expect } from 'vitest';
import { createClient, FaceApiError } from '../src/client/index.js';
import { createFace } from '../src/index.js';
const frame = await createFace().render({ face: 'hearts', message: 'Hello!' });
it('uses the shared input and frame shape for stateless and persisted rendering', async () => {
  const calls: string[] = [];
  const api = createClient({ baseUrl: 'https://example.com/', token: 'test', fetch: async (url, init) => {
    calls.push(String(url));
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test');
    expect(JSON.parse(init?.body as string)).toEqual({ face: 'hearts', message: 'Hello!' });
    return Response.json({ ...frame, revision: 1, nextPollSeconds: 60 });
  } });
  expect(await api.render({ face: 'hearts', message: 'Hello!' })).toEqual(frame);
  expect((await api.device('pebble').update({ face: 'hearts', message: 'Hello!' })).face).toBe('hearts');
  expect(calls).toEqual(['https://example.com/v1/render', 'https://example.com/v1/devices/pebble/display']);
});
it('supports opaque ETags and discriminated 304 responses', async () => {
  const api = createClient({ baseUrl: 'https://example.com', token: 'test', fetch: async (_url, init) => {
    if (new Headers(init?.headers).has('If-None-Match')) return new Response(null, { status: 304, headers: { ETag: 'W/"display-v2-1"' } });
    return Response.json({ ...frame, revision: 1, nextPollSeconds: 60 }, { headers: { ETag: 'W/"display-v2-1"' } });
  } });
  const first = await api.device('pebble').read();
  expect(first.status).toBe('modified');
  expect(await api.device('pebble').read({ etag: first.etag! })).toEqual({ status: 'not-modified', etag: first.etag });
});
it('exposes recovery details without retrying writes', async () => {
  let calls = 0;
  const api = createClient({ baseUrl: 'https://example.com', token: 'test', fetch: async () => { calls++; return Response.json({ error: 'superseded', message: 'Read current state.', requestId: 'request-1', retryable: false }, { status: 409 }); } });
  await expect(api.device('pebble').update({ message: 'Hello' })).rejects.toMatchObject({ name: 'FaceApiError', status: 409, code: 'superseded', requestId: 'request-1', retryable: false });
  expect(calls).toBe(1);
});
it('validates responses and rejects unsafe configuration or device IDs', async () => {
  const api = createClient({ baseUrl: 'https://example.com', token: 'test', fetch: async () => Response.json({ face: 'hearts' }) });
  await expect(api.render({ face: 'hearts' })).rejects.toBeInstanceOf(FaceApiError);
  expect(() => api.device('../other')).toThrow();
  expect(() => createClient({ baseUrl: 'https://user:pass@example.com', token: 'test' })).toThrow();
});
