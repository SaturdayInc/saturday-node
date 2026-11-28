// Runs every TypeScript code example in README.md and in the JSDoc of
// src/index.ts and src/client.ts against mocked fetch (no network). The shell
// snippets in README.md (npm install), CONTRIBUTING.md, and test/LIVE.md are
// commands, not SDK examples: running them would install packages or rerun
// this suite, so they stay documentation. test/readme.test.ts keeps its
// quick-start response variants and the type-check of every README block.
import { readFileSync } from 'fs';
import { join } from 'path';
import ts from 'typescript';
import * as sdk from '../src';

const root = join(__dirname, '..');
const live = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'live.json'), 'utf8'));
const contracts = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'contracts.json'), 'utf8'));
const liveBody = (key: string): any => live[key].body;
const originalFetch = global.fetch;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
jest.setTimeout(30000);
afterEach(() => { global.fetch = originalFetch; });

function typescriptBlocks(markdown: string): string[] {
  return [...markdown.matchAll(/```typescript\n([\s\S]*?)```/g)].map(m => m[1]);
}

/** JSDoc examples: fenced blocks inside block comments, comment stars stripped. */
function jsdocBlocks(source: string): string[] {
  return typescriptBlocks(source).map(block => block.split('\n')
    .map(line => line.replace(/^\s*\* ?/, '')).join('\n'));
}

const readmeBlocks = typescriptBlocks(readFileSync(join(root, 'README.md'), 'utf8'));
const indexBlocks = jsdocBlocks(readFileSync(join(root, 'src', 'index.ts'), 'utf8'));
const clientBlocks = jsdocBlocks(readFileSync(join(root, 'src', 'client.ts'), 'utf8'));
const blockWith = (marker: string): string => {
  const found = readmeBlocks.filter(b => b.includes(marker));
  expect(found).toHaveLength(1);
  return found[0];
};

interface RecordedCall { url: string; method: string; body: any }
type Route = (call: RecordedCall) => Response;

const alertRules = {
  channel_config: { email: { enabled: false }, push: { enabled: false } },
  quiet_hours: { enabled: false },
};

function defaultRoute(call: RecordedCall): Response {
  const path = call.url.replace('https://api.saturday.fit', '').split('?')[0];
  const route = `${call.method} ${path}`;
  if (route === 'POST /v1/athletes') return Response.json(liveBody('athlete'), { status: 201 });
  if (/^GET \/v1\/athletes\/[^/]+$/.test(route)) return Response.json(liveBody('athlete_get'));
  if (/^GET \/v1\/athletes\/[^/]+\/fueling-profile$/.test(route)) return Response.json(contracts.fueling_profile_on);
  if (route === 'POST /v1/nutrition/calculate') {
    return Response.json(call.body?.legs ? liveBody('calculate_brick') : liveBody('calculate_exact'));
  }
  if (/^POST \/v1\/athletes\/[^/]+\/activities$/.test(route)) {
    return Response.json(call.body?.legs ? liveBody('activity_brick') : liveBody('activity'), { status: 201 });
  }
  if (/\/calculate$/.test(route)) return Response.json(liveBody('activity_calculate_brick'));
  if (/\/prep$/.test(route)) return Response.json(call.body?.legs ? liveBody('prep_brick_per_leg') : liveBody('prep'));
  if (route === 'POST /v1/nutrition/products/fit') {
    return Response.json(call.body?.legs ? liveBody('product_fit_brick') : liveBody('product_fit'));
  }
  if (route === 'POST /v1/webhooks') return Response.json(liveBody('webhook_created'), { status: 201 });
  if (/^POST \/v1\/webhooks\/[^/]+\/test$/.test(route)) return Response.json(liveBody('webhook_test'));
  if (route === 'GET /v1/coach/config/notification-rules') return Response.json(alertRules);
  if (route === 'PUT /v1/coach/config/notification-rules') return Response.json({ ok: true, scope: 'overall' });
  if (route === 'GET /v1/coach/roster/digest') {
    return Response.json({ coach_uid: 'coach_1', window: 7, flagged_count: 0, total_count: 0, flagged: [] });
  }
  if (route === 'POST /v1/coach/config/preset') return Response.json({ ok: true, preset: 'balanced' });
  throw new Error(`Unexpected route in example: ${route}`);
}

