import pino, { type Logger as PinoLogger } from 'pino';

export type Logger = PinoLogger;

/** Fields that must never reach the logs (CLAUDE.md §5.13). */
const REDACTED_PATHS = [
  'token',
  'accessToken',
  'providerToken',
  'authorization',
  'password',
  'secret',
  'email',
  'code',
  'otp',
  'body',
  'ip',
  '*.token',
  '*.accessToken',
  '*.authorization',
  '*.password',
  '*.secret',
  '*.email',
  '*.otp',
  '*.ip',
  'headers.authorization',
  'headers.cookie',
  'headers["x-tick-secret"]',
];

let root: Logger | undefined;

/** The process-wide JSON logger. The level comes from `LOG_LEVEL`. */
export function getLogger(): Logger {
  root ??= pino({
    level: process.env.LOG_LEVEL ?? 'info',
    redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    base: null,
  });
  return root;
}

/** Replaces the process-wide logger; used by tests to capture or silence output. */
export function setLogger(logger: Logger | undefined): void {
  root = logger;
}
