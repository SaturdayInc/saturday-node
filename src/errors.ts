import type { SaturdayErrorDetail } from './types';

/**
 * Base class for every API error. `error` is the API's error object: `type`, `code`, `message`
 * and, when set, `param`, `documentation_url` and `request_id`.
 */
export class SaturdayError extends Error {
  /** HTTP status. 0 for a timeout. */
  readonly status: number;
  readonly error: SaturdayErrorDetail;
  /** Quote this when you contact Saturday about a request. */
  readonly requestId?: string;

  constructor(status: number, error: SaturdayErrorDetail) {
    super(error.message);
    this.name = 'SaturdayError';
    this.status = status;
    this.error = error;
    this.requestId = error.request_id;
  }

  /** The machine-readable code, such as `unsupported_field` or `athlete_not_found`. */
  get code(): string {
    return this.error.code;
  }
}

/** 401: the key or token is missing, invalid, revoked, or for the other environment. */
export class AuthenticationError extends SaturdayError {
  constructor(error: SaturdayErrorDetail) {
    super(401, error);
    this.name = 'AuthenticationError';
  }
}

/** 403: the key cannot use this feature or resource (for example `feature_alpha`). */
export class PermissionError extends SaturdayError {
  constructor(error: SaturdayErrorDetail) {
    super(403, error);
    this.name = 'PermissionError';
  }
}

/**
 * 429. A rate limit or pacing carries `retryAfter` in seconds; the client waits out one of 60
 * seconds or less itself. A daily ceiling has no `retryAfter` (`dailyLimit` is true) and resets
 * at midnight UTC.
 */
export class RateLimitError extends SaturdayError {
  /** Seconds to wait, from the `Retry-After` header. Absent for a daily ceiling. */
  readonly retryAfter?: number;
  /** True for a daily ceiling: retrying before midnight UTC cannot succeed. */
  readonly dailyLimit: boolean;

  constructor(error: SaturdayErrorDetail, retryAfter?: number) {
    super(429, error);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
    this.dailyLimit = retryAfter === undefined;
  }
}

/** 400 or 422: the request is invalid. `param` names the field. */
export class ValidationError extends SaturdayError {
  readonly param?: string;

  constructor(error: SaturdayErrorDetail, status = 400) {
    super(status, error);
    this.name = 'ValidationError';
    this.param = error.param;
  }
}

/** 404: no such resource for this key, or a route this key cannot see. */
export class NotFoundError extends SaturdayError {
  constructor(error: SaturdayErrorDetail) {
    super(404, error);
    this.name = 'NotFoundError';
  }
}
