import { FaceError } from '../domain/errors.js';
import { parseInput } from '../domain/input.js';
import { toFrame, toDecision } from '../domain/frame.js';
import { openapi } from '../openapi.js';
import { agentGuide } from '../agent-guide.js';
import { faces } from '../domain/catalog.js';
import { BodyTooLarge, readJson } from '../adapters/bounded-json.js';
import { renderer, type AppEnv } from './config.js';
export { Device } from './device.js';
const errorMessages: Record<string, string> = {
  not_found: 'Route not found. See /openapi.json for available operations.',
  method_not_allowed: 'Use an HTTP method listed in the Allow header.',
  invalid_json: 'Send a valid UTF-8 JSON object.',
  body_too_large: 'Reduce the request to at most 16384 bytes.',
  expected_application_json: 'Set Content-Type: application/json.',
  invalid_provider_configuration: 'Set FACE_PROVIDER to auto, rules, or jev on the server.',
  provider_not_configured: 'Configure TYPESAFE_API_KEY on the server or submit an explicit face.',
  internal_error: 'The server could not complete the request. Read the device before retrying a write.',
};
const json = (data: unknown, status = 200, extra: HeadersInit = {}) => Response.json(status >= 400 && typeof data === 'object' && data !== null ? { requestId: crypto.randomUUID(), retryable: status >= 500, ...('error' in data ? { message: errorMessages[String(data.error)] } : {}), ...data } : data, {
  status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra },
});
async function authorized(request: Request, expected?: string): Promise<boolean> {
  if (!expected) return false;
  const provided = request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1] ?? '';
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([provided, expected].map(value => crypto.subtle.digest('SHA-256', encoder.encode(value))));
  return crypto.subtle.timingSafeEqual(a!, b!);
}
async function route(request: Request, env: AppEnv): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === '/openapi.json' && request.method === 'GET') return json(openapi);
  if (path === '/llms.txt' && request.method === 'GET') return new Response(agentGuide, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  if (path === '/health' && request.method === 'GET') return json({ status: 'ok', service: 'coreink-face-api', version: 1 });
  if (path === '/' && request.method === 'GET') return json({
    service: 'coreink-face-api', openapi: '/openapi.json', agents: '/llms.txt', endpoints: ['POST /v1/devices/:id/messages', 'POST /v1/devices/:id/display/ack', 'POST /v1/render', 'PUT /v1/devices/:id/display', 'GET /v1/devices/:id/display', 'GET /health', 'GET /v1/faces', 'POST /v1/decide', 'PUT /v1/devices/:id/state', 'GET /v1/devices/:id/face'],
  });
  const device = path.match(/^\/v1\/devices\/([a-zA-Z0-9_-]{1,64})\/(state|face|display|messages|display\/ack)$/);
  const isAck = request.method === 'POST' && device?.[2] === 'display/ack';
  const isEnqueue = request.method === 'POST' && device?.[2] === 'messages';
  const isRead = request.method === 'GET' && (path === '/v1/faces' || (device?.[2] === 'face' || device?.[2] === 'display'));
  const isWrite = isEnqueue || ((path === '/v1/decide' || path === '/v1/render') && request.method === 'POST') || ((device?.[2] === 'state' || device?.[2] === 'display') && request.method === 'PUT');
  if (!isRead && !isWrite && !isAck) {
    const allowed = path === '/v1/faces' ? 'GET' : ['/v1/render', '/v1/decide'].includes(path) ? 'POST' : device ? device[2] === 'messages' || device[2] === 'display/ack' ? 'POST' : device[2] === 'display' ? 'GET, PUT' : device[2] === 'state' ? 'PUT' : 'GET' : null;
    return allowed ? json({ error: 'method_not_allowed' }, 405, { Allow: allowed }) : json({ error: 'not_found' }, 404);
  }
  const isAdmin = await authorized(request, env.API_TOKEN);
  if (!isAdmin && !((isRead || isAck) && await authorized(request, env.DEVICE_TOKEN))) return json({ error: 'unauthorized', message: 'Send Authorization: Bearer <token>. Writes require the writer token.' }, 401);
  if (path === '/v1/faces') return json({ faces });
  if (isRead && device) {
    const stub = env.DEVICES.getByName(device[1]!);
    const snapshot = !isAdmin && device[2] === 'display' ? await stub.readForDevice() : await stub.read();
    if (!snapshot) return json({ error: 'device_not_initialized', message: 'Publish a display with PUT before polling this device.' }, 404);
    const etag = `"display-v3-${snapshot.revision}-${snapshot.requiresAck ? 1 : 0}"`;
    const unchanged = request.headers.get('If-None-Match')?.split(',').some(value =>
      value.trim() === '*' || value.trim().replace(/^W\//, '') === etag);
    if (unchanged) return new Response(null, { status: 304, headers: { ETag: etag, 'Cache-Control': 'no-store' } });
    return json(device[2] === 'display' ? { ...toFrame(snapshot.decision, snapshot.message), revision: snapshot.revision, nextPollSeconds: snapshot.nextPollSeconds, requiresAck: snapshot.requiresAck } : snapshot, 200, { ETag: etag });
  }
  if (!request.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase().match(/^application\/json$/)) return json({ error: 'expected_application_json' }, 415);
  let raw: unknown;
  try { raw = await readJson(request.body, 16 * 1024); }
  catch (error) {
    return json({ error: error instanceof BodyTooLarge ? 'body_too_large' : 'invalid_json' }, error instanceof BodyTooLarge ? 413 : 400);
  }
  if (isAck) {
    if (!raw || typeof raw !== 'object' || Object.keys(raw).length !== 1 || !('revision' in raw) || !Number.isSafeInteger(raw.revision) || Number(raw.revision) < 0)
      return json({error:'invalid_acknowledgement'},400);
    const ok = await env.DEVICES.getByName(device![1]!).acknowledge(Number(raw.revision));
    return ok ? new Response(null,{status:204,headers:{'Cache-Control':'no-store'}}) : json({error:'stale_revision'},409);
  }
  let input;
  try { input = parseInput(raw); }
  catch (error) {
    if (error instanceof FaceError) return json({ error: error.code, message: error.message, issues: error.issues }, error.code === 'input_too_large' ? 413 : 400);
    throw error;
  }
  if (input.face !== undefined && !faces.some(face => face.id === input.face)) return json({ error: 'unknown_face', message: 'Choose an ID from GET /v1/faces.', issues: [{ path: '/face', message: 'Unknown face ID.' }] }, 400);

  if (input.face === undefined && !['auto', 'rules', 'jev'].includes(env.FACE_PROVIDER)) return json({ error: 'invalid_provider_configuration', retryable: false }, 503);
  if (input.face === undefined && env.FACE_PROVIDER === 'jev' && !env.TYPESAFE_API_KEY) return json({ error: 'provider_not_configured', retryable: false }, 503);
  if (isEnqueue) {
    const queued = await env.DEVICES.getByName(device![1]!).enqueue(input);
    return queued ? json({queued:true,id:queued.id},202) : json({error:'inbox_full',message:'The inbox is full. Please try again later.',retryable:true},503);
  }
  if (path === '/v1/decide' || path === '/v1/render') {
    const frame = await renderer(input.face === undefined ? env : { ...env, FACE_PROVIDER: 'rules' }).render(input);
    return json(path === '/v1/render' ? frame : { ...toDecision(frame), message: frame.message });
  }
  const snapshot = await env.DEVICES.getByName(device![1]!).update(input);
  if (snapshot && 'error' in snapshot) return json({ error: snapshot.error, message: 'Wait for queued messages to be acknowledged before updating the display.', retryable: false }, 409);
  if (!snapshot) return json({ error: 'superseded', message: 'A newer state update took precedence.' }, 409);
  return json(device![2] === 'display' ? { ...toFrame(snapshot.decision, snapshot.message), revision: snapshot.revision, nextPollSeconds: snapshot.nextPollSeconds, requiresAck: snapshot.requiresAck } : snapshot, 200, { ETag: `"display-v3-${snapshot.revision}-${snapshot.requiresAck ? 1 : 0}"` });
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
