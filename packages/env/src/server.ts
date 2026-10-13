import { z } from 'zod';

import { clientSchema } from './client';
import { base64Key, lazyEnv, parseEnv, positiveInt, secret, type EnvSource } from './shared';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

/** Variables shared by the web server and the worker. */
export const runtimeShape = {
  NEXT_PUBLIC_SITE_URL: clientSchema.shape.NEXT_PUBLIC_SITE_URL,
  NEXT_PUBLIC_SITE_NAME: clientSchema.shape.NEXT_PUBLIC_SITE_NAME,
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  DIRECT_DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  GITHUB_SERVER_TOKEN: z.string().min(1),
  TOKEN_ENCRYPTION_KEY: base64Key,
  TOKEN_ENCRYPTION_KEY_VERSION: positiveInt,
  TOKEN_ENCRYPTION_KEY_PREV: base64Key.optional(),
  OTP_PEPPER: secret,
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: positiveInt,
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASS: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(1),
  CONTACT_EMAIL: z.email(),
  GEOCODER_BASE_URL: z.url(),
  GEOCODER_USER_AGENT: z.string().min(1),
  SENTRY_DSN: z.url().optional(),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
} as const;

export const serverSchema = z.object({
  ...clientSchema.shape,
  ...runtimeShape,
  SUPABASE_SECRET_KEY: z.string().min(1),
  JOB_TICK_SECRET: secret,
  BOOTSTRAP_ADMIN_GITHUB_ID: positiveInt,
});

export type ServerEnv = z.infer<typeof serverSchema>;

/** Server variables, validated one by one on first read. Never import this from client code. */
export const serverEnv = lazyEnv('server', serverSchema, () => process.env);

/** Validates the whole server environment; call once at startup to fail fast. */
export function assertServerEnv(source: EnvSource = process.env): ServerEnv {
  return parseEnv('server', serverSchema, source);
}
