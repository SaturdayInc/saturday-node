// Runs every partner method against a real Saturday API: a local build or the test project.
// Skipped unless SATURDAY_LIVE_BASE_URL and SATURDAY_LIVE_API_KEY (an sk_test_ key) are set.
// test/LIVE.md says how to run it and what it creates.
import { randomUUID } from 'crypto';
import { writeFileSync } from 'fs';
import {
  Saturday, NotFoundError, PermissionError, ValidationError,
  type Athlete, type NutritionCalculateResponse, type PrepResponse,
} from '../src';

const BASE = process.env.SATURDAY_LIVE_BASE_URL;
const KEY = process.env.SATURDAY_LIVE_API_KEY;
const CAPTURE = process.env.SATURDAY_LIVE_CAPTURE;
const enabled = Boolean(BASE && KEY);

if (enabled && !KEY!.startsWith('sk_test_')) throw new Error('SATURDAY_LIVE_API_KEY must be a test key (sk_test_)');

const describeLive = enabled ? describe : describe.skip;

/** Every response, by name, with the SDK type it must satisfy; test/live-types.test.ts type-checks them. */
const captured: Record<string, { type: string; body: unknown }> = {};
function capture<R>(name: string, type: string, body: R): R {
  expectSeconds(name, body);
  captured[name] = { type, body: scrub(body) };
  return body;
}

/** Unix seconds stay below this until the year 5138; a time in milliseconds today is about 1.8e12. */
const MILLISECOND_SIZED = 1e11;

