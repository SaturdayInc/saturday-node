import { Saturday } from '../src/client';
import { NotFoundError, PermissionError, RateLimitError } from '../src/errors';

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
