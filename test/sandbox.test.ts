import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Saturday, SaturdayError } from '../src';

const SANDBOX_BASE = 'https://partner-api-5vozuebg2a-uc.a.run.app';
const OPT_IN = 'SATURDAY_SANDBOX_ALLOW_MUTATIONS';

function sandboxConfig(env: Record<string, string | undefined>) {
  if (env[OPT_IN] !== '1') return undefined;
  if (env.SATURDAY_SANDBOX_BASE_URL !== SANDBOX_BASE) throw new Error('Exact sandbox base URL required');
  if (!env.SATURDAY_SANDBOX_API_KEY?.startsWith('sk_test_')) throw new Error('Sandbox test key required');
  return { apiKey: env.SATURDAY_SANDBOX_API_KEY, baseUrl: SANDBOX_BASE, maxRetries: 0, timeout: 60000 };
}

it('never enables sandbox writes without explicit mutation opt-in', () => {
  expect(sandboxConfig({})).toBeUndefined();
  expect(sandboxConfig({ SATURDAY_SANDBOX_API_KEY: 'sk_test_fake', SATURDAY_SANDBOX_BASE_URL: SANDBOX_BASE })).toBeUndefined();
});

it.each([
  {},
  { SATURDAY_SANDBOX_BASE_URL: 'https://api.saturday.fit', SATURDAY_SANDBOX_API_KEY: 'sk_test_fake' },
  { SATURDAY_SANDBOX_BASE_URL: `${SANDBOX_BASE}/`, SATURDAY_SANDBOX_API_KEY: 'sk_test_fake' },
  { SATURDAY_SANDBOX_BASE_URL: SANDBOX_BASE, SATURDAY_SANDBOX_API_KEY: 'sk_live_fake' },
])('rejects incomplete or unsafe sandbox configuration (%j)', env => {
  expect(() => sandboxConfig({ ...env, [OPT_IN]: '1' })).toThrow();
});

it('configures the allowlisted sandbox without request retries', () => {
  expect(sandboxConfig({ [OPT_IN]: '1', SATURDAY_SANDBOX_BASE_URL: SANDBOX_BASE, SATURDAY_SANDBOX_API_KEY: 'sk_test_fake' }))
    .toMatchObject({ baseUrl: SANDBOX_BASE, maxRetries: 0 });
});

