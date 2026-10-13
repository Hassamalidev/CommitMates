import 'server-only';

/** Formats one Server-Sent Event frame. */
export function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Streams events from an async iterator as `text/event-stream`, stopping when the client disconnects. */
export function sseResponse(
  events: (signal: AbortSignal) => AsyncIterable<{ event: string; data: unknown }>,
  request: Request,
): Response {
  const encoder = new TextEncoder();
  const controller = new AbortController();
  request.signal.addEventListener('abort', () => {
    controller.abort();
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(streamController) {
      try {
        for await (const { event, data } of events(controller.signal)) {
          streamController.enqueue(encoder.encode(sseFrame(event, data)));
        }
      } catch {
        streamController.enqueue(
          encoder.encode(sseFrame('error', { message: 'Something broke on our side. Please try again.' })),
        );
      } finally {
        streamController.close();
      }
    },
    cancel() {
      controller.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Proxies must not buffer the stream.
      'X-Accel-Buffering': 'no',
    },
  });
}
