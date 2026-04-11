import type { SaturdayErrorDetail } from './types';

/**
 * Base error class for all Saturday API errors. Includes the structured error
 * detail from the API response (Stripe-style format).
 */
export class SaturdayError extends Error {
  /** HTTP status code from the response. */
  readonly status: number;

  /** Stripe-style structured error detail. */
  readonly error: SaturdayErrorDetail;

  /** Unique request ID for support reference. */
  readonly requestId?: string;

  constructor(status: number, error: SaturdayErrorDetail) {
    super(error.message);
    this.name = 'SaturdayError';
    this.status = status;
    this.error = error;
    this.requestId = error.request_id;
  }
}

/** Missing or invalid API key / Bearer token. */
export class AuthenticationError extends SaturdayError {
  constructor(error: SaturdayErrorDetail) {
    super(401, error);
    this.name = 'AuthenticationError';
  }
}

/** Rate limit exceeded. Check Retry-After header. */
export class RateLimitError extends SaturdayError {
  /** Seconds to wait before retrying. */
  readonly retryAfter: number;

  constructor(error: SaturdayErrorDetail, retryAfter: number) {
    super(429, error);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

/** Request validation failed (400 or 422). */
export class ValidationError extends SaturdayError {
  /** The parameter that caused the error. */
  readonly param?: string;

  constructor(error: SaturdayErrorDetail) {
    super(400, error);
    this.name = 'ValidationError';
    this.param = error.param;
  }
}

/** Resource not found (404). */
export class NotFoundError extends SaturdayError {
  constructor(error: SaturdayErrorDetail) {
    super(404, error);
    this.name = 'NotFoundError';
  }
}