async function runSandboxContract(config: NonNullable<ReturnType<typeof sandboxConfig>>) {
  const runId = `sdk-node-${randomUUID()}`;
  const report: Record<string, any> = {
    run_id: runId, stage: 'start', calls: 0, created: [], variants: {},
    cleanup: 'retained named test fixtures; athlete DELETE does not cascade subcollections',
  };
  const originalFetch = global.fetch;
  const ownedAthletes = new Set<string>();
  const deadline = Date.now() + 300000;
  const ledger = () => console.log(`SATURDAY_SANDBOX_LEDGER ${JSON.stringify(report)}`);
  const must = (condition: unknown, code: string) => {
    if (!condition) { report.failure = code; throw new Error('Sandbox contract assertion failed'); }
  };
  const object = (value: any) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const safety = (value: any) => {
    must(object(value) && value.not_instructions === true, 'safety framing');
    must(value.warnings === null || (Array.isArray(value.warnings) && value.warnings.every((x: unknown) => typeof x === 'string')), 'nullable safety warnings');
    for (const field of ['max_safe_fluid_ml_per_hr', 'max_safe_sodium_mg_per_hr', 'confidence_score']) must(typeof value[field] === 'number', `safety ${field}`);
    must(typeof value.requires_human_review === 'boolean', 'human review flag');
  };
  const prescription = (value: any) => {
    must(object(value), 'prescription object');
    for (const field of ['total_carb_g', 'total_sodium_mg', 'total_fluid_ml', 'carb_g_per_hr', 'sodium_mg_per_hr', 'fluid_ml_per_hr', 'calculated_at']) must(typeof value[field] === 'number', `prescription ${field}`);
    must(value.calculated_at > 0 && value.calculated_at < 100000000000, 'calculated_at epoch seconds');
  };
  const calculation = (value: any, nested: boolean) => {
    must(object(value) && ['full', 'teaser'].includes(value.tier), 'calculation tier');
    safety(value.safety);
    must(object(value.attribution), 'attribution');
    if (nested && value.tier === 'full') prescription(value.prescription);
    for (const field of ['trial_ends_at', 'trial_calls_remaining_today']) {
      if (field in value) must(typeof value[field] === 'number', field);
    }
    const result = nested && value.tier === 'full' ? value.prescription : value;
    for (const field of ['carb_range_g_per_hr', 'sodium_range_mg_per_hr', 'fluid_range_ml_per_hr']) {
      if (field in result) must(typeof result[field] === 'string', field);
      if (value.tier === 'teaser') must(typeof result[field] === 'string', `teaser ${field}`);
    }
    return { tier: value.tier, banded: typeof result.carb_range_g_per_hr === 'string', trial: value.tier_source === 'trial' };
  };
  const rememberAthlete = (value: any, marker: string) => {
    must(object(value) && typeof value.id === 'string' && value.external_id === marker && value.name === marker && !value.email, 'new athlete ownership');
    ownedAthletes.add(value.id);
    report.created.push({ resource: 'athlete', id: value.id, marker });
    ledger();
    return value.id as string;
  };
  const rememberActivity = (value: any, athleteId: string, marker: string) => {
    must(object(value) && typeof value.id === 'string' && value.athlete_id === athleteId && value.external_id === marker, 'new activity ownership');
    report.created.push({ resource: 'activity', id: value.id, athlete_id: athleteId, marker });
    ledger();
    return value.id as string;
  };
  const stage = (name: string) => { report.stage = name; ledger(); };
  global.fetch = (async (input, init) => {
    const url = new URL(String(input));
    must(url.origin === SANDBOX_BASE && ++report.calls <= 20 && Date.now() < deadline, 'sandbox origin or call/time budget');
    const method = init?.method ?? 'GET';
    const athlete = url.pathname.match(/^\/v1\/athletes\/([^/]+)\//)?.[1];
    must(athlete ? ownedAthletes.has(athlete) : [
      '/v1/athletes', '/v1/athletes/batch', '/v1/nutrition/calculate', '/v1/nutrition/calculate/batch',
    ].includes(url.pathname), 'owned resource path');
    must(['GET', 'POST', 'PATCH'].includes(method) && !(method === 'GET' && url.pathname === '/v1/athletes'), 'permitted operation');
    return originalFetch(input, { ...init, redirect: 'error' });
  }) as typeof fetch;
  const client = new Saturday(config);
  const settings = {
    sweat_level: 5, saltiness: 5, satiety_level: 5, fitness_level: 5,
    carb_experience: 'range_40_60' as const, usual_carb_consumption: 'range_60_80' as const,
    muscle_cramps: false, gut_distress: false, performance: false, hunger: false,
    heat_tolerance: false, faintness: false, drinking_resistance: false, thirst: false,
  };
  try {
    stage('create athlete');
    const athleteId = rememberAthlete(await client.athletes.create({ name: runId, external_id: runId, sex: 'intersex', year_of_birth: 1990, weight_kg: 75, settings }), runId);
    stage('read settings');
    const storedSettings = await client.athletes.getSettings(athleteId);
    must(storedSettings.sweat_level === 5 && !('concerns' in storedSettings), 'flat settings');
    stage('replace own settings');
    const updated = await client.athletes.updateSettings(athleteId, { ...settings, gut_distress: true });
    must(updated.gut_distress === true && updated.sweat_level === 5, 'settings replacement response');
    stage('create activity');
    const activityId = rememberActivity(await client.activities.create(athleteId, { type: 'bike', duration_min: 60, intensity_level: 5, thermal_stress_level: 5, meal_before_min: 120, external_id: `${runId}-activity` }), athleteId, `${runId}-activity`);
    stage('calculate activity');
    const envelope = await client.activities.calculatePrescription(athleteId, activityId);
    report.variants.activity = calculation(envelope, true);
    if (envelope.prescription) {
      stage('read stored prescription');
      const stored = await client.activities.getPrescription(athleteId, activityId);
      prescription(stored.prescription); safety(stored.safety);
      must(!('tier' in stored), 'stored wrapper has no tier');
      report.variants.stored = 'verified';
    } else report.variants.stored = 'not available under natural teaser tier';
    stage('calculate nutrition');
    report.variants.nutrition = calculation(await client.nutrition.calculate({ athlete_id: athleteId, activity_type: 'run', duration_min: 45, intensity_level: 5, thermal_stress_level: 5, meal_before_min: 120 }), false);
    for (const mode of ['default', 'global', 'per_item']) {
      stage(`import ${mode}`);
      const marker = `${runId}-${mode}`;
      const item = { type: 'bike' as const, duration_min: 30, external_id: marker, ...(mode === 'per_item' ? { calculate: true } : {}) };
      const options = mode === 'default' ? undefined : { calculate: mode === 'global' };
      const result = await client.activities.importActivities(athleteId, [item], options);
      must(result.total === 1 && result.succeeded === 1 && result.failed === 0 && result.imported.length === 1, 'import summary');
      rememberActivity(result.imported[0], athleteId, marker);
      if (mode === 'default') must(!result.prescriptions?.length && !result.imported[0].prescription, 'default import does not calculate');
      else {
        must(result.prescriptions?.length === 1 && result.prescriptions[0].index === 0 && result.prescriptions[0].activity_id === result.imported[0].id, 'import calculation indexes');
        report.variants[`import_${mode}`] = calculation(result.prescriptions![0].result, true);
      }
    }
    stage('nutrition batch');
    const batch = await client.nutrition.batchCalculate([
      { athlete_id: athleteId, activity_type: 'bike', duration_min: 40 },
      { athlete_id: athleteId, activity_type: 'bike', duration_min: 0 },
    ]);
    must(batch.total === 2 && batch.succeeded === 1 && batch.failed === 1 && batch.results.length === 1 && batch.errors?.[0].index === 1, 'flat partial nutrition batch');
    must(typeof batch.estimated_ms === 'number' && typeof batch.elapsed_ms === 'number', 'batch timing');
    report.variants.batch = calculation(batch.results[0], false);
    stage('athlete batch');
    const batchMarker = `${runId}-batch`;
    const athletes = await client.athletes.batchCreate([{ name: batchMarker, external_id: batchMarker }, {}]);
    must(athletes.total === 2 && athletes.succeeded === 1 && athletes.failed === 1 && athletes.created.length === 1 && athletes.errors?.[0].index === 1, 'flat partial athlete batch');
    rememberAthlete(athletes.created[0], batchMarker);
    stage('scoped activity pagination');
    const page = await client.activities.list(athleteId, { limit: 1 });
    must(Array.isArray(page.activities) && page.activities.every(value => value.athlete_id === athleteId) && page.pagination.total === page.activities.length && typeof page.pagination.has_more === 'boolean' && typeof page.request_id === 'string', 'nested scoped pagination');
    if (page.pagination.has_more) must(typeof page.pagination.next_cursor === 'string', 'next cursor');
    stage('feedback');
    const feedback = await client.activities.submitFeedback(athleteId, activityId, { rating: 4, notes: 'Synthetic SDK contract test' });
    must(feedback.rating === 4 && typeof feedback.created_at === 'number' && !('message' in feedback), 'feedback object');
    report.stage = 'passed';
  } catch (error) {
    report.error = { kind: error instanceof Error ? error.name : 'unknown', ...(error instanceof SaturdayError ? { status: error.status } : {}) };
    throw new Error(`Sandbox contract failed at ${report.stage}; inspect sanitized ledger`);
  } finally {
    global.fetch = originalFetch;
    ledger();
  }
}

it.each(['full', 'teaser'])('rehearses every sandbox step offline for %s tier', async tier => {
  const fixtures = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'contracts.json'), 'utf8'));
  const envelope = tier === 'full' ? fixtures.activity_full : fixtures.activity_teaser;
  const nutrition = tier === 'full' ? fixtures.nutrition_exact : fixtures.nutrition_teaser;
  const activities: any[] = [];
  const calls: string[] = [];
  let athleteId = '';
  let preferences: any = {};
  const original = global.fetch;
  const log = jest.spyOn(console, 'log').mockImplementation(() => {});
  global.fetch = (async (input, init) => {
    const path = new URL(String(input)).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push(`${init?.method} ${path}`);
    expect(init?.redirect).toBe('error');
    let payload: any;
    if (path === '/v1/athletes') {
      expect(body.email).toBeUndefined();
      athleteId = 'owned-athlete'; preferences = body.settings;
      payload = { ...fixtures.athlete, ...body, id: athleteId };
    } else if (path.endsWith('/settings')) {
      if (init?.method === 'PATCH') preferences = body;
      payload = preferences;
    } else if (path === '/v1/nutrition/calculate') payload = nutrition;
    else if (path === '/v1/nutrition/calculate/batch') payload = { ...fixtures.batch_partial, total: 2, succeeded: 1, results: [nutrition] };
    else if (path === '/v1/athletes/batch') {
      expect(body.athletes.every((value: any) => !value.email)).toBe(true);
      payload = { ...fixtures.athletes_partial, created: [{ ...fixtures.athlete, ...body.athletes[0], id: 'owned-batch' }] };
    } else if (path.endsWith('/import')) {
      const item = body.activities[0];
      const activity = { ...fixtures.activity, ...item, id: `owned-activity-${activities.length}`, athlete_id: athleteId };
      delete activity.prescription;
      activities.push(activity);
      payload = { ...fixtures.import_plain, imported: [activity] };
      if (body.calculate || item.calculate) payload.prescriptions = [{ index: 0, activity_id: activity.id, result: envelope }];
    } else if (path.endsWith('/activities') && init?.method === 'POST') {
      payload = { ...fixtures.activity, ...body, id: 'owned-activity', athlete_id: athleteId };
      delete payload.prescription; activities.push(payload);
    } else if (path.endsWith('/activities')) {
      payload = { activities: activities.slice(0, 1), pagination: { total: 1, has_more: true, next_cursor: '1700000000' }, request_id: 'fixture' };
    } else if (path.endsWith('/calculate')) payload = envelope;
    else if (path.endsWith('/prescription')) payload = fixtures.stored_exact;
    else if (path.endsWith('/feedback')) payload = fixtures.feedback;
    else throw new Error('Unexpected offline sandbox path');
    return Response.json(payload);
  }) as typeof fetch;
  try {
    await runSandboxContract(sandboxConfig({ [OPT_IN]: '1', SATURDAY_SANDBOX_BASE_URL: SANDBOX_BASE, SATURDAY_SANDBOX_API_KEY: 'sk_test_fake' })!);
    expect(calls).toHaveLength(tier === 'full' ? 14 : 13);
    const report = JSON.parse(log.mock.calls[log.mock.calls.length - 1][0].replace('SATURDAY_SANDBOX_LEDGER ', ''));
    expect(report.stage).toBe('passed');
    expect(report.created).toHaveLength(6);
    expect(JSON.stringify(report)).not.toContain('sk_test_fake');
    expect(report.variants.stored).toBe(tier === 'full' ? 'verified' : 'not available under natural teaser tier');
  } finally {
    global.fetch = original;
    log.mockRestore();
  }
});

const sandboxTest = process.env[OPT_IN] === '1' ? it : it.skip;
sandboxTest('checks live sandbox contracts using new synthetic records only', async () => {
  await runSandboxContract(sandboxConfig(process.env)!);
}, 390000);
