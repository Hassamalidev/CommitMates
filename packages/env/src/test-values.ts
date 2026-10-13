import type { EnvSource } from './shared';

/**
 * A complete, valid environment built from the local Supabase stack's fixed development
 * defaults. Used by tests and by Playwright's web server; none of these are real secrets.
 */
export function localTestEnv(overrides: EnvSource = {}): EnvSource {
  return {
    NEXT_PUBLIC_SITE_URL: 'http://127.0.0.1:3100',
    NEXT_PUBLIC_SITE_NAME: 'CommitMates',
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'local-publishable-key',
    SUPABASE_SECRET_KEY: 'local-secret-key',
    DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    DIRECT_DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    GITHUB_SERVER_TOKEN: 'local-github-token',
    TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    TOKEN_ENCRYPTION_KEY_VERSION: '1',
    OTP_PEPPER: 'local-otp-pepper-'.padEnd(40, 'x'),
    JOB_TICK_SECRET: 'local-tick-secret-'.padEnd(64, 'x'),
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: '54325',
    EMAIL_FROM: 'CommitMates <no-reply@localhost>',
    CONTACT_EMAIL: 'dev@example.com',
    GEOCODER_BASE_URL: 'https://nominatim.openstreetmap.org',
    GEOCODER_USER_AGENT: 'CommitMates/1.0 (+http://127.0.0.1:3100; dev@example.com)',
    BOOTSTRAP_ADMIN_GITHUB_ID: '1',
    ...overrides,
  };
}
