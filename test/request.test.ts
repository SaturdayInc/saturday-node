import { Saturday } from '../src/client';
import { NotFoundError, PermissionError, RateLimitError, ValidationError } from '../src/errors';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  jest.useRealTimers();
});

it('downloads coach report bytes with the selected report options and authentication', async () => {
  const pdf = Buffer.from('%PDF-1.7\n\x00\xffreport', 'latin1');
  const fetchMock = jest.fn().mockResolvedValue(new Response(pdf, {
    headers: { 'Content-Type': 'application/pdf' },
  }));
  global.fetch = fetchMock;
  const client = new Saturday({ apiKey: 'cp_test_placeholder' });

  const result = await client.coach.reportPdf('athlete_123', { window: 14, focus: 'rolling' });

  expect(Buffer.from(result)).toEqual(pdf);
  expect(fetchMock).toHaveBeenCalledWith(
    'https://api.saturday.fit/v1/coach/athletes/athlete_123/report?format=pdf&window=14&focus=rolling',
    expect.objectContaining({
      method: 'GET',
      headers: expect.objectContaining({ Authorization: 'Bearer cp_test_placeholder' }),
    }),
  );
});

it('keeps JSON report responses as objects', async () => {
  global.fetch = jest.fn().mockResolvedValue(Response.json({ narrative: 'Report' }));
  const client = new Saturday({ apiKey: 'cp_test_placeholder' });

  await expect(client.coach.report('athlete_123')).resolves.toEqual({ narrative: 'Report' });
});

it('maps a missing PDF to the normal SDK error', async () => {
  global.fetch = jest.fn().mockResolvedValue(Response.json({
    error: { type: 'resource_not_found', code: 'resource_not_found', message: 'Not found' },
  }, { status: 404 }));
  const client = new Saturday({ apiKey: 'cp_test_placeholder' });

  await expect(client.coach.reportPdf('athlete_123')).rejects.toBeInstanceOf(NotFoundError);
});

