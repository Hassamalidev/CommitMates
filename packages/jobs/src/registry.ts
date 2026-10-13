import { ConfigError } from '@commitmates/db';

import type { JobHandler } from './types';

// Handlers are stored with their payload type erased; the runner validates before calling.
type AnyHandler = JobHandler<unknown>;

const handlers = new Map<string, AnyHandler>();

/** Registers a handler. Registering the same object twice is a no-op, so app start-up can call it freely. */
export function registerHandler<P>(handler: JobHandler<P>): void {
  const existing = handlers.get(handler.type);
  if (existing && existing !== handler) {
    throw new ConfigError('jobs.duplicate_handler', `Job type "${handler.type}" already has a handler`);
  }
  handlers.set(handler.type, handler);
}

export function getHandler(type: string): AnyHandler | undefined {
  return handlers.get(type);
}

export function registeredJobTypes(): string[] {
  return [...handlers.keys()];
}

/** Test helper: forget every handler. */
export function clearHandlers(): void {
  handlers.clear();
}
