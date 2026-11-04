import { ConfigError } from '@commitmates/db';

import type { JobHandler } from './types';

// Handlers are stored with their payload type erased; the runner validates before calling.
type AnyHandler = JobHandler<unknown>;

const handlers = new Map<string, AnyHandler>();

/**
 * Registers a handler. Registering the same object twice is a no-op, so app start-up can call it
 * freely. Two different handlers for one type are a programming error, except in development:
 * hot reloading evaluates the handler modules again and creates new objects for the same types,
 * and the newer definition must win or every edit would break job runs until a restart.
 */
export function registerHandler<P>(handler: JobHandler<P>, env: string | undefined = process.env.NODE_ENV): void {
  const existing = handlers.get(handler.type);
  if (existing && existing !== handler && env !== 'development') {
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
