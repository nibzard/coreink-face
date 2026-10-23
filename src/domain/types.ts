export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type State = Record<string, Json>;
export interface Face { id: string; name: string; description: string }
export interface Selection { face: string; confidence?: number }
/** Implement this port to integrate any classifier or your own application rules. */
export interface FaceChooser {
  readonly name: string;
  choose(state: State, faces: readonly Face[]): Promise<Selection>;
}
export interface DisplayState {
  face: string;
  changedAt: string;
}
export interface FaceDecision extends DisplayState {
  candidate: string;
  source: string;
  confidence?: number;
  reason: 'selected' | 'unchanged' | 'minimum-hold' | 'low-confidence' | 'provider-unavailable';
  decidedAt: string;
}
