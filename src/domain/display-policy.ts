import type { DisplayState, FaceDecision } from './types.js';
/** Apply a completed classification to the current display without performing I/O. */
export function applyDisplayPolicy(
  decision: FaceDecision, previous: DisplayState | undefined, minimumHoldMs: number, now: Date,
): FaceDecision {
  let { face, reason } = decision;
  const validPrevious = previous && Number.isFinite(Date.parse(previous.changedAt)) &&
    Date.parse(previous.changedAt) <= now.getTime() ? previous : undefined;
  if (reason === 'low-confidence' || reason === 'provider-unavailable') {
    face = validPrevious?.face ?? face;
  } else if (validPrevious?.face === decision.candidate) {
    face = validPrevious.face;
    reason = 'unchanged';
  } else if (validPrevious && now.getTime() - Date.parse(validPrevious.changedAt) < minimumHoldMs) {
    face = validPrevious.face;
    reason = 'minimum-hold';
  }
  return {
    ...decision, face, reason,
    changedAt: validPrevious?.face === face ? validPrevious.changedAt : now.toISOString(),
  };
}
