import type { FaceDecision } from './types.js';
/** Renderer-independent content. Render face and message; selection explains the decision. */
export interface FaceFrame<Id extends string = string> {
  face: Id;
  message: string;
  changedAt: string;
  decidedAt: string;
  selection: {
    candidate: Id;
    source: string;
    reason: FaceDecision['reason'];
    confidence?: number;
  };
}
export interface DeviceDisplay extends FaceFrame {
  revision: number;
  nextPollSeconds: number;
}
export function toFrame(decision: FaceDecision, message = ''): FaceFrame {
  const { face, changedAt, decidedAt, ...selection } = decision;
  return { face, message, changedAt, decidedAt, selection };
}
export function toDecision(frame: FaceFrame): FaceDecision {
  return { face: frame.face, changedAt: frame.changedAt, decidedAt: frame.decidedAt, ...frame.selection };
}
