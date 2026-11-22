import type { SaturdayErrorDetail } from './types';

function safeDetail(status: number, error: SaturdayErrorDetail): SaturdayErrorDetail {
  if (error === null || typeof error !== 'object' || Array.isArray(error) || typeof (error as { message?: unknown }).message !== 'string') {
    return { type: 'api_error', code: 'unknown', message: `HTTP ${status}` };
  }
  return {
    ...error,
    type: typeof error.type === 'string' ? error.type : 'api_error',
    code: typeof error.code === 'string' ? error.code : 'unknown',
    message: error.message,
  };
}

/**
 * Base class for every API error. `error` is the API's error object: `type`, `code`, `message`
 * and, when set, `param`, `documentation_url` and `request_id`.
 */
export class SaturdayError extends Error {
  /** HTTP status. 0 for a timeout (`code` `timeout`) or a request that got no answer (`connection_error`). */
  readonly status: number;
  readonly error: SaturdayErrorDetail;
  /** Quote this when you contact Saturday about a request. */
  readonly requestId?: string;
  /** Seconds to wait, from the `Retry-After` header, when the response carried one (429s, and 503s). */
  readonly retryAfter?: number;

  constructor(status: number, error: SaturdayErrorDetail, retryAfter?: number) {
    super(safeDetail(status, error).message);
    this.name = 'SaturdayError';
    this.status = status;
    this.error = safeDetail(status, error);
    this.requestId = this.error.request_id;
    this.retryAfter = retryAfter;
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

/**
 * 403: the key cannot use this feature or resource. Read `code`: `feature_alpha` (a feature not yet
 * open to your key), `plan_inactive` (the paid Saturday plan this key comes with has ended; the key
 * works again, with its athletes, once the plan is active), `resource_limit_exceeded` (the key's
 * athletes are at their limit; write to api@saturday.fit to raise it).
 */
export class PermissionError extends SaturdayError {
  constructor(error: SaturdayErrorDetail) {
    super(403, error);
    this.name = 'PermissionError';
  }
}

/**
 * The 429 codes that reset at UTC midnight. Nothing they refuse succeeds before then.
 * `simulated_subscriber_daily_limit_reached` is the test environment's: the key has marked its
 * day's allowance of athletes with `testing.simulateSubscription`.
 */
export const DAILY_LIMIT_CODES = [
  'daily_call_limit_reached',
  'intelligence_daily_limit_reached',
  'athlete_free_daily_limit_reached',
  'distinct_lookup_daily_limit_reached',
  'simulated_subscriber_daily_limit_reached',
] as const;
export type DailyLimitCode = typeof DAILY_LIMIT_CODES[number];

/** The codes a 429 carries. */
export type RateLimitCode = 'rate_limit_exceeded' | 'catalog_paced' | 'rate_limited' | DailyLimitCode;

/** The longest wait the client sleeps through inside one call, in seconds. */
export const MAX_RETRY_WAIT_SECONDS = 30;

/**
 * 429. Read `code`:
 * - `rate_limit_exceeded`: a short-term throttle. The client waits `retryAfter` and retries.
 * - `catalog_paced`: new products are paced; `retryAfter` is the seconds until they resume. The
 *   client retries a wait of 30 seconds or less; a longer one comes back to you.
 * - `rate_limited`: an unusual request pattern; calculations are blocked for `retryAfter` seconds.
 * - `daily_call_limit_reached`, `intelligence_daily_limit_reached`,
 *   `athlete_free_daily_limit_reached`, `distinct_lookup_daily_limit_reached`, and on the test
 *   environment `simulated_subscriber_daily_limit_reached`: a daily ceiling. `dailyLimit` is true
 *   and `resetsAt` is the UTC midnight it resets at. Never retried.
 */
export class RateLimitError extends SaturdayError {
  /** True for a daily ceiling: nothing succeeds before `resetsAt`. */
  readonly dailyLimit: boolean;
  /** When a daily ceiling resets (UTC midnight). Absent for the other 429s. */
  readonly resetsAt?: Date;

  constructor(error: SaturdayErrorDetail, retryAfter?: number, now: Date = new Date()) {
    super(429, error, retryAfter);
    this.name = 'RateLimitError';
    // An API that predates the daily codes marks a daily ceiling by sending no Retry-After.
    this.dailyLimit = (DAILY_LIMIT_CODES as readonly string[]).includes(this.error.code) || retryAfter === undefined;
    if (this.dailyLimit) {
      this.resetsAt = retryAfter !== undefined
        ? new Date(now.getTime() + retryAfter * 1000)
        : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    }
  }

  /** Whether the client retries this itself: a throttle or a short pacing wait, never a daily ceiling or a block. */
  get retryable(): boolean {
    if (this.dailyLimit || this.code === 'rate_limited' || this.retryAfter === undefined) return false;
    return this.retryAfter <= MAX_RETRY_WAIT_SECONDS;
  }
}

/**
 * 400 or 422: the request is invalid. `param` names the field, as a path into your body
 * (`legs[1].duration_mins`). For code `unsupported_field` (a field the request does not take),
 * `suggestion` is the field it was probably meant to be, when there is one.
 */
export class ValidationError extends SaturdayError {
  readonly param?: string;
  /** For `unsupported_field`: the field name to send instead (`meal_before_min` for `meal_before_mins`). Absent when the API names none. */
  readonly suggestion?: string;

  constructor(error: SaturdayErrorDetail, status = 400) {
    super(status, error);
    this.name = 'ValidationError';
    this.param = this.error.param;
    this.suggestion = this.error.code === 'unsupported_field' ? suggestedField(this.error.message) : undefined;
  }
}

/** The field an `unsupported_field` message points to: `Did you mean "x"?` or `Send "x"`. */
function suggestedField(message: string | undefined): string | undefined {
  const match = /(?:Did you mean|Send) "([A-Za-z0-9_.[\]]+)"/.exec(message ?? '');
  return match?.[1];
}

/** 404: no such resource for this key, or a route this key cannot see. */
export class NotFoundError extends SaturdayError {
  constructor(error: SaturdayErrorDetail) {
    super(404, error);
    this.name = 'NotFoundError';
  }
}

/**
 * 409: the request conflicts with a record you hold. For `athlete_exists`, another of your
 * athletes holds the `external_id` you sent: nothing was created or changed, and `athleteId` names
 * that athlete.
 */
export class ConflictError extends SaturdayError {
  /** For `athlete_exists`: the athlete that holds the `external_id`. */
  readonly athleteId?: string;

  constructor(error: SaturdayErrorDetail) {
    super(409, error);
    this.name = 'ConflictError';
    this.athleteId = this.error.athlete_id;
  }
}
