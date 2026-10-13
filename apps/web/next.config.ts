import type { NextConfig } from 'next';

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
    remotePatterns: [{ protocol: 'https', hostname: 'avatars.githubusercontent.com' }],
  },
  headers() {
    return Promise.resolve([{ source: '/:path*', headers: securityHeaders }]);
  },
};

export default nextConfig;
