import { FaceError } from '../domain/errors.js';
import { applyDisplayPolicy } from '../domain/display-policy.js';
import type { Face, FaceChooser, FaceDecision, DisplayState, State } from '../domain/types.js';
export interface EngineOptions {
  faces: readonly Face[];
  chooser: FaceChooser;
  fallbackFace: string;
  minimumHoldMs?: number;
  minimumConfidence?: number;
  now?: () => Date;
  failureMode?: 'fallback' | 'throw';
}
/** Domain-neutral application service. Has no storage, networking, or platform dependencies. */
export function createFaceEngine(options: EngineOptions) {
  const { chooser, fallbackFace } = options;
  const faces = options.faces.map(face => ({ ...face }));
  const ids = new Set(faces.map(face => face.id));
  if (!faces.length || faces.some(face => typeof face.id !== 'string' || typeof face.name !== 'string' || typeof face.description !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(face.id) || !face.name || !face.description) || ids.size !== faces.length || !ids.has(fallbackFace)) {
    throw new FaceError('invalid_configuration', 'Catalog must contain unique valid IDs, names, descriptions, and the fallback face.');
  }
  if (options.failureMode !== undefined && !['fallback', 'throw'].includes(options.failureMode)) throw new FaceError('invalid_configuration', 'failureMode must be fallback or throw.');
  const hold = options.minimumHoldMs ?? 15_000;
  const threshold = options.minimumConfidence ?? 0.4;
  if (!Number.isFinite(hold) || hold < 0 || !Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new FaceError('invalid_configuration', 'Hold must be nonnegative and confidence must be between 0 and 1.');
  }
  return {
    async decide(state: State, previous?: DisplayState, request: { signal?: AbortSignal } = {}): Promise<FaceDecision> {
      request.signal?.throwIfAborted();
      let candidate = fallbackFace;
      let confidence: number | undefined;
      let reason: FaceDecision['reason'] = 'selected';
      try {
        const selection = await chooser.choose(state, faces, request);
        request.signal?.throwIfAborted();
        if (!ids.has(selection.face) || (selection.confidence !== undefined &&
          (!Number.isFinite(selection.confidence) || selection.confidence < 0 || selection.confidence > 1))) {
          throw new FaceError('invalid_selection', 'Chooser returned an unknown face or invalid confidence.');
        }
        candidate = selection.face;
        confidence = selection.confidence;
        if (confidence !== undefined && confidence < threshold) reason = 'low-confidence';
      } catch (error) {
        request.signal?.throwIfAborted();
        if (options.failureMode === 'throw') throw error instanceof FaceError ? error : new FaceError('provider_unavailable', 'The face provider could not complete the request.', [], true, { cause: error });
        reason = 'provider-unavailable';
      }
      const now = (options.now ?? (() => new Date()))();
      const decidedAt = now.toISOString();
      const validPrevious = previous && ids.has(previous.face) ? previous : undefined;
      return applyDisplayPolicy({
        face: reason === 'selected' ? candidate : fallbackFace,
        candidate, source: chooser.name, reason, decidedAt, changedAt: decidedAt,
        ...(confidence === undefined ? {} : { confidence }),
      }, validPrevious, hold, now);
    },
  };
}
