/** HTTP statuses used by the error classes below (protocol constants). */
const STATUS = {
  BAD_REQUEST: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  TOO_MANY_REQUESTS: 429,
  INTERNAL: 500,
  BAD_GATEWAY: 502,
} as const;

/**
 * Base class for every expected failure (CLAUDE.md §10.4). `code` is stable and
 * machine-readable; `userMessage` is safe to show; technical detail goes to logs via `cause`.
 */
export class AppError extends Error {
  readonly code: string;
  readonly userMessage: string;
  readonly status: number;

  constructor(code: string, userMessage: string, status: number = STATUS.BAD_REQUEST, options?: { cause?: unknown }) {
    super(code, options);
    this.name = new.target.name;
    this.code = code;
    this.userMessage = userMessage;
    this.status = status;
  }
}

export class ValidationError extends AppError {
  /** The input field the message belongs to, for inline form errors. */
  readonly field: string | undefined;

  constructor(code: string, userMessage: string, options?: { cause?: unknown; field?: string }) {
    super(code, userMessage, STATUS.BAD_REQUEST, options);
    this.field = options?.field;
  }
}

export class NotFoundError extends AppError {
  constructor(code: string, userMessage: string, options?: { cause?: unknown }) {
    super(code, userMessage, STATUS.NOT_FOUND, options);
  }
}

export class ForbiddenError extends AppError {
  constructor(code: string, userMessage: string, options?: { cause?: unknown }) {
    super(code, userMessage, STATUS.FORBIDDEN, options);
  }
}

export class ConflictError extends AppError {
  constructor(code: string, userMessage: string, options?: { cause?: unknown }) {
    super(code, userMessage, STATUS.CONFLICT, options);
  }
}

export class RateLimitedError extends AppError {
  /** Seconds until another attempt can succeed. */
  readonly retryAfterSeconds: number;

  constructor(code: string, userMessage: string, retryAfterSeconds: number, options?: { cause?: unknown }) {
    super(code, userMessage, STATUS.TOO_MANY_REQUESTS, options);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * An upstream rate limit (GitHub's, not ours) is exhausted until `resetAt`.
 * The job runner waits for it without consuming an attempt.
 */
export class RateLimitError extends AppError {
  readonly resetAt: Date;

  constructor(resetAt: Date, options?: { cause?: unknown; resource?: string }) {
    super(
      'rate_limit.upstream',
      'GitHub asked us to slow down. We will keep going as soon as it lets us.',
      STATUS.TOO_MANY_REQUESTS,
      options,
    );
    this.resetAt = resetAt;
  }
}

/** A misconfiguration on our side: unknown settings key, malformed stored value, missing handler. */
export class ConfigError extends AppError {
  constructor(code: string, detail: string, options?: { cause?: unknown }) {
    super(code, 'Something is misconfigured on our side. We have logged it.', STATUS.INTERNAL, options);
    this.message = `${code}: ${detail}`;
  }
}

/** An external service failed or answered with something unusable. Retried by the job runner. */
export class ExternalServiceError extends AppError {
  constructor(code: string, userMessage: string, options?: { cause?: unknown }) {
    super(code, userMessage, STATUS.BAD_GATEWAY, options);
  }
}
