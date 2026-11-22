import { Saturday } from '../src/client';
import { NotFoundError, RateLimitError, SaturdayError } from '../src/errors';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  jest.useRealTimers();
});

async function captureError(fn: () => unknown): Promise<unknown> {
  try {
    const result = fn();
    if (result instanceof Promise) await result;
    return undefined;
  } catch (e) {
    return e;
  }
}

describe('#2 coach ids are segment-encoded', () => {
  it('encodes coach athlete and activity ids so slashes and queries cannot escape the segment', async () => {
    const fetchMock = jest.fn().mockImplementation(async () => Response.json({ ok: true }));
    global.fetch = fetchMock;
    const client = new Saturday({ apiKey: 'cp_test_placeholder', maxRetries: 0 });

    await client.coach.fuelingRollup('a/b', { window: 7 });
    await client.coach.report('a/b');
    await client.coach.sessionDetail('x?admin=true', 'a/b');
    await client.coach.deleteWebhook('../billing/tier-status');
    await client.coach.disableWebhook('cwh/1');
    await client.coach.enableWebhook('cwh 1');

    const urls = fetchMock.mock.calls.map((call) => call[0] as string);
    expect(urls[0]).toBe('https://api.saturday.fit/v1/coach/athletes/a%2Fb/fueling-rollup?window=7');
    expect(urls[1]).toBe('https://api.saturday.fit/v1/coach/athletes/a%2Fb/report');
    expect(urls[2]).toBe('https://api.saturday.fit/v1/coach/athletes/x%3Fadmin%3Dtrue/sessions/a%2Fb');
    expect(urls[3]).toBe('https://api.saturday.fit/v1/coach/webhooks/..%2Fbilling%2Ftier-status');
    expect(urls[4]).toBe('https://api.saturday.fit/v1/coach/webhooks/cwh%2F1/disable');
    expect(urls[5]).toBe('https://api.saturday.fit/v1/coach/webhooks/cwh%201/enable');
  });

  it('encodes the coach athlete id on the PDF route', async () => {
    const fetchMock = jest.fn().mockImplementation(async () => new Response('%PDF-1.7'));
    global.fetch = fetchMock;
    const client = new Saturday({ apiKey: 'cp_test_placeholder', maxRetries: 0 });
    await client.coach.reportPdf('../../partner');
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.saturday.fit/v1/coach/athletes/..%2F..%2Fpartner/report?format=pdf',
    );
  });
});

