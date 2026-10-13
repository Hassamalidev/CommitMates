import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';

import { createMswServer } from './msw.js';

const server = createMswServer(
  http.get('https://api.example.test/ping', () => HttpResponse.json({ pong: true })),
);

describe('createMswServer', () => {
  it('answers requests that have a handler', async () => {
    const response = await fetch('https://api.example.test/ping');
    expect(await response.json()).toEqual({ pong: true });
  });

  it('lets a test add a handler that is reset afterwards', async () => {
    server.use(http.get('https://api.example.test/extra', () => new HttpResponse(null, { status: 204 })));
    const response = await fetch('https://api.example.test/extra');
    expect(response.status).toBe(204);
  });

  it('fails requests that have no handler', async () => {
    await expect(fetch('https://api.example.test/extra')).rejects.toThrow();
  });
});
