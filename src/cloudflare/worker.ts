import { z } from 'zod';
import { faces } from '../domain/catalog.js';
import { BodyTooLarge, readJson } from '../adapters/bounded-json.js';
import { engine, type AppEnv } from './config.js';
export { Device } from './device.js';
const inputSchema = z.object({ state: z.record(z.string(), z.json()) }).strict();
const json = (data: unknown, status = 200, extra: HeadersInit = {}) => Response.json(data, {
  status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra },
});
async function authorized(request: Request, expected?: string): Promise<boolean> {
  if (!expected) return false;
  const provided = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([provided, expected].map(value => crypto.subtle.digest('SHA-256', encoder.encode(value))));
  return crypto.subtle.timingSafeEqual(a!, b!);
}
async function route(request: Request, env: AppEnv): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === '/health' && request.method === 'GET') return json({ status: 'ok', service: 'coreink-face-api', version: 1 });
  if (path === '/' && request.method === 'GET') return json({
    service: 'coreink-face-api', endpoints: ['GET /health', 'GET /v1/faces', 'POST /v1/decide', 'PUT /v1/devices/:id/state', 'GET /v1/devices/:id/face'],
  });
  const device = path.match(/^\/v1\/devices\/([a-zA-Z0-9_-]{1,64})\/(state|face)$/);
  const isRead = request.method === 'GET' && (path === '/v1/faces' || device?.[2] === 'face');
  const isWrite = (path === '/v1/decide' && request.method === 'POST') || (device?.[2] === 'state' && request.method === 'PUT');
  if (!isRead && !isWrite) return json({ error: 'not_found' }, 404);
  const isAdmin = await authorized(request, env.API_TOKEN);
  if (!isAdmin && !(isRead && await authorized(request, env.DEVICE_TOKEN))) return json({ error: 'unauthorized' }, 401);
  if (path === '/v1/faces') return json({ faces });
  if (isRead && device) {
    const snapshot = await env.DEVICES.getByName(device[1]!).read();
    if (!snapshot) return json({ error: 'device_not_initialized' }, 404);
    const etag = `"${snapshot.revision}"`;
    const unchanged = request.headers.get('If-None-Match')?.split(',').some(value =>
      value.trim() === '*' || value.trim().replace(/^W\//, '') === etag);
    if (unchanged) return new Response(null, { status: 304, headers: { ETag: etag, 'Cache-Control': 'no-store' } });
    return json(snapshot, 200, { ETag: etag });
  }
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) return json({ error: 'expected_application_json' }, 415);
  let raw: unknown;
  try { raw = await readJson(request.body, 16 * 1024); }
  catch (error) {
    return json({ error: error instanceof BodyTooLarge ? 'body_too_large' : 'invalid_json' }, error instanceof BodyTooLarge ? 413 : 400);
  }
  const input = inputSchema.safeParse(raw);
  if (!input.success) return json({ error: 'invalid_state', message: 'Expected { state: { ...JSON fields } } with no extra top-level fields.' }, 400);
  if (!['auto', 'rules', 'jev'].includes(env.FACE_PROVIDER)) return json({ error: 'invalid_provider_configuration' }, 503);
  if (env.FACE_PROVIDER === 'jev' && !env.TYPESAFE_API_KEY) return json({ error: 'provider_not_configured' }, 503);
  if (path === '/v1/decide') return json(await engine(env).decide(input.data.state));
  const snapshot = await env.DEVICES.getByName(device![1]!).update(input.data.state);
  if (!snapshot) return json({ error: 'superseded', message: 'A newer state update took precedence.' }, 409);
  return json(snapshot);
}
export default {
  async fetch(request, env) {
    try { return await route(request, env); }
    catch {
      const requestId = crypto.randomUUID();
      // Never log user state, credentials, or provider response bodies.
      console.error(JSON.stringify({ event: 'request_failed', requestId }));
      return json({ error: 'internal_error', requestId }, 500);
    }
  },
} satisfies ExportedHandler<AppEnv>;