/** Every time a partner key receives is Unix seconds: no `*_at`, `*_date` or `timestamp` number at any depth is millisecond-sized. */
function expectSeconds(name: string, value: unknown, path = ''): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => expectSeconds(name, item, `${path}[${i}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'number' && /(_at|_date|^timestamp)$/.test(key) && item >= MILLISECOND_SIZED) {
      throw new Error(`${name}: ${path}.${key} is ${item}, a time in milliseconds`);
    }
    expectSeconds(name, item, `${path}.${key}`);
  }
}

/** A webhook delivery's event body, decoded from its base64 `event_data`. */
function deliveredEvent(eventData: string | undefined): { id: string; type: string; created_at: number; data: Record<string, unknown> } {
  return JSON.parse(Buffer.from(eventData ?? '', 'base64').toString('utf8'));
}

/** Keys, secrets, signed links and the partner's own details never go into the capture file. */
function scrub(value: unknown, key = ''): unknown {
  if (Array.isArray(value)) return value.map(item => scrub(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v, k)]));
  }
  if (typeof value !== 'string') return value;
  if (key === 'secret') return 'whsec_example';
  if (key === 'key') return 'sk_test_example';
  if (key === 'contact_email') return 'partner@example.com';
  if (key === 'partner_id' || (key === 'id' && value.startsWith('partner_'))) return 'partner_example';
  if (key === 'ip_address') return '192.0.2.1';
  return value.replace(/([?&]ot=)[^&\s"]+/g, '$1example').replace(/sk_(test|live)_[A-Za-z0-9]+/g, 'sk_$1_example')
    .replace(/([?&]ref=)partner_[A-Za-z0-9_]+/g, '$1partner_example');
}

async function refusal(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(() => { throw new Error('expected the API to refuse this request'); }, (error: unknown) => error);
}

const COMPLETE = {
  sex: 'female' as const,
  year_of_birth: 1990,
  weight_kg: 62,
  settings: {
    sweat_level: 5, saltiness: 5, satiety_level: 5, fitness_level: 5,
    carb_experience: 'range_40_60' as const, usual_carb_consumption: 'range_60_80' as const,
    performance: true, concerns_answered: true,
  },
};

const session = { intensity_level: 5, thermal_stress_level: 5, meal_before_min: 120, is_race: false };

function exact(plan: NutritionCalculateResponse) {
  expect(plan.precision?.profile_complete).toBe(true);
  for (const value of [plan.carb_g_per_hr, plan.sodium_mg_per_hr, plan.fluid_ml_per_hr]) {
    expect(Number.isInteger(value ?? 0)).toBe(true);
  }
  expect(plan.safety.not_instructions).toBe(true);
  expect(plan.attribution.required).toBe(true);
}

/** Prep's top level on a brick is its legs added up: each product once with its servings summed, the totals and gap the legs' sums. */
function expectLegsAddUp(prep: PrepResponse) {
  const legs = prep.legs!;
  for (const key of ['carb_g', 'sodium_mg', 'fluid_ml'] as const) {
    expect(prep.totals_from_products[key]).toBe(legs.reduce((sum, leg) => sum + leg.totals_from_products[key], 0));
    expect(prep.remaining_gap[key]).toBe(legs.reduce((sum, leg) => sum + leg.remaining_gap[key], 0));
  }
  const ids = prep.products.map(p => p.product_id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const product of prep.products) {
    const servings = legs.reduce((sum, leg) => sum + (leg.products.find(p => p.product_id === product.product_id)?.servings ?? 0), 0);
    expect(product.servings).toBeCloseTo(servings, 6);
  }
}

describeLive('live API', () => {
  jest.setTimeout(180000);
  const saturday = new Saturday({ apiKey: KEY ?? '', baseUrl: BASE, maxRetries: 0, timeout: 60000 });
  const run = `sdk-node-${randomUUID().slice(0, 8)}`;
  let complete: Athlete;
  let partial: Athlete;

  afterAll(() => {
    if (CAPTURE) writeFileSync(CAPTURE, JSON.stringify(captured, null, 2) + '\n');
  });

  it('meta: discovery, error catalog, health', async () => {
    const discovery = capture('discovery', 'DiscoveryResponse', await saturday.meta.discovery());
    expect(discovery.links.athletes).toBe('/v1/athletes');
    const catalog = capture('errors', 'ErrorCatalogResponse', await saturday.meta.errors());
    expect(catalog.errors.map(e => e.code)).toContain('unsupported_field');
    capture('health', 'HealthResponse', await saturday.meta.health());
  });

  it('reference: activity types, settings schema, onboarding questions', async () => {
    const types = capture('activity_types', 'ActivityTypesResponse', await saturday.reference.activityTypes());
    expect(types.activity_types.map(t => t.id)).toEqual(expect.arrayContaining(['bike', 'run', 'swim']));
    expect(types.linked_session_types?.map(t => t.id)).toEqual(['brick', 'triathlon']);
    expect(types.linked_session_types?.[0]).toMatchObject({ min_legs: 2, max_legs: 10, min_leg_duration_min: 5, max_duration_min: 2160 });
    const brickOnly = capture('activity_types_filtered', 'ActivityTypesResponse', await saturday.reference.activityTypes({ activityType: 'brick' }));
    expect(brickOnly.activity_types).toEqual([]);
    expect(brickOnly.linked_session_types?.map(t => t.id)).toEqual(['brick']);
    capture('settings_schema', 'SettingsSchemaResponse', await saturday.reference.settingsSchema());
    const questions = capture('onboarding_questions', 'OnboardingQuestionsResponse', await saturday.onboarding.questions());
    expect(questions.questions.length).toBeGreaterThan(0);
  });

  it('athletes: create, get, find by external_id, update, settings, fueling profile, batch', async () => {
    complete = capture('athlete', 'Athlete', await saturday.athletes.create({ external_id: `${run}-a`, ...COMPLETE }));
    expect(complete.profile_complete).toBe(true);
    partial = await saturday.athletes.create({ external_id: `${run}-b`, weight_kg: 70 });
    expect(partial.profile_complete).toBe(false);

    capture('athlete_get', 'Athlete', await saturday.athletes.get(complete.id));
    const found = capture('athlete_list', 'AthleteListResponse', await saturday.athletes.list({ externalId: `${run}-a` }));
    expect(found.athletes.map(a => a.id)).toEqual([complete.id]);
    const renamed = await saturday.athletes.update(complete.id, { name: 'Live Suite' });
    expect(renamed.name).toBe('Live Suite');

    capture('settings', 'AthleteSettings', await saturday.athletes.getSettings(complete.id));
    const settings = await saturday.athletes.updateSettings(complete.id, { ...COMPLETE.settings, sweat_level: 6 });
    expect(settings.sweat_level).toBe(6);

    const fueling = capture('fueling_profile', 'FuelingProfile', await saturday.athletes.getFuelingProfile(complete.id));
    expect(fueling.sharing).toBe('not_linked');

    const batch = capture('athletes_batch', 'BatchAthleteResponse',
      await saturday.athletes.batchCreate([{ external_id: `${run}-c` }, { sex: 'female' }]));
    expect(batch.succeeded).toBe(1);
    expect(batch.errors?.[0].index).toBe(1);
    await saturday.athletes.erase(batch.created[0].id);
  });

  it('nutrition.calculate: exact for a complete profile, ranges with what is missing for a partial one', async () => {
    const fed = capture('calculate_exact', 'NutritionCalculateResponse', await saturday.nutrition.calculate({
      athlete_id: complete.id, activity_type: 'run', duration_min: 60, ...session,
    }));
    exact(fed);

    const fasted = await saturday.nutrition.calculate({
      athlete_id: complete.id, activity_type: 'run', duration_min: 60, ...session, meal_before_min: 240,
    });
    exact(fasted);
    // A fasted start adds a 20-minute pre-load, so its per-hour figure is spread over 80 minutes.
    expect(Math.abs(fasted.carb_g_per_hr! - fasted.total_carb_g! * 60 / 80)).toBeLessThanOrEqual(1);

    const evenEffort = await saturday.nutrition.calculate({
      athlete_id: complete.id, activity_type: 'bike', duration_min: 120, ...session, intensity_level: 4, is_race: true,
    });
    exact(evenEffort);

    const ranges = capture('calculate_ranges', 'NutritionCalculateResponse', await saturday.nutrition.calculate({
      athlete_id: partial.id, activity_type: 'bike', duration_min: 120, ...session,
    }));
    expect(ranges.precision?.profile_complete).toBe(false);
    expect(ranges.carb_range_g_per_hr).toMatch(/^\d+-\d+$/);
    expect(ranges.precision?.missing_fields?.[0].band_impact).toBeDefined();
    expect(ranges.precision?.onboarding?.url).toMatch(/^https:\/\//);

    capture('calculate_teaser', 'NutritionCalculateResponse',
      await saturday.nutrition.calculate({ activity_type: 'bike', duration_min: 120 }));

    const misnamed = await refusal(saturday.nutrition.calculate({
      athlete_id: complete.id, activity_type: 'bike', duration_min: 60, is_race_event: true,
    } as never));
    expect(misnamed).toBeInstanceOf(ValidationError);
    expect((misnamed as ValidationError).code).toBe('unsupported_field');
    expect((misnamed as ValidationError).param).toBe('is_race_event');
    expect((misnamed as ValidationError).suggestion).toBe('is_race');

    const typo = await refusal(saturday.nutrition.calculate({
      athlete_id: complete.id, activity_type: 'bike', duration_min: 60, ...session, meal_before_mins: 120,
    } as never));
    expect((typo as ValidationError).code).toBe('unsupported_field');
    expect((typo as ValidationError).param).toBe('meal_before_mins');
    expect((typo as ValidationError).suggestion).toBe('meal_before_min');

    // A session input left out still computes, but the answer is ranges and the message says which input to send.
    const noRace = await saturday.nutrition.calculate({
      athlete_id: complete.id, activity_type: 'run', duration_min: 60, intensity_level: 5, thermal_stress_level: 5, meal_before_min: 120,
    });
    expect(noRace.precision?.profile_complete).toBe(false);
    expect(noRace.precision?.missing_fields?.map(f => f.field)).toEqual(['is_race']);
    expect(noRace.precision?.message).toContain('is_race');
    expect(noRace.precision?.onboarding).toBeUndefined();

    const batch = capture('calculate_batch', 'BatchCalculateResponse', await saturday.nutrition.batchCalculate([
      { athlete_id: complete.id, activity_type: 'bike', duration_min: 90, ...session },
      { activity_type: 'nope' as never, duration_min: 5 },
    ]));
    expect(batch.succeeded).toBe(1);
    expect(batch.errors?.[0]).toMatchObject({ index: 1, code: 'invalid_value' });
  });

  it('activities: create, refuse misnamed fields, list, update, calculate, stored prescription, prep, feedback, import', async () => {
    const misnamed = await refusal(saturday.activities.create(complete.id, { activity_type: 'bike', duration_min: 60 } as never));
    expect((misnamed as ValidationError).code).toBe('unsupported_field');

    const activity = capture('activity', 'Activity', await saturday.activities.create(complete.id, {
      type: 'bike', duration_min: 150, intensity_level: 6, thermal_stress_level: 6, is_race_event: false, meal_before_min: 120, external_id: `${run}-w1`,
    }));
    capture('activity_get', 'Activity', await saturday.activities.get(complete.id, activity.id));
    const page = capture('activity_list', 'ActivityListResponse', await saturday.activities.list(complete.id, { limit: 10 }));
    expect(page.activities.map(a => a.id)).toContain(activity.id);
    const updated = await saturday.activities.update(complete.id, activity.id, { duration_min: 160 });
    expect(updated.duration_min).toBe(160);

    const notYet = await refusal(saturday.activities.getPrescription(complete.id, activity.id));
    expect(notYet).toBeInstanceOf(NotFoundError);

    const calculated = capture('activity_calculate', 'PrescriptionEnvelope', await saturday.activities.calculatePrescription(complete.id, activity.id));
    expect(calculated.tier).toBe('full');
    expect(calculated.prescription?.total_carb_g).toBeGreaterThan(0);
    const stored = capture('activity_prescription', 'StoredPrescriptionResponse', await saturday.activities.getPrescription(complete.id, activity.id));
    expect(stored.prescription.total_carb_g).toBe(calculated.prescription!.total_carb_g);

    const prep = capture('prep', 'PrepResponse', await saturday.activities.prep(complete.id, activity.id, {
      products: [{ product_query: 'maurten gel 100', servings: 2 }, { product_query: 'tailwind endurance fuel' }],
    }));
    expect(prep.prescription.carb_g).toBe(stored.prescription.total_carb_g);
    expect(prep.products.map(p => p.servings)[0]).toBe(2);

    capture('feedback', 'ActivityFeedback', await saturday.activities.submitFeedback(complete.id, activity.id, { rating: 4, notes: 'live suite' }));

    const imported = capture('activity_import', 'ActivityImportResponse', await saturday.activities.importActivities(complete.id, [
      { type: 'run', duration_min: 45, intensity_level: 5, thermal_stress_level: 4, meal_before_min: 120, is_race_event: false, external_id: `${run}-i1` },
    ], { calculate: true }));
    expect(imported.prescriptions?.[0].result?.tier).toBe('full');

    await saturday.activities.delete(complete.id, activity.id);
    expect(await refusal(saturday.activities.get(complete.id, activity.id))).toBeInstanceOf(NotFoundError);
  });

  it('bricks and triathlons: one session with legs through calculate, batch, activities, PATCH, prep and import', async () => {
    // A subscribed athlete, so this block's calculations do not run into the trial's daily allowance.
    const athlete = await saturday.athletes.create({ external_id: `${run}-linked`, ...COMPLETE });
    await saturday.testing.simulateSubscription(athlete.id);
    const brickLegs = [
      { activity_type: 'bike' as const, duration_min: 90, intensity_level: 6, thermal_stress_level: 6 },
      { activity_type: 'run' as const, duration_min: 30, intensity_level: 7, thermal_stress_level: 6 },
    ];
    const brick = capture('calculate_brick', 'NutritionCalculateResponse', await saturday.nutrition.calculate({
      athlete_id: athlete.id, activity_type: 'brick', legs: brickLegs, meal_before_min: 120, is_race: false,
    }));
    exact(brick);
    expect(brick.legs?.map(l => l.duration_min)).toEqual([90, 30]);
    // The legs share out the session's totals.
    const legCarbs = brick.legs!.reduce((sum, leg) => sum + leg.total_carb_g, 0);
    expect(Math.abs(legCarbs - brick.total_carb_g!)).toBeLessThanOrEqual(brick.legs!.length);

    // A brick is one call with legs: its legs sent as separate calls answer differently.
    let separate = 0;
    for (const leg of brickLegs) {
      const single = await saturday.nutrition.calculate({ athlete_id: athlete.id, ...leg, meal_before_min: 120, is_race: false });
      separate += single.total_carb_g ?? 0;
    }
    expect(brick.total_carb_g!).not.toBe(separate);

    const triathlon = capture('calculate_triathlon', 'NutritionCalculateResponse', await saturday.nutrition.calculate({
      athlete_id: athlete.id, activity_type: 'triathlon', duration_min: 150, is_race: true, meal_before_min: 240, legs: [
        { activity_type: 'swim', duration_min: 30, intensity_level: 7, thermal_stress_level: 3 },
        { activity_type: 'bike', duration_min: 80, intensity_level: 7, thermal_stress_level: 6 },
        { activity_type: 'run', duration_min: 40, intensity_level: 7, thermal_stress_level: 7 },
      ],
    }));
    exact(triathlon);
    expect(triathlon.legs).toHaveLength(3);

    const noLegs = await refusal(saturday.nutrition.calculate({ athlete_id: athlete.id, activity_type: 'brick', ...session } as never));
    expect(noLegs).toBeInstanceOf(ValidationError);
    expect((noLegs as ValidationError).param).toBe('legs');
    const topLevelEffort = await refusal(saturday.nutrition.calculate({
      athlete_id: athlete.id, activity_type: 'brick', legs: brickLegs, intensity_level: 5,
    } as never));
    expect((topLevelEffort as ValidationError).param).toBe('intensity_level');
    const legTypo = await refusal(saturday.nutrition.calculate({
      athlete_id: athlete.id, activity_type: 'brick', meal_before_min: 120, is_race: false,
      legs: [brickLegs[0], { activity_type: 'run', duration_mins: 30, intensity_level: 7, thermal_stress_level: 6 }],
    } as never));
    expect((legTypo as ValidationError).code).toBe('unsupported_field');
    expect((legTypo as ValidationError).param).toBe('legs[1].duration_mins');
    expect((legTypo as ValidationError).suggestion).toBe('duration_min');

    const batch = await saturday.nutrition.batchCalculate([
      { athlete_id: athlete.id, activity_type: 'brick', legs: brickLegs, meal_before_min: 120, is_race: false },
      { athlete_id: athlete.id, activity_type: 'bike', duration_min: 90, ...session },
    ]);
    expect(batch.succeeded).toBe(2);
    expect(batch.results[0].total_carb_g).toBe(brick.total_carb_g);
    expect(batch.results[0].legs).toEqual(brick.legs);

    const activityLegs = brickLegs.map(({ activity_type, ...leg }) => ({ type: activity_type, ...leg }));
    const stored = capture('activity_brick', 'Activity', await saturday.activities.create(athlete.id, {
      type: 'brick', legs: activityLegs, meal_before_min: 120, is_race_event: false, external_id: `${run}-brick`,
    }));
    expect(stored.type).toBe('brick');
    expect(stored.duration_min).toBe(120);
    expect(stored.legs).toEqual(activityLegs);
    expect(stored.intensity_level).toBeUndefined();

    // Prep plans a linked activity that has not been calculated yet.
    const prepFirst = await saturday.activities.prep(athlete.id, stored.id, { products: [{ product_query: 'maurten gel 100' }] });
    expect(prepFirst.prescription.carb_g).toBe(brick.total_carb_g);

    const calculated = capture('activity_calculate_brick', 'PrescriptionEnvelope',
      await saturday.activities.calculatePrescription(athlete.id, stored.id));
    expect(calculated.prescription?.total_carb_g).toBe(brick.total_carb_g);
    expect(calculated.prescription?.legs).toEqual(brick.legs);
    const read = capture('activity_prescription_brick', 'StoredPrescriptionResponse', await saturday.activities.getPrescription(athlete.id, stored.id));
    expect(read.prescription.legs).toEqual(brick.legs);
    const prep = capture('prep_brick', 'PrepResponse', await saturday.activities.prep(athlete.id, stored.id, {
      products: [{ product_query: 'maurten gel 100', servings: 3 }, { product_query: 'tailwind endurance fuel' }],
    }));
    expect(prep.prescription.carb_g).toBe(brick.total_carb_g);
    expect(prep.plan_basis).toBeUndefined();
    // One session-wide list is sized against each leg's share, its servings counting per leg; the top level is the legs added up.
    expect(prep.legs?.map(l => l.activity_type)).toEqual(['bike', 'run']);
    expect(prep.legs!.map(l => l.prescription.carb_g)).toEqual(brick.legs!.map(l => l.total_carb_g));
    const gelId = prep.products.find(p => p.product_name.includes('Gel'))!.product_id;
    for (const leg of prep.legs!) expect(leg.products.find(p => p.product_id === gelId)?.servings).toBe(3);
    expectLegsAddUp(prep);

    const perLeg = capture('prep_brick_per_leg', 'PrepResponse', await saturday.activities.prep(athlete.id, stored.id, {
      legs: [{ products: [{ product_query: 'tailwind endurance fuel' }] }, { products: [{ product_query: 'maurten gel 100', servings: 2 }] }],
    }));
    expect(perLeg.legs?.[0].products.map(p => p.product_id)).not.toContain(gelId);
    expect(perLeg.legs?.[1].products.map(p => [p.product_id, p.servings])).toEqual([[gelId, 2]]);
    expect(perLeg.products).toHaveLength(2);
    expectLegsAddUp(perLeg);
    const wrongCount = await refusal(saturday.activities.prep(athlete.id, stored.id, { legs: [{ products: [] }] }));
    expect((wrongCount as ValidationError).code).toBe('invalid_value');
    expect((wrongCount as ValidationError).param).toBe('legs');

    // Fit and compare size the whole session at the top level and each leg's share under legs.
    const brickFit = capture('product_fit_brick', 'ProductFitResponse', await saturday.nutrition.productFit({
      athlete_id: athlete.id, product_query: 'maurten gel 100', activity_type: 'brick', legs: brickLegs, meal_before_min: 120, is_race: false,
    }));
    expect(brickFit.tier).toBe('full');
    expect(brickFit.plan_basis).toBeUndefined();
    expect(brickFit.prescription?.carb_g).toBe(brick.total_carb_g);
    expect(brickFit.legs?.map(l => [l.activity_type, l.duration_min])).toEqual([['bike', 90], ['run', 30]]);
    expect(brickFit.legs!.map(l => l.prescription.carb_g)).toEqual(brick.legs!.map(l => l.total_carb_g));
    for (const leg of brickFit.legs!) expect(leg.fit.product_id).toBe(gelId);
    const triLegs = [
      { activity_type: 'swim' as const, duration_min: 30, intensity_level: 7, thermal_stress_level: 3 },
      { activity_type: 'bike' as const, duration_min: 80, intensity_level: 7, thermal_stress_level: 6 },
      { activity_type: 'run' as const, duration_min: 40, intensity_level: 7, thermal_stress_level: 7 },
    ];
    const triFit = await saturday.nutrition.productFit({
      athlete_id: athlete.id, product_query: 'tailwind endurance fuel', activity_type: 'triathlon', legs: triLegs, duration_min: 150, meal_before_min: 240, is_race: true,
    });
    expect(triFit.prescription?.carb_g).toBe(triathlon.total_carb_g);
    expect(triFit.legs!.map(l => l.prescription.carb_g)).toEqual(triathlon.legs!.map(l => l.total_carb_g));
    const triCompare = capture('product_compare_triathlon', 'ProductCompareResponse', await saturday.nutrition.compareProducts({
      athlete_id: athlete.id, product_a: { product_query: 'maurten gel 100' }, product_b: { product_query: 'tailwind endurance fuel' },
      activity_type: 'triathlon', legs: triLegs, meal_before_min: 240, is_race: true,
    }));
    expect(triCompare.legs).toHaveLength(3);
    for (const leg of triCompare.legs!) expect(['product_a', 'product_b']).toContain(leg.winner.overall);
    const brickCompare = await saturday.nutrition.compareProducts({
      athlete_id: athlete.id, product_a: { product_query: 'maurten gel 100' }, product_b: { product_query: 'tailwind endurance fuel' },
      activity_type: 'brick', legs: brickLegs, meal_before_min: 120, is_race: false,
    });
    expect(brickCompare.legs!.map(l => l.product_a.product_id)).toEqual([gelId, gelId]);

    // Each refusal names its field.
    const fitNoLegs = await refusal(saturday.nutrition.productFit({
      athlete_id: athlete.id, product_query: 'maurten gel 100', activity_type: 'brick', duration_min: 120, ...session,
    } as never));
    expect((fitNoLegs as ValidationError).param).toBe('legs');
    const fitLegsOnRun = await refusal(saturday.nutrition.productFit({
      athlete_id: athlete.id, product_query: 'maurten gel 100', activity_type: 'run', duration_min: 120, legs: brickLegs, ...session,
    } as never));
    expect((fitLegsOnRun as ValidationError).param).toBe('legs');
    const fitWrongTotal = await refusal(saturday.nutrition.productFit({
      athlete_id: athlete.id, product_query: 'maurten gel 100', activity_type: 'brick', legs: brickLegs, duration_min: 100, meal_before_min: 120, is_race: false,
    }));
    expect((fitWrongTotal as ValidationError).param).toBe('duration_min');
    const compareNoSport = await refusal(saturday.nutrition.compareProducts({
      athlete_id: athlete.id, product_a: { product_query: 'maurten gel 100' }, product_b: { product_query: 'tailwind endurance fuel' }, duration_min: 60,
    } as never));
    expect((compareNoSport as ValidationError).code).toBe('missing_field');
    expect((compareNoSport as ValidationError).param).toBe('activity_type');

    // A brick's minutes, effort and heat live on its legs.
    const minutes = await refusal(saturday.activities.update(athlete.id, stored.id, { duration_min: 150 }));
    expect((minutes as ValidationError).param).toBe('duration_min');
    const longer = await saturday.activities.update(athlete.id, stored.id, {
      legs: [activityLegs[0], { ...activityLegs[1], duration_min: 45 }],
    });
    expect(longer.duration_min).toBe(135);
    const recalculated = await saturday.activities.calculatePrescription(athlete.id, stored.id);
    expect(recalculated.prescription!.total_carb_g!).toBeGreaterThan(brick.total_carb_g!);

    // A single sport drops the legs; turning it back into a session with legs needs legs.
    const single = await saturday.activities.update(athlete.id, stored.id, { type: 'run', duration_min: 60, intensity_level: 5, thermal_stress_level: 5 });
    expect(single.type).toBe('run');
    expect(single.legs).toBeUndefined();
    const legsOnSingle = await refusal(saturday.activities.prep(athlete.id, stored.id, { legs: [{ products: [] }, { products: [] }] }));
    expect((legsOnSingle as ValidationError).code).toBe('invalid_value');
    expect((legsOnSingle as ValidationError).param).toBe('legs');
    const needsLegs = await refusal(saturday.activities.update(athlete.id, stored.id, { type: 'triathlon' }));
    expect((needsLegs as ValidationError).param).toBe('legs');
    const tri = await saturday.activities.update(athlete.id, stored.id, {
      type: 'triathlon', legs: [
        { type: 'swim', duration_min: 20, intensity_level: 6, thermal_stress_level: 3 },
        { type: 'bike', duration_min: 40, intensity_level: 6, thermal_stress_level: 5 },
        { type: 'run', duration_min: 20, intensity_level: 6, thermal_stress_level: 5 },
      ],
    });
    expect(tri.type).toBe('triathlon');
    expect(tri.duration_min).toBe(80);
    expect(tri.intensity_level).toBeUndefined();
    await saturday.activities.delete(athlete.id, stored.id);

    const imported = capture('activity_import_brick', 'ActivityImportResponse', await saturday.activities.importActivities(athlete.id, [
      { type: 'brick', legs: activityLegs, meal_before_min: 120, is_race_event: false, external_id: `${run}-i-brick` },
    ], { calculate: true }));
    expect(imported.imported[0].legs).toEqual(activityLegs);
    expect(imported.prescriptions?.[0].result?.prescription?.legs).toEqual(brick.legs);
    await saturday.athletes.erase(athlete.id);
  });

  it('product fit and compare size for the athlete; a partial profile plans from the middle of its ranges', async () => {
    const fit = capture('product_fit', 'ProductFitResponse', await saturday.nutrition.productFit({
      athlete_id: complete.id, product_query: 'maurten gel 100', activity_type: 'run', duration_min: 90, ...session,
    }));
    expect(fit.tier).toBe('full');
    expect(fit.fit?.max_servings).toBeGreaterThan(0);
    expect(fit.plan_basis).toBeUndefined();

    const banded = capture('product_fit_plan_basis', 'ProductFitResponse', await saturday.nutrition.productFit({
      athlete_id: partial.id, product_query: 'tailwind endurance fuel', activity_type: 'bike', duration_min: 120, ...session,
    }));
    expect(banded.plan_basis?.source).toBe('profile_incomplete');
    expect(banded.plan_basis?.missing_profile_fields?.length).toBeGreaterThan(0);
    expect(banded.plan_basis?.missing_session_inputs).toBeUndefined();
    expect(banded.plan_basis?.onboarding?.url).toMatch(/^https:\/\//);

    const sessionGaps = capture('product_fit_session_inputs', 'ProductFitResponse', await saturday.nutrition.productFit({
      athlete_id: complete.id, product_query: 'maurten gel 100', activity_type: 'run', duration_min: 90, intensity_level: 5, thermal_stress_level: 5,
    }));
    expect(sessionGaps.plan_basis?.source).toBe('session_incomplete');
    expect(sessionGaps.plan_basis?.missing_session_inputs).toEqual(['meal_before_min', 'is_race']);
    expect(sessionGaps.plan_basis?.onboarding).toBeUndefined();

    const fitTypo = await refusal(saturday.nutrition.productFit({
      athlete_id: complete.id, product_query: 'maurten gel 100', activity_type: 'run', duration_min: 90, ...session, is_rac: true,
    } as never));
    expect((fitTypo as ValidationError).code).toBe('unsupported_field');
    expect((fitTypo as ValidationError).suggestion).toBe('is_race');

    const compare = capture('product_compare', 'ProductCompareResponse', await saturday.nutrition.compareProducts({
      athlete_id: complete.id, product_a: { product_query: 'maurten gel 100' }, product_b: { product_query: 'tailwind endurance fuel' },
      activity_type: 'bike', duration_min: 180, ...session,
    }));
    expect(['product_a', 'product_b']).toContain(compare.winner?.overall);

    const unknownProduct = await refusal(saturday.nutrition.productFit({
      athlete_id: complete.id, product_query: 'no such product zzz', activity_type: 'run', duration_min: 60,
    }));
    expect((unknownProduct as NotFoundError).code).toBe('product_not_found');
  });

  it('testing.simulateSubscription gives the full tier on the test project', async () => {
    const simulated = capture('simulate_subscription', 'SimulateSubscriptionResponse', await saturday.testing.simulateSubscription(partial.id));
    expect(simulated.simulated_active).toBe(true);
    const off = await saturday.testing.simulateSubscription(partial.id, false);
    expect(off.simulated_active).toBe(false);
  });

  it('partner: account, usage, API keys', async () => {
    const account = capture('partner', 'PartnerAccount', await saturday.partner.get());
    expect(account.rate_limits.requests_per_day).toBeGreaterThan(0);
    const usage = capture('usage', 'UsageResponse', await saturday.partner.usage());
    // Usage counts the routes you called, by path.
    expect(Object.keys(usage.by_endpoint).length).toBeGreaterThan(0);
    for (const endpoint of Object.keys(usage.by_endpoint)) expect(endpoint).toMatch(/^\/v1\//);
    capture('usage_daily', 'DailyUsageResponse', await saturday.partner.usageDaily());
    capture('api_keys', 'ApiKeyListResponse', await saturday.partner.listApiKeys());
    const created = capture('api_key_created', 'CreatedApiKey', await saturday.partner.createApiKey(`${run}-key`));
    expect(created.key.startsWith('sk_test_')).toBe(true);
    const rotated = capture('api_key_rotated', 'RotatedApiKey', await saturday.partner.rotateApiKey(created.id));
    expect(rotated.rotated_from).toBe(created.id);
    await saturday.partner.revokeApiKey(rotated.id);
  });

  it('webhooks: create, get, test, deliveries, update, delete; every event time is Unix seconds', async () => {
    const created = capture('webhook_created', 'WebhookCreateResponse',
      await saturday.webhooks.create('https://example.com/saturday-live-suite', ['prescription.calculated']));
    expect(created.webhook.secret.length).toBeGreaterThan(20);
    const id = created.webhook.id;
    capture('webhook_list', 'WebhookListResponse', await saturday.webhooks.list());
    capture('webhook', 'Webhook', await saturday.webhooks.get(id));

    // example.com answers 405, so each delivery is recorded as failed, its event body kept in event_data.
    const tested = capture('webhook_test', 'WebhookTestResponse', await saturday.webhooks.test(id));
    const testEvent = deliveredEvent(tested.delivery.event_data);
    expect(testEvent.type).toBe('webhook.test');
    expectSeconds('webhook.test event', testEvent);
    expect(Math.abs(testEvent.created_at - Date.now() / 1000)).toBeLessThan(600);

    await saturday.nutrition.calculate({ athlete_id: complete.id, activity_type: 'run', duration_min: 60, ...session });
    let calculatedEvent: ReturnType<typeof deliveredEvent> | undefined;
    for (let attempt = 0; attempt < 20 && !calculatedEvent; attempt++) {
      const { deliveries } = await saturday.webhooks.listDeliveries(id);
      const delivery = deliveries.find(d => d.event_type === 'prescription.calculated');
      if (delivery?.event_data) calculatedEvent = deliveredEvent(delivery.event_data);
      else await new Promise(resolve => setTimeout(resolve, 500));
    }
    expect(calculatedEvent?.data.athlete_id).toBe(complete.id);
    expectSeconds('prescription.calculated event', calculatedEvent);
    expect(Math.abs(calculatedEvent!.created_at - Date.now() / 1000)).toBeLessThan(600);

    const paused = await saturday.webhooks.update(id, { active: false });
    expect(paused.active).toBe(false);
    capture('webhook_deliveries', 'WebhookDeliveryList', await saturday.webhooks.listDeliveries(id));
    await saturday.webhooks.delete(id);
    expect(await refusal(saturday.webhooks.get(id))).toBeInstanceOf(NotFoundError);
  });

  it('organizations: create, update, members, offer, subscriptions', async () => {
    const org = capture('organization', 'Organization', await saturday.organizations.create({ display_name: `${run} team`, sport: 'triathlon' }));
    capture('organization_list', 'OrganizationListResponse', await saturday.organizations.list());
    const updated = await saturday.organizations.update(org.id, { description: 'Live suite' });
    expect(updated.description).toBe('Live suite');
    const member = capture('organization_member', 'OrganizationMember',
      await saturday.organizations.addMember(org.id, { email: `${run}@example.com`, role: 'member', athlete_id: complete.id }));
    capture('organization_members', 'OrganizationMembersResponse', await saturday.organizations.listMembers(org.id));
    await saturday.organizations.removeMember(org.id, member.id);

    const offer = capture('organization_offer', 'OrganizationOffer', await saturday.organizations.setOffer(org.id, { discount_percent: 10 }));
    expect(offer.discount_percent).toBe(10);
    capture('organization_offer_get', 'OrganizationOffer', await saturday.organizations.getOffer(org.id));
    await saturday.organizations.deleteOffer(org.id);

    capture('organization_subscriptions', 'OrganizationSubscriptionListResponse', await saturday.organizations.listSubscriptions(org.id));
    const restricted = await refusal(saturday.organizations.createSubscription(org.id, {
      type: 'team', seats: 5, start_date: Math.floor(Date.now() / 1000), end_date: Math.floor(Date.now() / 1000) + 86400,
    }));
    expect(restricted).toBeInstanceOf(PermissionError);
    expect((restricted as PermissionError).code).toBe('organization_subscription_restricted');
  });

  it('privacy: consent, export, erase', async () => {
    const consent = capture('consent', 'ConsentRecord', await saturday.athletes.recordConsent(complete.id, { consent_type: 'analytics', granted: true }));
    const listed = capture('consent_list', 'ConsentListResponse', await saturday.athletes.listConsent(complete.id));
    expect(listed.consent.map(c => c.id)).toContain(consent.id);
    await saturday.athletes.revokeConsent(complete.id, consent.id);
    const exported = capture('export', 'AthleteDataExport', await saturday.athletes.export(complete.id));
    expect(exported.athlete_id).toBe(complete.id);
    expect(Math.abs(exported.exported_at - Date.now() / 1000)).toBeLessThan(600);

    await saturday.athletes.erase(partial.id);
    expect(await refusal(saturday.athletes.get(partial.id))).toBeInstanceOf(NotFoundError);
    await saturday.athletes.delete(complete.id);
  });

  it('integrations: status', async () => {
    const athlete = await saturday.athletes.create({ external_id: `${run}-d` });
    capture('integration_status', 'IntegrationStatusResponse', await saturday.integrations.status('strava', athlete.id));
    await saturday.athletes.erase(athlete.id);
  });

  it('early-access and unknown routes answer with typed errors', async () => {
    const knowledge = await saturday.knowledge.search({ query: 'sodium' }).catch((error: unknown) => error);
    if (knowledge instanceof PermissionError) expect(knowledge.code).toBe('feature_alpha');
    expect(await refusal(saturday.athletes.get('no-such-athlete'))).toBeInstanceOf(NotFoundError);
  });
});
