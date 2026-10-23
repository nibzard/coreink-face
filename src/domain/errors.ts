export interface InputIssue { path: string; message: string }
/** Stable error codes are intended for application logic and agent recovery. */
export class FaceError extends Error {
  readonly name: string = 'FaceError';
  constructor(
    readonly code: string,
    message: string,
    readonly issues: readonly InputIssue[] = [],
    readonly retryable = false,
    options?: ErrorOptions,
  ) { super(message, options); }
}