async function execute(source: string, route: Route = defaultRoute) {
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const calls: RecordedCall[] = [];
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const call = {
      url, method: init?.method ?? 'GET',
      body: init?.body === undefined ? undefined : JSON.parse(init.body as string),
    };
    calls.push(call);
    return route(call);
  }) as never;
  const log = jest.fn();
  const run = new AsyncFunction('require', 'exports', 'console', 'process', 'Saturday', javascript);
  await run((name: string) => {
    if (name !== '@saturdayinc/sdk') throw new Error(`Unexpected module ${name}`);
    return sdk;
  }, {}, { log }, {
    env: { SATURDAY_API_KEY: 'sk_test_examples', SATURDAY_COACH_KEY: 'cp_test_examples' },
  }, sdk.Saturday);
  return { log, calls };
}

it('finds every documented example: 9 in README, 1 in src/index.ts, 2 in src/client.ts', () => {
  expect(readmeBlocks).toHaveLength(9);
  expect(indexBlocks).toHaveLength(1);
  expect(clientBlocks).toHaveLength(2);
  for (const marker of ['concerns_answered', 'Still needed', 'triathlon', 'athleteFor', 'signingSecret',
    'SATURDAY_COACH_KEY', 'dailyLimit', 'baseUrl', 'getFuelingProfile']) {
    expect(readmeBlocks.filter(b => b.includes(marker))).toHaveLength(1);
  }
});

it('runs the README quick start (exact recorded answer)', async () => {
  const plan = liveBody('calculate_exact');
  const { log, calls } = await execute(blockWith('concerns_answered'));
  expect(calls.map(c => `${c.method} ${c.url}`)).toEqual([
    'POST https://api.saturday.fit/v1/athletes',
    'POST https://api.saturday.fit/v1/nutrition/calculate',
  ]);
  expect(calls[1].body.athlete_id).toBe(liveBody('athlete').id);
  const lines = plan.precision?.profile_complete
    ? [`Carbs: ${plan.carb_g_per_hr ?? 0} g/hr`, `Sodium: ${plan.sodium_mg_per_hr ?? 0} mg/hr`, `Fluid: ${plan.fluid_ml_per_hr ?? 0} mL/hr`]
    : [`Carbs: ${plan.carb_range_g_per_hr} g/hr`, `Sodium: ${plan.sodium_range_mg_per_hr} mg/hr`, `Fluid: ${plan.fluid_range_ml_per_hr} mL/hr`];
  expect(log.mock.calls).toEqual([...lines.map(l => [l]), ...(plan.safety.warnings ?? []).map((w: string) => [w])]);
});

it('runs the README prep and product-fit example', async () => {
  const { log, calls } = await execute(blockWith('Still needed'));
  expect(calls.map(c => `${c.method} ${c.url.replace('https://api.saturday.fit', '')}`)).toEqual([
    'POST /v1/athletes/ATHLETE_ID/activities',
    `POST /v1/athletes/ATHLETE_ID/activities/${liveBody('activity').id}/calculate`,
    `POST /v1/athletes/ATHLETE_ID/activities/${liveBody('activity').id}/prep`,
    'POST /v1/nutrition/products/fit',
    'POST /v1/nutrition/products/fit',
  ]);
  const prep = liveBody('prep');
  const expected: unknown[][] = prep.products.map((p: any) => [`${p.servings} x ${p.product_name}`]);
  expected.push(['Still needed:', prep.remaining_gap]);
  const fit = liveBody('product_fit');
  if (fit.tier === 'full') expected.push([fit.fit?.verdict]);
  for (const leg of liveBody('product_fit_brick').legs ?? []) {
    expected.push([`${leg.activity_type}: ${leg.fit.max_servings} servings`]);
  }
  expect(log.mock.calls).toEqual(expected);
});

