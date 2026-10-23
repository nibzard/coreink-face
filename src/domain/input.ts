import { FaceError, type InputIssue } from './errors.js';
import type { State } from './types.js';
export const limits = Object.freeze({ messageCodePoints: 120, inputBytes: 16_384, stateDepth: 32 });
export interface RenderInput<Id extends string = string, Context extends object = State> {
  /** Arbitrary JSON observations for the classifier. */
  state?: Context;
  /** Exact plain text to display. Omit to retain previous text; empty string clears it. */
  message?: string;
  /** Explicit choice: skips the classifier, but still respects the display hold. */
  face?: Id;
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null;
}
/** Shared by the local library, HTTP service, and HTTP client. Does not coerce input. */
export function parseInput(value: unknown): RenderInput {
  const issues: InputIssue[] = [];
  if (!isRecord(value)) throw new FaceError('invalid_input', 'Expected an object containing state, message, or face.', [{ path: '', message: 'Expected an object.' }]);
  for (const key of Object.keys(value)) if (!['state', 'message', 'face'].includes(key)) issues.push({ path: `/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`, message: 'Unknown field. Use state, message, or face.' });
  if (value.state === undefined && value.message === undefined && value.face === undefined) issues.push({ path: '', message: 'Provide state, message, or face.' });
  if (value.message !== undefined && (typeof value.message !== 'string' || [...value.message].length > limits.messageCodePoints || /[\u0000-\u0009\u000B-\u001F\u007F]/u.test(value.message))) {
    issues.push({ path: '/message', message: 'Expected plain text of at most 120 Unicode code points. Only newline control characters are allowed.' });
  }
  if (value.face !== undefined && (typeof value.face !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(value.face))) issues.push({ path: '/face', message: 'Expected a face ID: 1–64 letters, numbers, underscores, or hyphens.' });
  const seen = new Set<object>();
  function json(v: unknown, depth: number): boolean {
    if (depth > limits.stateDepth) return false;
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
    if (typeof v === 'number') return Number.isFinite(v);
    if (!Array.isArray(v) && !isRecord(v)) return false;
    if (seen.has(v)) return false;
    seen.add(v);
    const valid = Object.values(v).every(child => json(child, depth + 1));
    seen.delete(v);
    return valid;
  }
  if (value.state !== undefined && (!isRecord(value.state) || !json(value.state, 0))) issues.push({ path: '/state', message: 'Expected a JSON object with finite numbers, no cycles, and at most 32 levels of nesting.' });
  if (issues.length) throw new FaceError('invalid_input', 'Correct the indicated input fields.', issues);
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > limits.inputBytes) throw new FaceError('input_too_large', 'Input exceeds 16384 bytes. Send a smaller state.');
  return value as RenderInput;
}
