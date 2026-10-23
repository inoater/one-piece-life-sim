import type { SerializedError } from './protocol';

/**
 * The page-side form of an error that happened in the simulation. It has no imports beyond a
 * type, so the UI can use it without pulling any of the engine into the main thread.
 * (The worker-side counterpart, `serializeError`, lives in errors.ts.)
 */
export class SimError extends Error {
  readonly code: string | undefined;
  readonly issues: SerializedError['issues'];

  constructor(serialized: SerializedError) {
    super(serialized.message);
    this.name = serialized.name;
    this.code = serialized.code;
    this.issues = serialized.issues;
  }
}
