/** Request header that carries the per-request nonce from the proxy to the layout. */
export const NONCE_HEADER = 'x-nonce';

/** The origins avatars are loaded from (CLAUDE.md §10.8: avatars only from GitHub). */
const AVATAR_ORIGIN = 'https://avatars.githubusercontent.com';

export type CspOptions = {
  nonce: string;
  /** `NEXT_PUBLIC_SUPABASE_URL`: the browser talks to it for auth and Realtime. */
  supabaseUrl: string;
  /** Next's development server evaluates code and reloads over a websocket. */
  development: boolean;
};

/** The Realtime endpoint of a Supabase URL: the same host over `ws:` or `wss:`. */
function realtimeOrigin(url: URL): string {
  return `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}`;
}

/**
 * The Content-Security-Policy of every page (CLAUDE.md §5.10): scripts only from our origin or with
 * this request's nonce (`strict-dynamic` lets those load the chunks they need), connections only to
 * our origin and Supabase, images from our origin, GitHub avatars and data URIs, no framing, no
 * plugins, forms and base URLs only to our origin. Styles allow inline attributes, which React,
 * Radix and the companions set for sizes and positions; no style can run script.
 */
export function contentSecurityPolicy({ nonce, supabaseUrl, development }: CspOptions): string {
  const supabase = new URL(supabaseUrl);
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(development ? ["'unsafe-eval'"] : [])],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", AVATAR_ORIGIN, 'data:', 'blob:'],
    'font-src': ["'self'"],
    'connect-src': ["'self'", supabase.origin, realtimeOrigin(supabase), ...(development ? ['ws:'] : [])],
    'frame-ancestors': ["'none'"],
    'form-action': ["'self'"],
    'base-uri': ["'self'"],
    'object-src': ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ');
}

/** A fresh nonce: 128 random bits, base64. */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
