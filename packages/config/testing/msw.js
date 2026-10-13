import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll } from 'vitest';

/**
 * Starts an MSW server for the current test file. Tests never reach the network:
 * a request without a handler fails the test (CLAUDE.md §11.2).
 *
 * @param {import('msw').RequestHandler[]} handlers Default handlers; add per-test ones with `server.use()`.
 */
export function createMswServer(...handlers) {
  const server = setupServer(...handlers);

  beforeAll(() => {
    server.listen({ onUnhandledRequest: 'error' });
  });
  afterEach(() => {
    server.resetHandlers();
  });
  afterAll(() => {
    server.close();
  });

  return server;
}