it('retries a temporary PDF error and then returns the bytes', async () => {
  jest.useFakeTimers();
  const fetchMock = jest.fn()
    .mockResolvedValueOnce(Response.json({ error: { message: 'Try again' } }, { status: 503 }))
    .mockResolvedValueOnce(new Response('%PDF-1.7'));
  global.fetch = fetchMock;
  const client = new Saturday({ apiKey: 'cp_test_placeholder', maxRetries: 1 });

  const result = client.coach.reportPdf('athlete_123');
  await jest.advanceTimersByTimeAsync(1000);

  expect(Buffer.from(await result).toString()).toBe('%PDF-1.7');
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('honors maxRetries: 0 instead of silently making four requests', async () => {
  jest.useFakeTimers();
  const fetchMock = jest.fn().mockImplementation(async () => Response.json({
    error: { type: 'rate_limit_error', code: 'rate_limit_exceeded', message: 'Slow down' },
  }, { status: 429, headers: { 'Retry-After': '17' } }));
  global.fetch = fetchMock;
  const client = new Saturday({ apiKey: 'sk_test_fake', maxRetries: 0 });

  const error = client.onboarding.questions().catch((value: unknown) => value);
  await jest.runAllTimersAsync();

  expect(await error).toBeInstanceOf(RateLimitError);
  expect((await error as RateLimitError).retryAfter).toBe(17);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('preserves empty 204 responses', async () => {
  global.fetch = jest.fn().mockResolvedValue(new Response(null, { status: 204 }));
  const client = new Saturday({ apiKey: 'sk_test_fake' });

  await expect(client.athletes.delete('athlete_123')).resolves.toBeUndefined();
});

it('waits the Retry-After seconds on a rate limit, then retries', async () => {
  jest.useFakeTimers();
  const fetchMock = jest.fn()
    .mockResolvedValueOnce(Response.json({
      error: { type: 'rate_limit_error', code: 'rate_limit_exceeded', message: 'Rate limit exceeded. Retry after 2 seconds.' },
    }, { status: 429, headers: { 'Retry-After': '2' } }))
    .mockResolvedValueOnce(Response.json({ activity_types: [], total: 0, request_id: 'req_1' }));
  global.fetch = fetchMock;
  const client = new Saturday({ apiKey: 'sk_test_fake' });

  const result = client.reference.activityTypes();
  await jest.advanceTimersByTimeAsync(1999);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(1);
  expect((await result).total).toBe(0);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('throws a daily ceiling at once: no Retry-After, dailyLimit true, no retry', async () => {
  const fetchMock = jest.fn().mockImplementation(async () => Response.json({
    error: { type: 'rate_limit_error', code: 'rate_limit_exceeded', message: 'Daily call limit reached (2000/day). The counter resets at midnight UTC.' },
  }, { status: 429 }));
  global.fetch = fetchMock;
  const client = new Saturday({ apiKey: 'sk_test_fake' });

  const error = await client.nutrition.calculate({ activity_type: 'run', duration_min: 60 }).catch((value: unknown) => value);

  expect(error).toBeInstanceOf(RateLimitError);
  expect((error as RateLimitError).dailyLimit).toBe(true);
  expect((error as RateLimitError).retryAfter).toBeUndefined();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('maps 403 to PermissionError with the API code', async () => {
  global.fetch = jest.fn().mockResolvedValue(Response.json({
    error: { type: 'authorization_error', code: 'feature_alpha', message: 'The knowledge feature is in alpha.' },
  }, { status: 403 }));
  const client = new Saturday({ apiKey: 'sk_test_fake' });

  const error = await client.knowledge.search({ query: 'sodium' }).catch((value: unknown) => value);

  expect(error).toBeInstanceOf(PermissionError);
  expect((error as PermissionError).code).toBe('feature_alpha');
});

it('returns a Retry-After longer than a minute to the caller instead of waiting it out', async () => {
  const fetchMock = jest.fn().mockImplementation(async () => Response.json({
    error: { type: 'rate_limit_error', code: 'rate_limited', message: 'New products resume in 17 minutes.' },
  }, { status: 429, headers: { 'Retry-After': '1020' } }));
  global.fetch = fetchMock;
  const client = new Saturday({ apiKey: 'sk_test_fake' });

  const error = await client.nutrition.productFit({
    athlete_id: 'ath_1', product_query: 'maurten gel 100', activity_type: 'run', duration_min: 60,
  }).catch((value: unknown) => value);

  expect((error as RateLimitError).retryAfter).toBe(1020);
  expect((error as RateLimitError).dailyLimit).toBe(false);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('does not retry a create on a 5xx, since the server may have written it', async () => {
  const fetchMock = jest.fn().mockImplementation(async () => Response.json({ error: { message: 'Try again' } }, { status: 503 }));
  global.fetch = fetchMock;
  const client = new Saturday({ apiKey: 'sk_test_fake' });
  await expect(client.athletes.create({ external_id: 'u-1' })).rejects.toMatchObject({ status: 503 });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it.each([
  ['a calculation', (c: Saturday) => c.nutrition.calculate({ activity_type: 'run', duration_min: 60 })],
  ['an activity calculate', (c: Saturday) => c.activities.calculatePrescription('ath_1', 'act_1')],
  ['prep', (c: Saturday) => c.activities.prep('ath_1', 'act_1')],
])('still retries %s on a 5xx', async (_name, call) => {
  jest.useFakeTimers();
  const fetchMock = jest.fn()
    .mockResolvedValueOnce(Response.json({ error: { message: 'Try again' } }, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ tier: 'teaser' }));
  global.fetch = fetchMock;
  const result = call(new Saturday({ apiKey: 'sk_test_fake' }));
  await jest.advanceTimersByTimeAsync(1100);
  await expect(result).resolves.toEqual({ tier: 'teaser' });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('returns a 31-second Retry-After to the caller', async () => {
  const fetchMock = jest.fn().mockImplementation(async () => Response.json({
    error: { type: 'rate_limit_error', code: 'rate_limit_exceeded', message: 'Slow down' },
  }, { status: 429, headers: { 'Retry-After': '31' } }));
  global.fetch = fetchMock;
  const error = await new Saturday({ apiKey: 'sk_test_fake' }).onboarding.questions().catch((e: unknown) => e);
  expect((error as RateLimitError).retryAfter).toBe(31);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

describe('429 codes', () => {
  const tooMany = (code: string, headers: Record<string, string> = {}) => Response.json({
    error: { type: 'rate_limit_error', code, message: code },
  }, { status: 429, headers });

  it.each([
    'daily_call_limit_reached', 'intelligence_daily_limit_reached',
    'athlete_free_daily_limit_reached', 'distinct_lookup_daily_limit_reached',
  ])('%s is a daily limit: never retried, resetsAt is Retry-After from now', async code => {
    const fetchMock = jest.fn().mockImplementation(async () => tooMany(code, { 'Retry-After': '20' }));
    global.fetch = fetchMock;
    const before = Date.now();
    const error = await new Saturday({ apiKey: 'sk_test_fake' }).nutrition.calculate({ activity_type: 'run', duration_min: 60 })
      .catch((e: unknown) => e) as RateLimitError;
    expect(error.dailyLimit).toBe(true);
    expect(error.retryable).toBe(false);
    expect(error.resetsAt!.getTime()).toBeGreaterThanOrEqual(before + 20000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('an older daily ceiling (no Retry-After) resets at the next UTC midnight', () => {
    const error = new RateLimitError({ type: 'rate_limit_error', code: 'rate_limit_exceeded', message: 'Daily call limit reached' },
      undefined, new Date('2026-11-18T22:30:00Z'));
    expect(error.dailyLimit).toBe(true);
    expect(error.resetsAt!.toISOString()).toBe('2026-11-19T00:00:00.000Z');
  });

  it.each([
    ['rate_limit_exceeded', '2', 2],
    ['catalog_paced', '20', 2],
    ['catalog_paced', '900', 1],
    ['rate_limited', '5', 1],
  ])('%s with Retry-After %s makes %i call(s)', async (code, wait, calls) => {
    jest.useFakeTimers();
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(tooMany(code, { 'Retry-After': wait }))
      .mockResolvedValueOnce(Response.json({ activity_types: [], total: 0, request_id: 'req_1' }));
    global.fetch = fetchMock;
    const result = new Saturday({ apiKey: 'sk_test_fake' }).reference.activityTypes().catch((e: unknown) => e);
    await jest.advanceTimersByTimeAsync(Number(wait) * 1000 + 10);
    const value = await result;
    expect(fetchMock).toHaveBeenCalledTimes(calls);
    if (calls === 1) expect((value as RateLimitError).retryAfter).toBe(Number(wait));
  });

  it('waits a 503 Retry-After before retrying', async () => {
    jest.useFakeTimers();
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(Response.json({ error: { type: 'api_error', code: 'service_unavailable', message: 'Try again' } }, { status: 503, headers: { 'Retry-After': '5' } }))
      .mockResolvedValueOnce(Response.json({ activity_types: [], total: 0, request_id: 'req_1' }));
    global.fetch = fetchMock;
    const result = new Saturday({ apiKey: 'sk_test_fake' }).reference.activityTypes();
    await jest.advanceTimersByTimeAsync(4900);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(200);
    expect((await result).total).toBe(0);
  });
});

describe('unsupported_field', () => {
  const cases: [string, string, string | undefined][] = [
    ['legs[1].duration_mins', '"legs[1].duration_mins" is not a field of this request, so its value would not be used. Did you mean "duration_min"? See https://docs.saturday.fit/guides/nutrition-calculation', 'duration_min'],
    ['weight_kg', '"weight_kg" is not a field of this request, so its value would not be used. Send "athlete_weight_kg". See https://docs.saturday.fit/guides/nutrition-calculation', 'athlete_weight_kg'],
    ['zzz', '"zzz" is not a field of this request, so its value would not be used. See https://docs.saturday.fit/guides/nutrition-calculation', undefined],
  ];
  it.each(cases)('%s names the field and the suggestion', async (param, message, suggestion) => {
    global.fetch = jest.fn().mockResolvedValue(Response.json(
      { error: { type: 'invalid_request', code: 'unsupported_field', param, message } }, { status: 400 }));
    const client = new Saturday({ apiKey: 'cp_test_placeholder', maxRetries: 0 });
    const error = await client.nutrition.calculate({ activity_type: 'bike', duration_min: 60 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).param).toBe(param);
    expect((error as ValidationError).suggestion).toBe(suggestion);
  });

  it('other validation errors carry no suggestion', async () => {
    global.fetch = jest.fn().mockResolvedValue(Response.json(
      { error: { type: 'invalid_request', code: 'invalid_value', param: 'legs', message: 'Send "legs" with 2 to 10 legs.' } }, { status: 400 }));
    const client = new Saturday({ apiKey: 'cp_test_placeholder', maxRetries: 0 });
    const error = await client.nutrition.calculate({ activity_type: 'brick', legs: [] }).catch((e: unknown) => e);
    expect((error as ValidationError).suggestion).toBeUndefined();
  });
});
