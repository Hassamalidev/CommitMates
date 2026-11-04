import { AppError, ExternalServiceError, ForbiddenError, NotFoundError, RateLimitError, ValidationError } from '@commitmates/db';

/** 404: the user, repository or resource does not exist (or is private). Not retried. */
export class GitHubNotFoundError extends NotFoundError {
  constructor(what: string, options?: { cause?: unknown }) {
    super('github.not_found', `We couldn't find ${what} on GitHub. Check the spelling?`, options);
  }
}

/**
 * 401: the token is missing, expired or revoked. Not retried. A member whose own token failed is
 * asked to sign in again; when the site's server token fails, the visitor did nothing wrong, so
 * the message says the problem is ours.
 */
export class GitHubAuthError extends AppError {
  constructor(kind: 'user' | 'server' = 'user', options?: { cause?: unknown }) {
    super(
      kind === 'user' ? 'github.auth' : 'github.server_auth',
      kind === 'user'
        ? 'Your GitHub sign-in has expired. Please sign in again.'
        : "We can't reach GitHub from our side right now. It's not you; we've logged it and will fix it.",
      401, // allowed-literal: HTTP status
      options,
    );
  }
}

/** 403 that is not a rate limit: the token may not read this resource. Not retried. */
export class GitHubForbiddenError extends ForbiddenError {
  constructor(options?: { cause?: unknown }) {
    super('github.forbidden', "GitHub wouldn't let us read that. It may be private.", options);
  }
}

/** 422: GitHub rejected the request, e.g. an invalid search query. Not retried. */
export class GitHubValidationError extends ValidationError {
  constructor(options?: { cause?: unknown }) {
    super('github.validation', "GitHub couldn't process that request. Try different search terms.", options);
  }
}

/** 5xx, network errors, timeouts, or a response that does not match its schema. Retried with backoff. */
export class GitHubServerError extends ExternalServiceError {
  /** HTTP status GitHub answered with, when there was a response (502 and 504 mean the request timed out there). */
  readonly httpStatus: number | undefined;

  constructor(detail: string, options?: { cause?: unknown; httpStatus?: number }) {
    super('github.server', 'GitHub is having trouble right now. We will try again shortly.', options);
    this.message = `github.server: ${detail}`;
    this.httpStatus = options?.httpStatus;
  }
}

export { RateLimitError };

/**
 * Resolves to `null` when GitHub refuses to show a resource or no longer has it (a 403 that is not a
 * rate limit, or a 404). Lists of other people's repositories use it so one blocked or deleted
 * repository is skipped instead of failing the whole search; every other error passes through.
 */
export async function unlessUnreadable<T>(read: Promise<T>): Promise<T | null> {
  try {
    return await read;
  } catch (error) {
    if (error instanceof GitHubForbiddenError || error instanceof GitHubNotFoundError) return null;
    throw error;
  }
}
