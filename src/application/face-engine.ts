import { applyDisplayPolicy } from '../domain/display-policy.js';
import type { Face, FaceChooser, FaceDecision, DisplayState, State } from '../domain/types.js';
export interface EngineOptions {
  faces: readonly Face[];
  chooser: FaceChooser;
  fallbackFace: string;
  minimumHoldMs?: number;
  minimumConfidence?: number;
  now?: () => Date;
}
/** Domain-neutral application service. Has no storage, networking, or platform dependencies. */
export function createFaceEngine(options: EngineOptions) {
  const { chooser, fallbackFace } = options;
  const faces = options.faces.map(face => ({ ...face }));
  const ids = new Set(faces.map(face => face.id));
  if (!faces.length || ids.size !== faces.length || !ids.has(fallbackFace)) {
    throw new Error('Catalog must contain unique IDs and the fallback face');
  }
  const hold = options.minimumHoldMs ?? 15_000;
  const threshold = options.minimumConfidence ?? 0.4;
  if (!Number.isFinite(hold) || hold < 0 || !Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error('Invalid decision policy');
  }
  return {
    async decide(state: State, previous?: DisplayState): Promise<FaceDecision> {
      let candidate = fallbackFace;
      let confidence: number | undefined;
      let reason: FaceDecision['reason'] = 'selected';
      try {
        const selection = await chooser.choose(state, faces);
        if (!ids.has(selection.face) || (selection.confidence !== undefined &&
          (!Number.isFinite(selection.confidence) || selection.confidence < 0 || selection.confidence > 1))) {
          throw new Error('Invalid chooser output');
        }
        candidate = selection.face;
        confidence = selection.confidence;
        if (confidence !== undefined && confidence < threshold) reason = 'low-confidence';
      } catch {
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