it('runs the README bricks and triathlons example', async () => {
  const { log, calls } = await execute(blockWith('triathlon'));
  expect(calls.map(c => c.method)).toEqual(['POST', 'POST', 'POST', 'POST']);
  const brick = liveBody('calculate_brick');
  expect(log.mock.calls.slice(0, brick.legs.length)).toEqual(
    brick.legs.map((leg: any) => [`${leg.duration_min} min: ${leg.total_carb_g} g carbs`]),
  );
  expect(log.mock.calls[brick.legs.length]).toEqual([liveBody('activity_calculate_brick').prescription?.legs]);
  const prepLegs = liveBody('prep_brick_per_leg').legs ?? [];
  expect(log.mock.calls.slice(brick.legs.length + 1)).toEqual(
    prepLegs.map((leg: any) => [leg.activity_type, leg.products.length, leg.remaining_gap]),
  );
  expect(calls[3].body.legs).toHaveLength(3);
});

it('runs the README external_id example down the conflict path, then the create path', async () => {
  const source = blockWith('athleteFor');
  const conflict = await execute(source, call => {
    if (call.method === 'POST' && call.url.endsWith('/v1/athletes')) {
      return Response.json({
        error: {
          type: 'invalid_request', code: 'athlete_exists', athlete_id: 'ath_existing',
          message: 'An athlete with external_id "user-42" already exists: ath_existing. Nothing was created.',
        },
      }, { status: 409 });
    }
    return defaultRoute(call);
  });
  expect(conflict.calls.map(c => `${c.method} ${c.url}`)).toEqual([
    'POST https://api.saturday.fit/v1/athletes',
    'GET https://api.saturday.fit/v1/athletes/ath_existing',
  ]);
  expect(conflict.log.mock.calls).toEqual([[liveBody('athlete_get').id]]);

  const created = await execute(source);
  expect(created.calls).toHaveLength(1);
  expect(created.log.mock.calls).toEqual([[liveBody('athlete').id]]);
});

it('runs the README webhooks example', async () => {
  const { log, calls } = await execute(blockWith('signingSecret'));
  const created = liveBody('webhook_created');
  const delivery = liveBody('webhook_test').delivery;
  expect(calls.map(c => `${c.method} ${c.url}`)).toEqual([
    'POST https://api.saturday.fit/v1/webhooks',
    `POST https://api.saturday.fit/v1/webhooks/${created.webhook.id}/test`,
  ]);
  expect(log.mock.calls).toEqual([[delivery.status, delivery.status_code, created.webhook.secret.length]]);
});

it('runs the README coach alert-rules example, carrying channel_config back', async () => {
  const { calls } = await execute(blockWith('SATURDAY_COACH_KEY'));
  expect(calls[0].url).toBe('https://api.saturday.fit/v1/coach/config/notification-rules?scope=overall');
  expect(calls[1].method).toBe('PUT');
  expect(calls[1].body.scope).toBe('overall');
  expect(calls[1].body.scope_id).toBeUndefined();
  expect(calls[1].body.rules.hourly_cap).toEqual({ enabled: true, per_hour: 2 });
  expect(calls[1].body.rules.channel_config).toEqual(alertRules.channel_config);
});

