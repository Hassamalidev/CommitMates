import { AppError, ExternalServiceError, ForbiddenError, NotFoundError, RateLimitError, ValidationError } from '@commitmates/db';

/** 404: the user, repository or resource does not exist (or is private). Not retried. */
export class GitHubNotFoundError extends NotFoundError {
  constructor(what: string, options?: { cause?: unknown }) {
    super('github.not_found', `We couldn't find ${what} on GitHub. Check the spelling?`, options);
  }
}

/** 401: the token is missing, expired or revoked. Not retried; members are asked to sign in again. */
export class GitHubAuthError extends AppError {
  constructor(options?: { cause?: unknown }) {
    super('github.auth', 'Your GitHub sign-in has expired. Please sign in again.', 401, options); // allowed-literal: HTTP status
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
  constructor(detail: string, options?: { cause?: unknown }) {
    super('github.server', 'GitHub is having trouble right now. We will try again shortly.', options);
    this.message = `github.server: ${detail}`;
  }
}

export { RateLimitError };
