import { Saturday } from '../src/client';
import { NotFoundError, RateLimitError } from '../src/errors';

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
  const client = new Saturday({ apiKey: 'sk_test_placeholder', maxRetries: 0 });

  const error = client.onboarding.questions().catch((value: unknown) => value);
  await jest.runAllTimersAsync();

  expect(await error).toBeInstanceOf(RateLimitError);
  expect((await error as RateLimitError).retryAfter).toBe(17);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('preserves empty 204 responses', async () => {
  global.fetch = jest.fn().mockResolvedValue(new Response(null, { status: 204 }));
  const client = new Saturday({ apiKey: 'sk_test_placeholder' });

  await expect(client.athletes.delete('athlete_123')).resolves.toBeUndefined();
});

describe('retries follow what the API says', () => {
  const rateLimited = (headers: Record<string, string>) => Response.json({
    error: { type: 'rate_limit_error', code: 'rate_limited', message: 'Slow down' },
  }, { status: 429, headers });

  afterEach(() => { jest.useRealTimers(); });

  it('waits out a short Retry-After, then retries', async () => {
    jest.useFakeTimers();
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(rateLimited({ 'Retry-After': '3' }))
      .mockResolvedValueOnce(Response.json({ questions: [] }));
    global.fetch = fetchMock;
    const client = new Saturday({ apiKey: 'sk_test_placeholder' });
    const result = client.onboarding.questions();
    await jest.advanceTimersByTimeAsync(2900);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(200);
    await expect(result).resolves.toEqual({ questions: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['no Retry-After, a daily limit', {} as Record<string, string>],
    ['a Retry-After of minutes, a block', { 'Retry-After': '840' }],
  ])('throws at once on a 429 with %s', async (_name, headers) => {
    const fetchMock = jest.fn().mockImplementation(async () => rateLimited(headers));
    global.fetch = fetchMock;
    const client = new Saturday({ apiKey: 'sk_test_placeholder' });
    await expect(client.onboarding.questions()).rejects.toBeInstanceOf(RateLimitError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry a create on a 5xx', async () => {
    const fetchMock = jest.fn().mockImplementation(async () => Response.json({ error: { message: 'Try again' } }, { status: 503 }));
    global.fetch = fetchMock;
    const client = new Saturday({ apiKey: 'sk_test_placeholder' });
    await expect(client.athletes.create({ external_id: 'u-1' } as any)).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('still retries a calculation on a 5xx', async () => {
    jest.useFakeTimers();
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(Response.json({ error: { message: 'Try again' } }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ tier: 'teaser' }));
    global.fetch = fetchMock;
    const client = new Saturday({ apiKey: 'sk_test_placeholder' });
    const result = client.nutrition.calculate({ activity_type: 'run', duration_min: 60 } as any);
    await jest.advanceTimersByTimeAsync(1100);
    await expect(result).resolves.toEqual({ tier: 'teaser' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