describe('the README errors example, one run per branch', () => {
  const source = (): string => blockWith('dailyLimit');
  const failing = (status: number, error: unknown, headers?: Record<string, string>): Route =>
    () => Response.json({ error }, { status, headers });

  it('success: no branch runs, nothing is logged', async () => {
    const { log, calls } = await execute(source());
    expect(calls).toHaveLength(1);
    expect(log).not.toHaveBeenCalled();
  });

  it('daily ceiling: logs the code and the reset time, without retrying', async () => {
    const { log, calls } = await execute(source(), failing(429,
      { type: 'rate_limit_error', code: 'daily_call_limit_reached', message: 'Daily call limit reached.' },
      { 'Retry-After': '3600' }));
    expect(calls).toHaveLength(1);
    expect(log.mock.calls).toHaveLength(1);
    expect(log.mock.calls[0][0]).toMatch(/^daily_call_limit_reached: resets at \d{4}-\d{2}-\d{2}T/);
  });

  it('long throttle: logs the wait from retryAfter', async () => {
    const { log } = await execute(source(), failing(429,
      { type: 'rate_limit_error', code: 'rate_limit_exceeded', message: 'Slow down.' },
      { 'Retry-After': '3600' }));
    expect(log.mock.calls).toEqual([['rate_limit_exceeded: try again in 3600 s']]);
  });

  it('unsupported_field: logs the param and the suggestion parsed from the message', async () => {
    const { log } = await execute(source(), failing(400, {
      type: 'invalid_request', code: 'unsupported_field', param: 'meal_before_mins',
      message: '"meal_before_mins" is not a field of this request. Did you mean "meal_before_min"?',
    }));
    expect(log.mock.calls).toEqual([['meal_before_mins is not a field of this request; send meal_before_min']]);
  });

  it('other validation: logs the param to fix and the message', async () => {
    const { log } = await execute(source(), failing(400, {
      type: 'invalid_request', code: 'invalid_value', param: 'duration_min',
      message: 'duration_min must be at least 1.',
    }));
    expect(log.mock.calls).toEqual([['Fix duration_min: duration_min must be at least 1.']]);
  });
});

it('runs the README configuration example: clients construct, nothing is fetched', async () => {
  const { log, calls } = await execute(blockWith('baseUrl'));
  expect(calls).toEqual([]);
  expect(log).not.toHaveBeenCalled();
});

it('runs the README fueling-profile example on the shared and unshared shapes', async () => {
  const source = blockWith('getFuelingProfile');
  const shared = contracts.fueling_profile_on;
  const on = await execute(source);
  const sweat = shared.profile.sweat_level;
  expect(on.log.mock.calls).toEqual([
    [`Sweat level ${sweat.value ?? 'not answered'}; calculations use ${sweat.calculations_use}`],
  ]);

  const offBody = contracts.fueling_profile_off;
  const off = await execute(source, call => call.url.includes('fueling-profile')
    ? Response.json(offBody) : defaultRoute(call));
  expect(off.log.mock.calls).toEqual([[offBody.message]]);
});

it('runs the src/index.ts package example', async () => {
  const { log, calls } = await execute(indexBlocks[0]);
  expect(calls.map(c => c.url)).toEqual(['https://api.saturday.fit/v1/nutrition/calculate']);
  const plan = liveBody('calculate_exact');
  expect(log.mock.calls).toEqual([[plan.carb_g_per_hr ?? plan.carb_range_g_per_hr]]);
});

it('runs the Saturday class example in src/client.ts', async () => {
  const { calls } = await execute(clientBlocks.find(b => b.includes('athlete_id: athlete.id'))!);
  expect(calls.map(c => `${c.method} ${c.url}`)).toEqual([
    'POST https://api.saturday.fit/v1/athletes',
    'POST https://api.saturday.fit/v1/nutrition/calculate',
  ]);
  expect(calls[0].body).toMatchObject({ external_id: 'user-42', sex: 'female', year_of_birth: 1990, weight_kg: 62 });
  expect(calls[1].body.athlete_id).toBe(liveBody('athlete').id);
});

it('runs the CoachResource example in src/client.ts', async () => {
  const { calls } = await execute(clientBlocks.find(b => b.includes('rosterDigest'))!);
  expect(calls.map(c => `${c.method} ${c.url}`)).toEqual([
    'GET https://api.saturday.fit/v1/coach/roster/digest?window=7',
    'POST https://api.saturday.fit/v1/coach/config/preset',
  ]);
  expect(calls[1].body).toEqual({ scope: 'overall', preset: 'balanced' });
});
