import { SaveError } from '../engine/saves/codec';
import { DataValidationError } from '../engine/data/issues';
import { ActionError } from '../systems/actions';
import { EventError } from '../systems/events';
import type { SerializedError } from './protocol';

/** Errors cross the worker boundary as plain data (see sim-error.ts for the page-side class). */

export function serializeError(error: unknown): SerializedError {
  if (error instanceof DataValidationError) {
    return { name: error.name, message: error.message, issues: [...error.issues] };
  }
  if (error instanceof SaveError) {
    return { name: error.name, message: error.message, code: error.code };
  }
  if (error instanceof ActionError || error instanceof EventError) {
    return { name: error.name, message: error.message };
  }
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { name: 'Error', message: String(error) };
}
