import { Saturday } from '../src/client';
import { SaturdayError } from '../src/errors';
import type { CoachWebhookEvent } from '../src/types';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

function captureFetch(payload: unknown = {}) {
  const mock = jest.fn().mockImplementation(async () => Response.json(payload));
  global.fetch = mock;
  return mock;
}

it('organizations.list sends limit and cursor, and nothing when left out', async () => {
  const mock = captureFetch({ organizations: [], pagination: { total: 0, has_more: false }, request_id: 'req_1' });
  const client = new Saturday({ apiKey: 'sk_test_fake', maxRetries: 0 });
  await client.organizations.list({ limit: 200, cursor: '1700000000' });
  await client.organizations.list();
  expect(mock.mock.calls[0][0]).toBe('https://api.saturday.fit/v1/organizations?limit=200&cursor=1700000000');
  expect(mock.mock.calls[1][0]).toBe('https://api.saturday.fit/v1/organizations');
});

it('batchCalculate sends estimate_only only when asked', async () => {
  const mock = captureFetch({ results: [], total: 1, succeeded: 0, failed: 0, estimated_ms: 100, elapsed_ms: 0, request_id: 'req_1' });
  const client = new Saturday({ apiKey: 'sk_test_fake', maxRetries: 0 });
  const scenarios = [{ activity_type: 'bike' as const, duration_min: 120 }];
  await client.nutrition.batchCalculate(scenarios, { estimateOnly: true });
  await client.nutrition.batchCalculate(scenarios);
  expect(JSON.parse(mock.mock.calls[0][1].body)).toEqual({ scenarios, estimate_only: true });
  expect(JSON.parse(mock.mock.calls[1][1].body)).toEqual({ scenarios });
});

it('a request that gets no answer throws SaturdayError connection_error, as a timeout does', async () => {
  const failure = Object.assign(new TypeError('fetch failed'), { cause: new Error('connect ECONNREFUSED 127.0.0.1:443') });
  const mock = jest.fn().mockRejectedValue(failure);
  global.fetch = mock;
  const client = new Saturday({ apiKey: 'sk_test_fake', maxRetries: 2 });
  const error = await client.athletes.get('ath_1').catch((value: unknown) => value);
  expect(error).toBeInstanceOf(SaturdayError);
  expect(error).toMatchObject({ status: 0, code: 'connection_error', message: 'fetch failed: connect ECONNREFUSED 127.0.0.1:443' });
  expect(mock).toHaveBeenCalledTimes(1);
});

it('coach.registerWebhook takes every coach event, and sends no events when left out', async () => {
  const mock = captureFetch({ id: 'wh_1', secret: 'whsec_1' });
  const client = new Saturday({ apiKey: 'cp_test_fake', maxRetries: 0 });
  const all: CoachWebhookEvent[] = ['*'];
  await client.coach.registerWebhook('https://example.com/hook', all);
  await client.coach.registerWebhook('https://example.com/hook', ['coach.message.sent', 'athlete.deleted']);
  await client.coach.registerWebhook('https://example.com/hook');
  expect(JSON.parse(mock.mock.calls[0][1].body)).toEqual({ url: 'https://example.com/hook', events: ['*'] });
  expect(JSON.parse(mock.mock.calls[1][1].body)).toEqual({ url: 'https://example.com/hook', events: ['coach.message.sent', 'athlete.deleted'] });
  expect(JSON.parse(mock.mock.calls[2][1].body)).toEqual({ url: 'https://example.com/hook' });
});
