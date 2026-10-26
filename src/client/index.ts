import { FaceError } from '../domain/errors.js';
import { isRecord, parseInput, type RenderInput } from '../domain/input.js';
import type { DeviceDisplay, FaceFrame } from '../domain/frame.js';
import type { Face, FaceDecision } from '../domain/types.js';
import { readJson } from '../adapters/bounded-json.js';
export class FaceApiError extends FaceError {
  override readonly name = 'FaceApiError';
  constructor(readonly status: number, code: string, message: string, readonly requestId?: string, retryable = false, issues: FaceError['issues'] = []) {
    super(code, message, issues, retryable);
  }
}
export interface ClientOptions {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}
export interface RequestOptions { signal?: AbortSignal }
export type ReadDisplayResult =
  | { status: 'modified'; display: DeviceDisplay; etag: string | null }
  | { status: 'not-modified'; etag: string | null };
const invalidResponse = () => new FaceApiError(502, 'invalid_response', 'The server returned an invalid response.');
function frame(value: unknown): FaceFrame {
  if (!isRecord(value) || typeof value.face !== 'string' || typeof value.message !== 'string' ||
    typeof value.changedAt !== 'string' || !Number.isFinite(Date.parse(value.changedAt)) ||
    typeof value.decidedAt !== 'string' || !Number.isFinite(Date.parse(value.decidedAt)) ||
    !isRecord(value.selection) || typeof value.selection.candidate !== 'string' || typeof value.selection.source !== 'string' ||
    !['selected', 'unchanged', 'minimum-hold', 'low-confidence', 'provider-unavailable'].includes(String(value.selection.reason)) ||
    (value.selection.confidence !== undefined && (typeof value.selection.confidence !== 'number' || value.selection.confidence < 0 || value.selection.confidence > 1))) throw invalidResponse();
  return {
    face: value.face, message: value.message, changedAt: value.changedAt, decidedAt: value.decidedAt,
    selection: { candidate: value.selection.candidate, source: value.selection.source,
      reason: value.selection.reason as FaceDecision['reason'],
      ...(typeof value.selection.confidence === 'number' ? { confidence: value.selection.confidence } : {}),
    },
  };
}
function display(value: unknown): DeviceDisplay {
  const parsed = frame(value);
  if (!isRecord(value) || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0 || typeof value.nextPollSeconds !== 'number' || !Number.isFinite(value.nextPollSeconds) || value.nextPollSeconds <= 0 || (value.requiresAck !== undefined && typeof value.requiresAck !== 'boolean')) throw invalidResponse();
  return { ...parsed, revision: Number(value.revision), nextPollSeconds: value.nextPollSeconds, requiresAck: value.requiresAck === true };
}
/** Fetch-based client. Never retries writes or reads environment variables. */
export function createClient(options: ClientOptions) {
  let base: URL;
  try { base = new URL(options.baseUrl); } catch { throw new FaceError('invalid_configuration', 'baseUrl must be an absolute HTTP(S) URL.'); }
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new FaceError('invalid_configuration', 'baseUrl must be HTTP(S), without credentials, a query, or a fragment.');
  if (typeof options.token !== 'string' || !options.token.trim()) throw new FaceError('invalid_configuration', 'A writer or reader token is required.');
  if (options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0)) throw new FaceError('invalid_configuration', 'timeoutMs must be a positive integer.');
  const root = base.href.replace(/\/$/, '');
  async function request(path: string, method: string, body: unknown, opts: RequestOptions = {}, etag?: string) {
    opts.signal?.throwIfAborted();
    const signal = AbortSignal.any([AbortSignal.timeout(options.timeoutMs ?? 10_000), ...(opts.signal ? [opts.signal] : [])]);
    let response: Response;
    try {
      response = await (options.fetch ?? globalThis.fetch)(root + path, {
        method, signal, redirect: 'error',
        headers: { Authorization: `Bearer ${options.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(etag ? { 'If-None-Match': etag } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      opts.signal?.throwIfAborted();
      throw new FaceError(signal.aborted ? 'timeout' : 'network_error', signal.aborted ? 'Request timed out. Read the device before retrying a write; it may have completed.' : 'Could not reach the face API. Check the base URL and connection.', [], true, { cause: error });
    }
    if (response.status === 304 && method === 'GET' && etag) return { response, body: null };
    if (response.status === 204 && method === 'POST' && path.endsWith('/display/ack')) return { response, body: null };
    let payload: unknown;
    try { payload = await readJson(response.body, 128 * 1024); }
    catch {
      opts.signal?.throwIfAborted();
      if (signal.aborted) throw new FaceError('timeout', 'Response timed out. Read the device before retrying a write.', [], true);
      throw invalidResponse();
    }
    if (!response.ok) {
      const error = isRecord(payload) ? payload : {};
      const issues = Array.isArray(error.issues) ? error.issues.filter((issue): issue is {path: string; message: string} => isRecord(issue) && typeof issue.path === 'string' && typeof issue.message === 'string') : [];
      throw new FaceApiError(response.status, typeof error.error === 'string' ? error.error : 'http_error', typeof error.message === 'string' ? error.message : `HTTP ${response.status}`, typeof error.requestId === 'string' ? error.requestId : undefined, error.retryable === true, issues);
    }
    return { response, body: payload };
  }
  return {
    async faces(opts?: RequestOptions): Promise<readonly Face[]> {
      const { body } = await request('/v1/faces', 'GET', undefined, opts);
      if (!isRecord(body) || !Array.isArray(body.faces) || !body.faces.every(f => isRecord(f) && typeof f.id === 'string' && typeof f.name === 'string' && typeof f.description === 'string')) throw invalidResponse();
      return body.faces;
    },
    async render<Context extends object>(input: RenderInput<string, Context>, opts?: RequestOptions): Promise<FaceFrame> {
      return frame((await request('/v1/render', 'POST', parseInput(input), opts)).body);
    },
    device(id: string) {
      if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw new FaceError('invalid_device_id', 'Device IDs must contain 1–64 letters, numbers, underscores, or hyphens.');
      const path = `/v1/devices/${id}/display`;
      return {
        async acknowledge(revision: number, opts?: RequestOptions): Promise<void> {
          if (!Number.isSafeInteger(revision) || revision < 0) throw new FaceError('invalid_acknowledgement', 'Revision must be a nonnegative safe integer.');
          const result = await request(path + '/ack', 'POST', { revision }, opts);
          if (result.response.status !== 204) throw invalidResponse();
        },
        async update<Context extends object>(input: RenderInput<string, Context>, opts?: RequestOptions): Promise<DeviceDisplay> {
          return display((await request(path, 'PUT', parseInput(input), opts)).body);
        },
        async read(opts: RequestOptions & { etag?: string } = {}): Promise<ReadDisplayResult> {
          const result = await request(path, 'GET', undefined, opts, opts.etag);
          const etag = result.response.headers.get('ETag');
          return result.response.status === 304 ? { status: 'not-modified', etag } : { status: 'modified', display: display(result.body), etag };
        },
      };
    },
  };
}
