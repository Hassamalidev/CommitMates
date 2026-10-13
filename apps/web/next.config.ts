import path from 'node:path';

import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';

// One .env.local at the repository root serves the web app, the worker and the scripts.
// Next has already loaded apps/web/.env* by now, so the reload has to be forced.
loadEnvConfig(path.resolve(import.meta.dirname, '../..'), process.env.NODE_ENV !== 'production', console, true);

/** Headers sent with every response (CLAUDE.md §5.10). The CSP with nonces is added with auth in Phase 1. */
const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'X-Frame-Options', value: 'DENY' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Internal packages ship TypeScript source; Next compiles them with the app.
  transpilePackages: [
    '@commitmates/algorithms',
    '@commitmates/core',
    '@commitmates/db',
    '@commitmates/email',
    '@commitmates/env',
    '@commitmates/github',
    '@commitmates/jobs',
    '@commitmates/sources',
    '@commitmates/ui',
  ],
  images: {
    // No sharp (LGPL libvips, CLAUDE.md §2.2): avatars are requested from GitHub at display size.
    unoptimized: true,
    remotePatterns: [{ protocol: 'https', hostname: 'avatars.githubusercontent.com' }],
  },
  headers() {
    return Promise.resolve([{ source: '/:path*', headers: securityHeaders }]);
  },
};

export default nextConfig;
