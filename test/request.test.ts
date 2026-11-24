import { Saturday } from '../src/client';
import { AuthenticationError, ConflictError, NotFoundError, PermissionError, RateLimitError, SaturdayError, ValidationError } from '../src/errors';

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

it('a create whose external_id another athlete holds throws ConflictError naming that athlete', async () => {
  global.fetch = jest.fn().mockResolvedValue(Response.json({
    error: {
      type: 'invalid_request', code: 'athlete_exists', athlete_id: 'ath_1', request_id: 'req_1',
      message: 'An athlete with external_id "user-42" already exists: ath_1. Nothing was created.',
    },
  }, { status: 409 }));
  const client = new Saturday({ apiKey: 'sk_test_fake' });

  const error = await client.athletes.create({ external_id: 'user-42' }).catch((value: unknown) => value);
  expect(error).toBeInstanceOf(ConflictError);
  expect((error as ConflictError).code).toBe('athlete_exists');
  expect((error as ConflictError).athleteId).toBe('ath_1');
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

it('the sandbox day of simulated subscribers is a daily ceiling, never retried', async () => {
  const now = Date.now();
  const fetchMock = jest.fn().mockResolvedValue(Response.json({
    error: { type: 'rate_limit_error', code: 'simulated_subscriber_daily_limit_reached', message: 'This key has marked 10 athletes as subscribed today.' },
  }, { status: 429, headers: { 'Retry-After': '3600' } }));
  global.fetch = fetchMock;
  const client = new Saturday({ apiKey: 'sk_test_fake' });

  const error = await client.testing.simulateSubscription('ath_1').catch((value: unknown) => value) as RateLimitError;
  expect(error).toBeInstanceOf(RateLimitError);
  expect(error.dailyLimit).toBe(true);
  expect(error.retryable).toBe(false);
  expect(Math.abs(error.resetsAt!.getTime() - (now + 3600_000))).toBeLessThan(5000);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('integrations.sync posts to the intervals.icu route and sends sync_types when left out', async () => {
  const body = { result: { provider: 'intervals_icu', status: 'completed', activities_found: 1, activities_synced: 1, activities_skipped: 0 }, request_id: 'req_1' };
  const fetchMock = jest.fn().mockResolvedValue(Response.json(body));
  global.fetch = fetchMock;
  const client = new Saturday({ apiKey: 'sk_test_fake' });

  const synced = await client.integrations.sync('intervals_icu', { athlete_id: 'ath_1', access_token: 'tok', date_range: { start: '2026-11-01', end: '2026-11-07' } });
  expect(synced.result.activities_synced).toBe(1);
  expect(fetchMock.mock.calls[0][0]).toBe('https://api.saturday.fit/v1/integrations/intervals_icu/sync');
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
    athlete_id: 'ath_1', access_token: 'tok', date_range: { start: '2026-11-01', end: '2026-11-07' }, sync_types: ['activities'],
  });
});

it('sends coach reads and config writes to the documented routes with the documented bodies', async () => {
  const fetchMock = jest.fn().mockImplementation(async () => Response.json({ ok: true }));
  global.fetch = fetchMock;
  const client = new Saturday({ apiKey: 'cp_test_placeholder', maxRetries: 0 });

  await client.coach.roster({ window: 7 });
  await client.coach.rosterDigest({ window: 14 });
  await client.coach.fuelingRollup('ath_1', { window: 7, focus: 'worst' });
  await client.coach.sessionDetail('ath_1', 'act_1');
  const rules = await client.coach.getNotificationRules({ scope: 'group', scopeId: 'grp_1' });
  await client.coach.setNotificationRules('group', rules, 'grp_1');
  await client.coach.applyPreset({ scope: 'overall', preset: 'balanced' });
  await client.coach.getReportSettings({ scope: 'athlete', scopeId: 'ath_1' });
  await client.coach.setReportSettings('athlete', { ai_report_window_days: 7 }, 'ath_1');
  await client.coach.listWebhooks();
  await client.coach.registerWebhook('https://example.com/hook', ['concern.detected']);
  await client.coach.deleteWebhook('cwh_1');
  await client.coach.disableWebhook('cwh_1');
  await client.coach.enableWebhook('cwh_1');

  const calls = fetchMock.mock.calls.map(([url, init]) => [
    init.method, url, init.body === undefined ? undefined : JSON.parse(init.body),
  ]);
  expect(calls).toEqual([
    ['GET', 'https://api.saturday.fit/v1/coach/roster?window=7', undefined],
    ['GET', 'https://api.saturday.fit/v1/coach/roster/digest?window=14', undefined],
    ['GET', 'https://api.saturday.fit/v1/coach/athletes/ath_1/fueling-rollup?window=7&focus=worst', undefined],
    ['GET', 'https://api.saturday.fit/v1/coach/athletes/ath_1/sessions/act_1', undefined],
    ['GET', 'https://api.saturday.fit/v1/coach/config/notification-rules?scope=group&scope_id=grp_1', undefined],
    ['PUT', 'https://api.saturday.fit/v1/coach/config/notification-rules', { scope: 'group', scope_id: 'grp_1', rules }],
    ['POST', 'https://api.saturday.fit/v1/coach/config/preset', { scope: 'overall', preset: 'balanced' }],
    ['GET', 'https://api.saturday.fit/v1/coach/config/report-settings?scope=athlete&scope_id=ath_1', undefined],
    ['PUT', 'https://api.saturday.fit/v1/coach/config/report-settings', { scope: 'athlete', scope_id: 'ath_1', settings: { ai_report_window_days: 7 } }],
    ['GET', 'https://api.saturday.fit/v1/coach/webhooks', undefined],
    ['POST', 'https://api.saturday.fit/v1/coach/webhooks', { url: 'https://example.com/hook', events: ['concern.detected'] }],
    ['DELETE', 'https://api.saturday.fit/v1/coach/webhooks/cwh_1', undefined],
    ['POST', 'https://api.saturday.fit/v1/coach/webhooks/cwh_1/disable', undefined],
    ['POST', 'https://api.saturday.fit/v1/coach/webhooks/cwh_1/enable', undefined],
  ]);
});

describe('401, 422 and request ids', () => {
  it.each([
    [401, AuthenticationError, 'invalid_api_key'],
    [422, ValidationError, 'invalid_value'],
  ])('maps HTTP %i to the documented error class with code, param and requestId', async (status, klass, code) => {
    global.fetch = jest.fn().mockResolvedValue(Response.json(
      { error: { type: 'invalid_request', code, param: 'duration_min', message: 'Refused', request_id: 'req_9' } },
      { status }));
    const client = new Saturday({ apiKey: 'sk_test_fake', maxRetries: 0 });
    const error = await client.nutrition.calculate({ activity_type: 'run', duration_min: 60 })
      .catch((value: unknown) => value) as InstanceType<typeof klass>;
    expect(error).toBeInstanceOf(klass);
    expect(error).toMatchObject({ status, code, requestId: 'req_9' });
    expect(error.error.param).toBe('duration_min');
    if (error instanceof ValidationError) expect(error.param).toBe('duration_min');
    expect(error.message).toBe('Refused');
  });

  it('carries requestId on a 404', async () => {
    global.fetch = jest.fn().mockResolvedValue(Response.json(
      { error: { type: 'invalid_request', code: 'athlete_not_found', message: 'No such athlete', request_id: 'req_404' } },
      { status: 404 }));
    const client = new Saturday({ apiKey: 'sk_test_fake', maxRetries: 0 });
    const error = await client.athletes.get('ath_missing').catch((value: unknown) => value) as NotFoundError;
    expect(error).toBeInstanceOf(NotFoundError);
    expect(error.requestId).toBe('req_404');
    expect(error.code).toBe('athlete_not_found');
  });

  it('reads an error body sent without the error wrapper', async () => {
    global.fetch = jest.fn().mockResolvedValue(Response.json(
      { type: 'invalid_request', code: 'athlete_not_found', message: 'No such athlete', request_id: 'req_bare' },
      { status: 404 }));
    const client = new Saturday({ apiKey: 'sk_test_fake', maxRetries: 0 });
    const error = await client.athletes.get('ath_missing').catch((value: unknown) => value) as NotFoundError;
    expect(error).toBeInstanceOf(NotFoundError);
    expect(error).toMatchObject({ status: 404, code: 'athlete_not_found', requestId: 'req_bare' });
    expect(error.message).toBe('No such athlete');
  });

  it('defaults a missing code to unknown and keeps the message', async () => {
    global.fetch = jest.fn().mockResolvedValue(Response.json(
      { error: { type: 'invalid_request', message: 'Refused without a code' } }, { status: 400 }));
    const client = new Saturday({ apiKey: 'sk_test_fake', maxRetries: 0 });
    const error = await client.nutrition.calculate({ activity_type: 'run', duration_min: 60 })
      .catch((value: unknown) => value) as ValidationError;
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.code).toBe('unknown');
    expect(error.message).toBe('Refused without a code');
  });

  it('falls back to HTTP <status> when the error detail has no message', async () => {
    global.fetch = jest.fn().mockResolvedValue(Response.json(
      { error: { type: 'invalid_request', code: 'invalid_value' } }, { status: 400 }));
    const client = new Saturday({ apiKey: 'sk_test_fake', maxRetries: 0 });
    const error = await client.nutrition.calculate({ activity_type: 'run', duration_min: 60 })
      .catch((value: unknown) => value) as ValidationError;
    expect(error).toBeInstanceOf(ValidationError);
    expect(error).toMatchObject({ status: 400, error: { code: 'unknown', message: 'HTTP 400' } });
    expect(error.message).toBe('HTTP 400');
  });

  it('surfaces an empty 200 body as a parse failure and does not retry the read', async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response('', { status: 200 }));
    global.fetch = fetchMock;
    const client = new Saturday({ apiKey: 'sk_test_fake' });
    await expect(client.onboarding.questions()).rejects.toMatchObject({ name: 'SyntaxError' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('5xx retry decision by call', () => {
  it.each([
    // POSTs that create or change a record: one call, the 503 comes back.
    ['a webhook create', (c: Saturday) => c.webhooks.create('https://example.com/hook', ['athlete.created']), 1],
    ['an API key rotation', (c: Saturday) => c.partner.rotateApiKey('key_1'), 1],
    ['a license grant', (c: Saturday) => c.organizations.addLicenses('org_1', 'sub_1', [{ athlete_id: 'ath_1' }]), 1],
    ['an athlete batch create', (c: Saturday) => c.athletes.batchCreate([{ name: 'Fixture' }]), 1],
    ['an activity create', (c: Saturday) => c.activities.create('ath_1', { type: 'bike', duration_min: 60 }), 1],
    ['a coach webhook register', (c: Saturday) => c.coach.registerWebhook('https://example.com/hook', ['concern.detected']), 1],
    ['an integrations sync', (c: Saturday) => c.integrations.sync('intervals_icu', { athlete_id: 'ath_1', access_token: 'tok' }), 1],
    // POSTs that compute or read: retried once here, then the 200 comes back.
    ['a label read', (c: Saturday) => c.nutrition.extract({ image_base64: 'AA==' }), 2],
    ['a batch calculation', (c: Saturday) => c.nutrition.batchCalculate([{ activity_type: 'bike', duration_min: 120 }]), 2],
    ['a product fit', (c: Saturday) => c.nutrition.productFit({
      athlete_id: 'ath_1', product_query: 'maurten gel 100', activity_type: 'run', duration_min: 60,
    }), 2],
    ['a product compare', (c: Saturday) => c.nutrition.compareProducts({
      athlete_id: 'ath_1', product_a: { product_query: 'a' }, product_b: { product_query: 'b' },
      activity_type: 'run', duration_min: 60,
    }), 2],
    ['an activity-type inference', (c: Saturday) => c.infer.activityType({ activity_name: 'Morning Ride' }), 2],
    ['a brick inference', (c: Saturday) => c.infer.brickTypes({ activity_name: 'Brick session' }), 2],
    ['an export', (c: Saturday) => c.athletes.export('ath_1'), 2],
    ['an onboarding link', (c: Saturday) => c.athletes.createOnboardingLink('ath_1'), 2],
    // Every PUT, PATCH and DELETE is retried.
    ['an alert-rules replace', (c: Saturday) => c.coach.setNotificationRules('overall', {} as never), 2],
    ['an offer replace', (c: Saturday) => c.organizations.setOffer('org_1', { discount_percent: 10 }), 2],
    ['a subscription patch', (c: Saturday) => c.organizations.updateSubscription('org_1', 'sub_1', { seats: 10 }), 2],
    ['a webhook patch', (c: Saturday) => c.webhooks.update('wh_1', { active: false }), 2],
    ['a webhook delete', (c: Saturday) => c.webhooks.delete('wh_1'), 2],
    ['a license removal', (c: Saturday) => c.organizations.removeLicense('org_1', 'sub_1', 'ath_1'), 2],
  ])('a 503 on %s makes %i call(s)', async (_name, call, calls) => {
    jest.useFakeTimers();
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(Response.json({ error: { message: 'Try again' } }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    global.fetch = fetchMock;
    const result = call(new Saturday({ apiKey: 'sk_test_fake', maxRetries: 1 })).catch((e: unknown) => e);
    await jest.advanceTimersByTimeAsync(1100);
    const value = await result;
    expect(fetchMock).toHaveBeenCalledTimes(calls);
    if (calls === 1) expect(value).toMatchObject({ status: 503 });
    else expect(value).toEqual({ ok: true });
  });

  it.each([500, 502, 504])('retries a safe read on HTTP %i, as on a 503', async status => {
    jest.useFakeTimers();
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(Response.json({ error: { message: 'Try again' } }, { status }))
      .mockResolvedValueOnce(Response.json({ activity_types: [], total: 0, request_id: 'req_1' }));
    global.fetch = fetchMock;
    const result = new Saturday({ apiKey: 'sk_test_fake', maxRetries: 1 }).reference.activityTypes();
    await jest.advanceTimersByTimeAsync(1100);
    await expect(result).resolves.toMatchObject({ total: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a create on a 500 either', async () => {
    const fetchMock = jest.fn().mockImplementation(async () =>
      Response.json({ error: { message: 'Try again' } }, { status: 500 }));
    global.fetch = fetchMock;
    const client = new Saturday({ apiKey: 'sk_test_fake' });
    await expect(client.athletes.create({ external_id: 'u-1' })).rejects.toMatchObject({ status: 500 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives up after the default retries with 1, 2 and 4 second waits and throws the last 503', async () => {
    jest.useFakeTimers();
    const fetchMock = jest.fn().mockImplementation(async () =>
      Response.json({ error: { message: 'Try again' } }, { status: 503 }));
    global.fetch = fetchMock;
    const outcome = new Saturday({ apiKey: 'sk_test_fake' })
      .reference.activityTypes().catch((e: unknown) => e);
    await jest.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await jest.advanceTimersByTimeAsync(4000);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(await outcome).toMatchObject({ status: 503 });
  });

  it.each([31, 900])('returns a 503 with Retry-After %is at once instead of waiting it out', async wait => {
    const fetchMock = jest.fn().mockImplementation(async () => Response.json(
      { error: { message: 'Try again' } }, { status: 503, headers: { 'Retry-After': String(wait) } }));
    global.fetch = fetchMock;
    const error = await new Saturday({ apiKey: 'sk_test_fake' }).reference.activityTypes()
      .catch((e: unknown) => e) as { status: number; retryAfter?: number };
    expect(error.status).toBe(503);
    expect(error.retryAfter).toBe(wait);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('waits a 503 Retry-After of exactly 30 seconds and retries', async () => {
    jest.useFakeTimers();
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(Response.json(
        { error: { message: 'Try again' } }, { status: 503, headers: { 'Retry-After': '30' } }))
      .mockResolvedValueOnce(Response.json({ activity_types: [], total: 0, request_id: 'req_1' }));
    global.fetch = fetchMock;
    const result = new Saturday({ apiKey: 'sk_test_fake', maxRetries: 1 }).reference.activityTypes();
    await jest.advanceTimersByTimeAsync(29999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(10);
    await expect(result).resolves.toMatchObject({ total: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a 503 with Retry-After 0 without a wait', async () => {
    jest.useFakeTimers();
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(Response.json(
        { error: { message: 'Try again' } }, { status: 503, headers: { 'Retry-After': '0' } }))
      .mockResolvedValueOnce(Response.json({ activity_types: [], total: 0, request_id: 'req_1' }));
    global.fetch = fetchMock;
    const result = new Saturday({ apiKey: 'sk_test_fake', maxRetries: 1 }).reference.activityTypes();
    await jest.advanceTimersByTimeAsync(10);
    await expect(result).resolves.toMatchObject({ total: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('429 and mixed retry sequences', () => {
  it('runs a throttled read out of retries and throws the last 429', async () => {
    jest.useFakeTimers();
    const fetchMock = jest.fn().mockImplementation(async () => Response.json({
      error: { type: 'rate_limit_error', code: 'rate_limit_exceeded', message: 'Slow down' },
    }, { status: 429, headers: { 'Retry-After': '1' } }));
    global.fetch = fetchMock;
    const outcome = new Saturday({ apiKey: 'sk_test_fake', maxRetries: 2 })
      .reference.activityTypes().catch((e: unknown) => e);
    await jest.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const error = await outcome as RateLimitError;
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error.retryAfter).toBe(1);
  });

  it('retries a throttled create after Retry-After: the 429 path has no create guard', async () => {
    jest.useFakeTimers();
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(Response.json({
        error: { type: 'rate_limit_error', code: 'rate_limit_exceeded', message: 'Slow down' },
      }, { status: 429, headers: { 'Retry-After': '1' } }))
      .mockResolvedValueOnce(Response.json({ id: 'ath_1' }));
    global.fetch = fetchMock;
    const result = new Saturday({ apiKey: 'sk_test_fake', maxRetries: 1 })
      .athletes.create({ external_id: 'u-1' });
    await jest.advanceTimersByTimeAsync(1100);
    await expect(result).resolves.toEqual({ id: 'ath_1' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('follows a 429 wait with a 5xx backoff in one call', async () => {
    jest.useFakeTimers();
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(Response.json({
        error: { type: 'rate_limit_error', code: 'rate_limit_exceeded', message: 'Slow down' },
      }, { status: 429, headers: { 'Retry-After': '2' } }))
      .mockResolvedValueOnce(Response.json({ error: { message: 'Try again' } }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ activity_types: [], total: 0, request_id: 'req_1' }));
    global.fetch = fetchMock;
    const result = new Saturday({ apiKey: 'sk_test_fake' }).reference.activityTypes();
    await jest.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The 503 falls on attempt 1, so its computed backoff is 2 seconds.
    await jest.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(10);
    await expect(result).resolves.toMatchObject({ total: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('connection failures', () => {
  it('wraps a connection failure without a cause, once, at the default retries', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new TypeError('fetch failed'));
    global.fetch = fetchMock;
    const client = new Saturday({ apiKey: 'sk_test_fake' });
    const error = await client.onboarding.questions().catch((value: unknown) => value);
    expect(error).toBeInstanceOf(SaturdayError);
    expect(error).toMatchObject({ status: 0, code: 'connection_error', message: 'fetch failed' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a retry-safe calculation', (c: Saturday) => c.nutrition.calculate({ activity_type: 'run', duration_min: 60 })],
    ['a create', (c: Saturday) => c.athletes.create({ external_id: 'u-1' })],
  ])('never retries %s after a connection failure', async (_name, call) => {
    const fetchMock = jest.fn().mockRejectedValue(new TypeError('fetch failed'));
    global.fetch = fetchMock;
    const error = await call(new Saturday({ apiKey: 'sk_test_fake' })).catch((value: unknown) => value);
    expect(error).toMatchObject({ status: 0, code: 'connection_error' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps an aborted fetch to the SDK timeout, once', async () => {
    const aborted = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    const fetchMock = jest.fn().mockRejectedValue(aborted);
    global.fetch = fetchMock;
    const client = new Saturday({ apiKey: 'sk_test_fake', timeout: 250 });
    const error = await client.onboarding.questions().catch((value: unknown) => value) as SaturdayError;
    expect(error).toBeInstanceOf(SaturdayError);
    expect(error).toMatchObject({ status: 0, error: { code: 'timeout' } });
    expect(error.message).toContain('250');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rethrows a non-TypeError transport rejection untouched, once', async () => {
    const boom = new RangeError('transport exploded');
    const fetchMock = jest.fn().mockRejectedValue(boom);
    global.fetch = fetchMock;
    const client = new Saturday({ apiKey: 'sk_test_fake' });
    await expect(client.onboarding.questions()).rejects.toBe(boom);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('auth header, base URL and path encoding', () => {
  it('sends the bearerToken in place of the apiKey when both are set', async () => {
    const fetchMock = jest.fn().mockImplementation(async () => Response.json({ questions: [] }));
    global.fetch = fetchMock;
    const client = new Saturday({ apiKey: 'sk_test_fake', bearerToken: 'oauth_access_token', maxRetries: 0 });
    await client.onboarding.questions();
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ Authorization: 'Bearer oauth_access_token' });
  });

  it('strips trailing slashes from baseUrl before joining the path', async () => {
    const fetchMock = jest.fn().mockImplementation(async () => Response.json({ questions: [] }));
    global.fetch = fetchMock;
    const client = new Saturday({
      apiKey: 'sk_test_fake', baseUrl: 'https://api.example.test///', maxRetries: 0,
    });
    await client.onboarding.questions();
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.test/v1/onboarding/questions');
  });

  it('segment-encodes partner ids beyond the coach routes', async () => {
    const fetchMock = jest.fn().mockImplementation(async () => Response.json({ ok: true }));
    global.fetch = fetchMock;
    const client = new Saturday({ apiKey: 'sk_test_fake', maxRetries: 0 });
    await client.activities.get('ath/1', 'act 1');
    await client.webhooks.get('wh/1');
    await client.partner.revokeApiKey('key 1');
    await client.organizations.get('org?admin=true');
    await client.knowledge.getArticle('a/b');
    await client.athletes.revokeConsent('ath_1', 'con/1');
    const urls = fetchMock.mock.calls.map((call) => call[0] as string);
    expect(urls).toEqual([
      'https://api.saturday.fit/v1/athletes/ath%2F1/activities/act%201',
      'https://api.saturday.fit/v1/webhooks/wh%2F1',
      'https://api.saturday.fit/v1/partner/api-keys/key%201',
      'https://api.saturday.fit/v1/organizations/org%3Fadmin%3Dtrue',
      'https://api.saturday.fit/v1/knowledge/articles/a%2Fb',
      'https://api.saturday.fit/v1/athletes/ath_1/consent/con%2F1',
    ]);
  });
});

it('a POST erase answered 503 provider_erasure_incomplete is returned, not retried', async () => {
  const fetchMock = jest.fn().mockResolvedValue(Response.json({
    error: { type: 'api_error', code: 'provider_erasure_incomplete', message: 'A provider connection you supplied for this athlete could not be revoked yet, so nothing was deleted. Retry the request.' },
  }, { status: 503 }));
  global.fetch = fetchMock;
  const client = new Saturday({ apiKey: 'sk_test_fake' });

  const error = await client.athletes.erase('ath_1').catch((value: unknown) => value) as { status: number; code: string };
  expect(error.status).toBe(503);
  expect(error.code).toBe('provider_erasure_incomplete');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