describe('#14 bare dot segments are rejected', () => {
  it.each(['.', '..'])('rejects %j as an athlete id without calling fetch', async (bad) => {
    const fetchMock = jest.fn().mockImplementation(async () => Response.json({ ok: true }));
    global.fetch = fetchMock;
    const client = new Saturday({ apiKey: 'sk_test_fake', maxRetries: 0 });
    const error = await captureError(() => client.athletes.get(bad));
    expect(error).toBeInstanceOf(TypeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['.', '..'])('rejects %j as a coach athlete uid', async (bad) => {
    const fetchMock = jest.fn().mockImplementation(async () => Response.json({ ok: true }));
    global.fetch = fetchMock;
    const client = new Saturday({ apiKey: 'cp_test_placeholder', maxRetries: 0 });
    const error = await captureError(() => client.coach.fuelingRollup(bad));
    expect(error).toBeInstanceOf(TypeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a dot webhook id and a dot session id', async () => {
    const fetchMock = jest.fn().mockImplementation(async () => Response.json({ ok: true }));
    global.fetch = fetchMock;
    const client = new Saturday({ apiKey: 'cp_test_placeholder', maxRetries: 0 });
    expect(await captureError(() => client.coach.deleteWebhook('..'))).toBeInstanceOf(TypeError);
    expect(await captureError(() => client.coach.sessionDetail('ath_1', '.'))).toBeInstanceOf(TypeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still allows dotted ids that are not bare dot segments', async () => {
    const fetchMock = jest.fn().mockImplementation(async () => Response.json({ ok: true }));
    global.fetch = fetchMock;
    const client = new Saturday({ apiKey: 'sk_test_fake', maxRetries: 0 });
    await client.athletes.get('a.b');
    await client.athletes.get('...');
    await client.athletes.get('.hidden');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('#5 method is normalized to upper case at request entry', () => {
  it('does not retry a lowercase post create on a 5xx', async () => {
    jest.useFakeTimers();
    const fetchMock = jest.fn().mockImplementation(async () =>
      Response.json({ error: { type: 'api_error', code: 'x', message: 'Try again' } }, { status: 503 }));
    global.fetch = fetchMock;
    const client = new Saturday({ apiKey: 'sk_test_fake', maxRetries: 1 });
    const outcome = client.request('post', '/v1/athletes', { external_id: 'u-1' }).catch((e: unknown) => e);
    await jest.advanceTimersByTimeAsync(5000);
    const value = await outcome;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(value).toMatchObject({ status: 503 });
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
  });

  it('still retries a lowercase get on a 5xx', async () => {
    jest.useFakeTimers();
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(Response.json({ error: { type: 'api_error', code: 'x', message: 'Try again' } }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    global.fetch = fetchMock;
    const client = new Saturday({ apiKey: 'sk_test_fake', maxRetries: 1 });
    const result = client.request('get', '/v1/health');
    await jest.advanceTimersByTimeAsync(1100);
    await expect(result).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].method).toBe('GET');
  });
});

describe('#3 request refuses absolute and scheme-relative URLs', () => {
  it.each([
    'https://evil.invalid/steal',
    'http://evil.invalid/steal',
    '//evil.invalid/steal',
  ])('refuses %s without calling fetch', async (path) => {
    const fetchMock = jest.fn().mockImplementation(async () => Response.json({ ok: true }));
    global.fetch = fetchMock;
    const client = new Saturday({ apiKey: 'sk_test_fake', maxRetries: 0 });
    const error = await captureError(() => client.request('GET', path));
    expect(error).toBeInstanceOf(TypeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still allows a normal relative path', async () => {
    const fetchMock = jest.fn().mockImplementation(async () => Response.json({ ok: true }));
    global.fetch = fetchMock;
    const client = new Saturday({ apiKey: 'sk_test_fake', maxRetries: 0 });
    await expect(client.request('GET', '/v1/health')).resolves.toEqual({ ok: true });
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.saturday.fit/v1/health');
  });
});

describe('#6 and #7 Retry-After parsing', () => {
  async function rateLimitErrorFor(header: string | null): Promise<RateLimitError> {
    const headers: Record<string, string> = header === null ? {} : { 'Retry-After': header };
    global.fetch = jest.fn().mockResolvedValue(Response.json({
      error: { type: 'rate_limit_error', code: 'rate_limit_exceeded', message: 'Slow down' },
    }, { status: 429, headers }));
    const client = new Saturday({ apiKey: 'sk_test_fake', maxRetries: 0 });
    return client.onboarding.questions().catch((e: unknown) => e) as Promise<RateLimitError>;
  }

  it('parses an HTTP-date Retry-After as seconds until that date', async () => {
    jest.useFakeTimers();
    const now = new Date('2026-11-22T12:00:00.000Z');
    jest.setSystemTime(now);
    const when = new Date(now.getTime() + 5000).toUTCString();
    const error = await rateLimitErrorFor(when);
    expect(error.retryAfter).toBe(5);
    expect(error.dailyLimit).toBe(false);
  });

  it('clamps an HTTP-date in the past to zero', async () => {
    jest.useFakeTimers();
    const now = new Date('2026-11-22T12:00:00.000Z');
    jest.setSystemTime(now);
    const when = new Date(now.getTime() - 5000).toUTCString();
    const error = await rateLimitErrorFor(when);
    expect(error.retryAfter).toBe(0);
  });

  it('waits for an HTTP-date on a 429 and then retries', async () => {
    jest.useFakeTimers();
    const now = new Date('2026-11-22T12:00:00.000Z');
    jest.setSystemTime(now);
    const when = new Date(now.getTime() + 2000).toUTCString();
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(Response.json({
        error: { type: 'rate_limit_error', code: 'rate_limit_exceeded', message: 'Slow down' },
      }, { status: 429, headers: { 'Retry-After': when } }))
      .mockResolvedValueOnce(Response.json({ questions: [] }));
    global.fetch = fetchMock;
    const client = new Saturday({ apiKey: 'sk_test_fake', maxRetries: 1 });
    const result = client.onboarding.questions();
    await jest.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(10);
    await expect(result).resolves.toEqual({ questions: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('treats an empty Retry-After as absent', async () => {
    const error = await rateLimitErrorFor('');
    expect(error.retryAfter).toBeUndefined();
  });

  it('treats a whitespace-only Retry-After as absent', async () => {
    const error = await rateLimitErrorFor('   ');
    expect(error.retryAfter).toBeUndefined();
  });

  it('treats a non-numeric non-date Retry-After as absent', async () => {
    const error = await rateLimitErrorFor('invalid');
    expect(error.retryAfter).toBeUndefined();
  });

  it('clamps a negative Retry-After to zero', async () => {
    const error = await rateLimitErrorFor('-1');
    expect(error.retryAfter).toBe(0);
  });

  it('keeps a plain delta-seconds Retry-After', async () => {
    const error = await rateLimitErrorFor('7');
    expect(error.retryAfter).toBe(7);
  });
});

describe('#9 non-object error bodies produce a SaturdayError, never a TypeError', () => {
  it.each([
    ['null', 'null'],
    ['a JSON string', '"oops"'],
    ['a JSON number', '42'],
    ['a JSON boolean', 'true'],
    ['a JSON array', '[]'],
  ])('maps a 500 with %s body to SaturdayError with code unknown', async (_name, raw) => {
    global.fetch = jest.fn().mockResolvedValue(new Response(raw, {
      status: 500, headers: { 'Content-Type': 'application/json' },
    }));
    const client = new Saturday({ apiKey: 'sk_test_fake', maxRetries: 0 });
    const error = await client.onboarding.questions().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SaturdayError);
    expect(error).not.toBeInstanceOf(TypeError);
    expect(error).toMatchObject({ status: 500, error: { code: 'unknown', message: 'HTTP 500' } });
    expect((error as Error).message).toBe('HTTP 500');
  });

  it('maps a 404 with a null body to NotFoundError', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response('null', {
      status: 404, headers: { 'Content-Type': 'application/json' },
    }));
    const client = new Saturday({ apiKey: 'sk_test_fake', maxRetries: 0 });
    const error = await client.onboarding.questions().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotFoundError);
    expect(error).toMatchObject({ status: 404, error: { code: 'unknown', message: 'HTTP 404' } });
  });
});

describe('#10 non-JSON error body message stays short', () => {
  it('uses HTTP <status>, not the raw HTML page', async () => {
    const html = `<html>${'x'.repeat(2000)}</html>`;
    global.fetch = jest.fn().mockResolvedValue(new Response(html, { status: 502 }));
    const client = new Saturday({ apiKey: 'sk_test_fake', maxRetries: 0 });
    const error = await client.onboarding.questions().catch((e: unknown) => e) as SaturdayError;
    expect(error).toBeInstanceOf(SaturdayError);
    expect(error.status).toBe(502);
    expect(error.error.code).toBe('unknown');
    expect(error.message).toBe('HTTP 502');
    expect(error.message.length).toBeLessThanOrEqual(200);
  });
});

describe('#11 constructor option validation', () => {
  it.each([
    ['timeout', { apiKey: 'sk_test_fake', timeout: 0 }],
    ['timeout', { apiKey: 'sk_test_fake', timeout: -5 }],
    ['timeout', { apiKey: 'sk_test_fake', timeout: NaN }],
    ['timeout', { apiKey: 'sk_test_fake', timeout: Infinity }],
    ['maxRetries', { apiKey: 'sk_test_fake', maxRetries: -1 }],
    ['maxRetries', { apiKey: 'sk_test_fake', maxRetries: 1.5 }],
    ['maxRetries', { apiKey: 'sk_test_fake', maxRetries: NaN }],
    ['maxRetries', { apiKey: 'sk_test_fake', maxRetries: Infinity }],
    ['apiKey', { apiKey: '' }],
    ['apiKey', { apiKey: 'sk_test\r\ninjected' }],
    ['apiKey', { apiKey: 'sk_test\u0000bad' }],
  ] as const)('rejects an invalid %s naming the option', (option, config) => {
    expect(() => new Saturday(config as never)).toThrow(TypeError);
    expect(() => new Saturday(config as never)).toThrow(new RegExp(option));
  });

  it('rejects a non-string apiKey and a non-number timeout and maxRetries', () => {
    expect(() => new Saturday({ apiKey: 123 } as never)).toThrow(/apiKey/);
    expect(() => new Saturday({ apiKey: 'sk_test_fake', timeout: '100' } as never)).toThrow(/timeout/);
    expect(() => new Saturday({ apiKey: 'sk_test_fake', maxRetries: '2' } as never)).toThrow(/maxRetries/);
  });

  it('accepts valid edge values', () => {
    expect(() => new Saturday({ apiKey: 'sk_test_fake', timeout: 1, maxRetries: 0 })).not.toThrow();
    expect(() => new Saturday({ apiKey: 'sk_test_fake' })).not.toThrow();
  });
});

describe('#12 computed backoff is capped at the Retry-After maximum', () => {
  it('caps the 32 second computed wait at 30 seconds', async () => {
    jest.useFakeTimers();
    const fetchMock = jest.fn().mockImplementation(async () =>
      Response.json({ error: { type: 'api_error', code: 'x', message: 'Try again' } }, { status: 503 }));
    global.fetch = fetchMock;
    const client = new Saturday({ apiKey: 'sk_test_fake', maxRetries: 6 });
    const outcome = client.reference.activityTypes().catch((e: unknown) => e);
    await jest.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await jest.advanceTimersByTimeAsync(4000);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await jest.advanceTimersByTimeAsync(8000);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    await jest.advanceTimersByTimeAsync(16000);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    await jest.advanceTimersByTimeAsync(29999);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    await jest.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(await outcome).toMatchObject({ status: 503 });
  });
});

describe('bearer token clients', () => {
  it('accepts an empty apiKey when a bearerToken is sent', async () => {
    const calls: Array<{ url: string; auth: string | null }> = [];
    global.fetch = jest.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, auth: new Headers(init.headers).get('Authorization') });
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;
    const client = new Saturday({ apiKey: '', bearerToken: 'eyJ.test.token', maxRetries: 0 });
    await client.request('GET', '/v1/athletes');
    expect(calls[0].auth).toBe('Bearer eyJ.test.token');
  });

  it('rejects control characters in a bearerToken', () => {
    expect(() => new Saturday({ apiKey: '', bearerToken: 'eyJ\r\nX-Evil: 1' })).toThrow(/bearerToken/);
  });
});
