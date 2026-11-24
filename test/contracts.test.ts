import { readFileSync } from 'fs';
import { join } from 'path';
import ts from 'typescript';
import { Saturday, type ImportActivityRequest } from '../src';

const fixtures = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'contracts.json'), 'utf8'));
const originalFetch = global.fetch;

afterEach(() => { global.fetch = originalFetch; });

it('type-checks backend-generated payloads and resource returns without inventing fields', () => {
  const root = join(__dirname, '..');
  const filename = join(__dirname, 'contract-fixtures.ts');
  const mappings: Record<string, string> = {
    activity_exact: 'ActivityPrescription', activity_banded: 'ActivityPrescription',
    nutrition_exact: 'NutritionCalculateResponse', nutrition_banded: 'NutritionCalculateResponse',
    nutrition_banded_signed_in: 'NutritionCalculateResponse',
    nutrition_teaser: 'NutritionCalculateResponse', nutrition_trial: 'NutritionCalculateResponse', nutrition_zero: 'NutritionCalculateResponse',
    activity_full: 'PrescriptionEnvelope', activity_full_banded: 'PrescriptionEnvelope',
    activity_teaser: 'PrescriptionEnvelope', activity_trial: 'PrescriptionEnvelope',
    stored_exact: 'StoredPrescriptionResponse', stored_banded: 'StoredPrescriptionResponse',
    activity: 'Activity', athlete: 'Athlete', feedback: 'ActivityFeedback',
    list_athletes_next: 'AthleteListResponse', list_athletes_empty: 'AthleteListResponse',
    list_activities_next: 'ActivityListResponse', list_activities_empty: 'ActivityListResponse',
    settings_full: 'AthleteSettings', settings_empty: 'AthleteSettings', settings_updated: 'AthleteSettings',
    batch_partial: 'BatchCalculateResponse', batch_all_failed: 'BatchCalculateResponse', batch_estimate: 'BatchCalculateResponse',
    athletes_partial: 'BatchAthleteResponse', athletes_all_failed: 'BatchAthleteResponse',
    import_plain: 'ActivityImportResponse', import_calculated: 'ActivityImportResponse',
    import_calc_failed: 'ActivityImportResponse', import_all_failed: 'ActivityImportResponse',
    billing_seat_state: 'CoachSeatState', billing_seat_state_pro: 'CoachSeatState',
    billing_ledger_page: 'CoachLedgerPage', billing_ledger_empty: 'CoachLedgerPage',
    billing_tier_status: 'CoachTierStatus', billing_tier_status_empty: 'CoachTierStatus',
    billing_connect_summary: 'CoachConnectSummary', billing_connect_summary_none: 'CoachConnectSummary',
    billing_connect_earnings: 'CoachConnectEarnings', billing_connect_earnings_empty: 'CoachConnectEarnings',
    billing_connect_transactions: 'CoachConnectChargesPage', billing_connect_transactions_end: 'CoachConnectChargesPage',
    billing_connect_arrangements: 'CoachConnectArrangements',
    athlete_sharing: 'Athlete',
    fueling_profile_on: 'FuelingProfile', fueling_profile_off: 'FuelingProfile', fueling_profile_not_linked: 'FuelingProfile',
    webhook_profile_sharing_changed: 'ProfileSharingChangedEvent', webhook_fueling_profile_updated: 'FuelingProfileUpdatedEvent',
    onboarding_link: 'OnboardingLink', partner_profile: 'PartnerAccount',
  };
  const source = `import Saturday, {${[...new Set([...Object.values(mappings), 'Attribution', 'FuelingProfileFieldName', 'WebhookEventType'])].join(',')}} from '../src';\n`
    + Object.entries(mappings).map(([name, type]) => `const ${name}: ${type} = ${JSON.stringify(fixtures[name])};`).join('\n')
    + `\nasync function read(client: Saturday) {
      await client.nutrition.calculate({activity_type: 'bike', duration_min: 120, sex: 'intersex'});
      await client.athletes.batchCreate([{name: 'Fixture', sex: 'intersex'}]);
      const calculated: PrescriptionEnvelope = await client.activities.calculatePrescription('ath_1', 'act_1');
      const stored: StoredPrescriptionResponse = await client.activities.getPrescription('ath_1', 'act_1');
      const batch: BatchCalculateResponse = await client.nutrition.batchCalculate([{activity_type: 'bike', duration_min: 120}]);
      const athletes: BatchAthleteResponse = await client.athletes.batchCreate([{name: 'Fixture'}]);
      const imported: ActivityImportResponse = await client.activities.importActivities('ath_1', [{type: 'bike', duration_min: 120, calculate: true}], {calculate: false});
      const feedback: ActivityFeedback = await client.activities.submitFeedback('ath_1', 'act_1', {rating: 4});
      const athletePage: AthleteListResponse = await client.athletes.list();
      const activityPage: ActivityListResponse = await client.activities.list('ath_1');
      const next: string | undefined = athletePage.pagination.next_cursor;
      const hasMore: boolean = activityPage.pagination.has_more;
      const preferences: AthleteSettings = await client.athletes.getSettings('ath_1');
      const changed: AthleteSettings = await client.athletes.updateSettings('ath_1', {sweat_level: 5, gut_distress: false});
      const seats: CoachSeatState = await client.coach.seatState({orgId: 'org_1'});
      const ledger: CoachLedgerPage = await client.coach.ledger({view: 'inflows', limit: 50, cursor: '1749480000000'});
      const tier: CoachTierStatus = await client.coach.tierStatus();
      const summary: CoachConnectSummary = await client.coach.connectSummary();
      const earnings: CoachConnectEarnings = await client.coach.connectEarnings();
      const charges: CoachConnectChargesPage = await client.coach.connectTransactions({limit: 20});
      const arrangements: CoachConnectArrangements = await client.coach.connectArrangements();
      const fairUse: boolean = seats.is_fair_use;
      const nextCursor: string | undefined = ledger.next_cursor;
      const firstDirection: 'charge' | 'receipt' | 'refund' | 'covered_by' = ledger.entries[0].direction;
      const accountCountry: string | undefined = summary.connect_account?.country;
      const net: number = earnings.summary.total_net_cents + charges.charges[0].net_to_coach_cents + arrangements.arrangements[0].amount_cents;
      const active: boolean = tier.status.is_active;
      // @ts-expect-error ledger pagination is a top-level next_cursor, not a nested object
      ledger.pagination;
      // @ts-expect-error the seat picture carries integer cents, not a formatted price
      seats.next_athlete_price;
      const athlete: Athlete = await client.athletes.create({name: 'Fixture', settings: {sweat_level: 5}, partner_plan: 'annual', org_id: 'org_1'});
      const profileComplete: boolean = athlete.profile_complete;
      const savedSettings: AthleteSettings = athlete.settings;
      const attribution: Attribution = (await client.nutrition.calculate({activity_type: 'bike', duration_min: 120})).attribution;
      stored.safety.warnings?.forEach(warning => warning.toUpperCase());
      const timestamp: number = stored.prescription.calculated_at;
      const remaining: number | undefined = calculated.trial_calls_remaining_today;
      // @ts-expect-error activity calculation is not a flat nutrition response
      calculated.carb_g_per_hr;
      // @ts-expect-error stored reads do not supply a tier
      stored.tier;
      // @ts-expect-error successful batch results do not carry indexes
      batch.results[0].index;
      // @ts-expect-error athlete batch success array is created, not athletes
      athletes.athletes;
      // @ts-expect-error feedback does not return an id/message acknowledgement
      feedback.message;
      // @ts-expect-error pagination is nested, not at the top level
      athletePage.has_more;
      // @ts-expect-error pagination uses next_cursor inside its wrapper
      activityPage.cursor;
      // @ts-expect-error athlete settings use flat concern booleans
      client.athletes.updateSettings('ath_1', {concerns: {gut_distress: true}});
      // @ts-expect-error settings have no athlete_id field
      preferences.athlete_id;
      const fueling: FuelingProfile = await client.athletes.getFuelingProfile('ath_1');
      if (fueling.sharing === 'on') {
        const sweat: number | null = fueling.profile.sweat_level.value;
        const source: 'partner' | 'saturday_app' | 'default' = fueling.profile.sweat_level.calculations_use;
        const cramps: boolean | undefined = fueling.profile.concerns.value?.muscle_cramps;
        const saved: number = fueling.updated_at;
      } else {
        const why: string = fueling.message;
        // @ts-expect-error only a shared profile carries answers
        fueling.profile.sweat_level;
      }
      const sharing: 'on' | 'off' | 'not_linked' | undefined = athlete.profile_sharing;
      const changedTo: 'on' | 'off' | 'not_linked' = webhook_profile_sharing_changed.data.profile_sharing;
      const changedAthlete: string = webhook_profile_sharing_changed.data.id;
      const changedFields: FuelingProfileFieldName[] = webhook_fueling_profile_updated.data.changed_fields;
      // @ts-expect-error changed_fields names the shared answers only
      const bogus: FuelingProfileFieldName = 'year_of_birth';
      // @ts-expect-error registration rejects names the API does not send
      const retired: WebhookEventType = 'prescription.updated';
    }`;
  const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
    strict: true, skipLibCheck: true, noEmit: true, esModuleInterop: true };
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (file, version, onError, fresh) => file === filename
    ? ts.createSourceFile(file, source, version, true)
    : original(file, version, onError, fresh);
  const program = ts.createProgram([filename], options, host);
  expect(ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([]);
});

it.each([
  'nutrition_exact', 'nutrition_banded', 'nutrition_banded_signed_in', 'nutrition_teaser', 'nutrition_trial', 'nutrition_zero',
  'activity_full', 'activity_full_banded', 'activity_teaser', 'activity_trial',
  'stored_exact', 'stored_banded', 'batch_partial', 'batch_all_failed', 'batch_estimate',
  'athletes_partial', 'athletes_all_failed', 'feedback',
])('preserves the raw %s payload', async name => {
  const payload = { ...fixtures[name], future_field: { preserved: true } };
  const mock = jest.fn().mockResolvedValue(Response.json(payload));
  global.fetch = mock;
  const client = new Saturday({ apiKey: 'sk_test_fixture', maxRetries: 0 });
  const result = name.startsWith('nutrition_') ? await client.nutrition.calculate({ activity_type: 'bike', duration_min: 120 })
    : name.startsWith('activity_') ? await client.activities.calculatePrescription('ath_1', 'act_1')
    : name.startsWith('stored_') ? await client.activities.getPrescription('ath_1', 'act_1')
    : name.startsWith('batch_') ? await client.nutrition.batchCalculate([{ activity_type: 'bike', duration_min: 120 }])
    : name === 'feedback' ? await client.activities.submitFeedback('ath_1', 'act_1', { rating: 4 })
    : await client.athletes.batchCreate([{ name: 'Fixture' }]);
  expect(result).toEqual(payload);
  expect(mock).toHaveBeenCalledTimes(1);
});

it.each(['import_plain', 'import_calculated', 'import_calc_failed', 'import_all_failed'])(
  'imports activities and preserves %s, without calculating by default', async name => {
    const mock = jest.fn().mockResolvedValue(Response.json(fixtures[name]));
    global.fetch = mock;
    const client = new Saturday({ apiKey: 'sk_test_fixture', maxRetries: 0 });
    const activities: ImportActivityRequest[] = [{ type: 'bike', duration_min: 120, external_id: 'partner-act' }];
    const result = await client.activities.importActivities('ath_1', activities);
    expect(result).toEqual(fixtures[name]);
    expect(mock.mock.calls[0][0]).toBe('https://api.saturday.fit/v1/athletes/ath_1/activities/import');
    expect(JSON.parse(mock.mock.calls[0][1].body)).toEqual({ activities });
  },
);

it.each([false, true])('passes explicit global and per-item calculate flags (%s)', async calculate => {
  const mock = jest.fn().mockResolvedValue(Response.json(fixtures.import_calculated));
  global.fetch = mock;
  const client = new Saturday({ apiKey: 'sk_test_fixture' });
  const activities: ImportActivityRequest[] = [{ type: 'bike', duration_min: 120, calculate: true }];
  await client.activities.importActivities('ath_1', activities, { calculate });
  expect(JSON.parse(mock.mock.calls[0][1].body)).toEqual({ activities, calculate });
});

it('sends the current package version in SDK request headers', async () => {
  const mock = jest.fn().mockResolvedValue(Response.json(fixtures.nutrition_exact));
  global.fetch = mock;
  const client = new Saturday({ apiKey: 'sk_test_fixture' });
  await client.nutrition.calculate({ activity_type: 'bike', duration_min: 120 });
  const version = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')).version;
  expect(mock.mock.calls[0][1].headers).toMatchObject({ 'User-Agent': `saturday-node/${version}`, 'X-SDK-Version': version });
});

it.each(['list_athletes_next', 'list_athletes_empty', 'list_activities_next', 'list_activities_empty'])('%s keeps nested pagination and query defaults', async name => {
  const payload = { ...fixtures[name], future_field: true };
  const mock = jest.fn().mockImplementation(async () => Response.json(payload));
  global.fetch = mock;
  const client = new Saturday({ apiKey: 'sk_test_fixture', maxRetries: 0 });
  const athletes = name.startsWith('list_athletes');
  const path = athletes ? '/v1/athletes' : '/v1/athletes/ath_1/activities';
  const result = athletes ? await client.athletes.list() : await client.activities.list('ath_1');
  expect(result).toEqual(payload);
  expect(mock.mock.calls[0][0]).toBe(`https://api.saturday.fit${path}`);
  expect(mock.mock.calls[0][1].method).toBe('GET');
  const options = { limit: 1, cursor: '1700000000' };
  const paged = athletes ? await client.athletes.list(options) : await client.activities.list('ath_1', options);
  expect(paged).toEqual(payload);
  expect(mock.mock.calls[1][0]).toBe(`https://api.saturday.fit${path}?limit=1&cursor=1700000000`);
});

it.each(['settings_full', 'settings_empty', 'settings_updated'])('preserves raw %s and sends the explicit flat settings payload', async name => {
  const payload = { ...fixtures[name], future_field: true };
  const mock = jest.fn().mockImplementation(async () => Response.json(payload));
  global.fetch = mock;
  const client = new Saturday({ apiKey: 'sk_test_fixture', maxRetries: 0 });
  expect(await client.athletes.getSettings('ath_1')).toEqual(payload);
  const settings = { sweat_level: 5, gut_distress: false };
  expect(await client.athletes.updateSettings('ath_1', settings)).toEqual(payload);
  expect(mock).toHaveBeenCalledTimes(2);
  expect(mock.mock.calls[1][0]).toBe('https://api.saturday.fit/v1/athletes/ath_1/settings');
  expect(mock.mock.calls[1][1].method).toBe('PATCH');
  expect(JSON.parse(mock.mock.calls[1][1].body)).toEqual(settings);
});

it.each([
  ['billing_seat_state', 'seatState', {}, '/v1/coach/billing/seat-state'],
  ['billing_seat_state', 'seatState', { orgId: 'org_1' }, '/v1/coach/billing/seat-state?org_id=org_1'],
  ['billing_ledger_page', 'ledger', { view: 'inflows', limit: 50, cursor: '1749480000000' }, '/v1/coach/billing/ledger?view=inflows&limit=50&cursor=1749480000000'],
  ['billing_ledger_empty', 'ledger', {}, '/v1/coach/billing/ledger'],
  ['billing_tier_status', 'tierStatus', undefined, '/v1/coach/billing/tier-status'],
  ['billing_connect_summary_none', 'connectSummary', undefined, '/v1/coach/billing/connect/summary'],
  ['billing_connect_earnings', 'connectEarnings', undefined, '/v1/coach/billing/connect/earnings'],
  ['billing_connect_transactions', 'connectTransactions', { limit: 20, cursor: '1749480000000' }, '/v1/coach/billing/connect/transactions?limit=20&cursor=1749480000000'],
  ['billing_connect_arrangements', 'connectArrangements', undefined, '/v1/coach/billing/connect/arrangements'],
] as const)('%s: coach.%s is a GET with the documented query and keeps the raw payload', async (name, method, params, path) => {
  const payload = { ...fixtures[name], future_field: true };
  const mock = jest.fn().mockResolvedValue(Response.json(payload));
  global.fetch = mock;
  const client = new Saturday({ apiKey: 'cp_test_fixture', maxRetries: 0 });
  const fn = (client.coach as unknown as Record<string, (arg?: unknown) => Promise<unknown>>)[method];
  const result = params === undefined ? await fn.call(client.coach) : await fn.call(client.coach, params);
  expect(result).toEqual(payload);
  expect(mock.mock.calls[0][0]).toBe(`https://api.saturday.fit${path}`);
  expect(mock.mock.calls[0][1].method).toBe('GET');
});

it.each(['fueling_profile_on', 'fueling_profile_off', 'fueling_profile_not_linked'])('athletes.getFuelingProfile reads %s from the fueling-profile route and keeps the raw payload', async name => {
  const payload = { ...fixtures[name], future_field: true };
  const mock = jest.fn().mockResolvedValue(Response.json(payload));
  global.fetch = mock;
  const client = new Saturday({ apiKey: 'sk_test_fixture', maxRetries: 0 });
  const result = await client.athletes.getFuelingProfile('ath_1');
  expect(result).toEqual(payload);
  expect(mock.mock.calls[0][0]).toBe('https://api.saturday.fit/v1/athletes/ath_1/fueling-profile');
  expect(mock.mock.calls[0][1].method).toBe('GET');
  expect(mock.mock.calls[0][1].body).toBeUndefined();
});

it.each([
  ['nutrition.extract', (c: Saturday) => c.nutrition.extract({ image_base64: 'AA==' }),
    'POST', '/v1/nutrition/extract', { image_base64: 'AA==' }],
  ['infer.activityType', (c: Saturday) => c.infer.activityType({ activity_name: 'Morning Ride', tags: ['bike'] }),
    'POST', '/v1/infer/activity-type', { activity_name: 'Morning Ride', tags: ['bike'] }],
  ['infer.brickTypes', (c: Saturday) => c.infer.brickTypes({ activity_name: 'Brick session' }),
    'POST', '/v1/infer/brick-types', { activity_name: 'Brick session' }],
  ['integrations.disconnect', (c: Saturday) => c.integrations.disconnect('intervals_icu', 'ath_1'),
    'POST', '/v1/integrations/intervals_icu/disconnect', { athlete_id: 'ath_1' }],
  ['organizations.updateSubscription', (c: Saturday) => c.organizations.updateSubscription('org_1', 'sub_1', { seats: 10 }),
    'PATCH', '/v1/organizations/org_1/subscriptions/sub_1', { seats: 10 }],
  ['organizations.addLicenses', (c: Saturday) => c.organizations.addLicenses('org_1', 'sub_1', [{ athlete_id: 'ath_1' }]),
    'POST', '/v1/organizations/org_1/subscriptions/sub_1/licenses', { licenses: [{ athlete_id: 'ath_1' }] }],
  ['organizations.listLicenses', (c: Saturday) => c.organizations.listLicenses('org_1', 'sub_1'),
    'GET', '/v1/organizations/org_1/subscriptions/sub_1/licenses', undefined],
  ['organizations.removeLicense', (c: Saturday) => c.organizations.removeLicense('org_1', 'sub_1', 'ath_1'),
    'DELETE', '/v1/organizations/org_1/subscriptions/sub_1/licenses/ath_1', undefined],
  ['knowledge.listTopics', (c: Saturday) => c.knowledge.listTopics(),
    'GET', '/v1/knowledge/topics', undefined],
  ['knowledge.getArticle', (c: Saturday) => c.knowledge.getArticle('art_1'),
    'GET', '/v1/knowledge/articles/art_1', undefined],
  ['activities.get', (c: Saturday) => c.activities.get('ath_1', 'act_1'),
    'GET', '/v1/athletes/ath_1/activities/act_1', undefined],
  ['organizations.get', (c: Saturday) => c.organizations.get('org_1'),
    'GET', '/v1/organizations/org_1', undefined],
  ['organizations.update', (c: Saturday) => c.organizations.update('org_1', { description: 'Weekend riders' }),
    'PATCH', '/v1/organizations/org_1', { description: 'Weekend riders' }],
  ['organizations.getOffer', (c: Saturday) => c.organizations.getOffer('org_1'),
    'GET', '/v1/organizations/org_1/offer', undefined],
])('%s sends the documented request', async (_name, call, method, path, body) => {
  const mock = jest.fn().mockResolvedValue(Response.json({ ok: true }));
  global.fetch = mock;
  await call(new Saturday({ apiKey: 'sk_test_fixture', maxRetries: 0 }));
  expect(mock.mock.calls[0][0]).toBe(`https://api.saturday.fit${path}`);
  expect(mock.mock.calls[0][1].method).toBe(method);
  const sent = mock.mock.calls[0][1].body;
  expect(sent === undefined ? undefined : JSON.parse(sent)).toEqual(body);
});

// Offline wire coverage for the methods that previously ran only in the live suite
// (which CI skips) or only as type text. Mocked transport: method, path and body only.
it.each([
  ['nutrition.compareProducts', (c: Saturday) => c.nutrition.compareProducts({
    athlete_id: 'ath_1', product_a: { product_query: 'maurten gel 100' },
    product_b: { product_query: 'tailwind endurance fuel' }, activity_type: 'bike', duration_min: 180,
  }),
    'POST', '/v1/nutrition/products/compare', {
      athlete_id: 'ath_1', product_a: { product_query: 'maurten gel 100' },
      product_b: { product_query: 'tailwind endurance fuel' }, activity_type: 'bike', duration_min: 180,
    }],
  ['athletes.update', (c: Saturday) => c.athletes.update('ath_1', { name: 'Live Suite' }),
    'PATCH', '/v1/athletes/ath_1', { name: 'Live Suite' }],
  ['athletes.export', (c: Saturday) => c.athletes.export('ath_1'),
    'POST', '/v1/athletes/ath_1/export', undefined],
  ['athletes.listConsent', (c: Saturday) => c.athletes.listConsent('ath_1'),
    'GET', '/v1/athletes/ath_1/consent', undefined],
  ['athletes.recordConsent', (c: Saturday) => c.athletes.recordConsent('ath_1', { consent_type: 'analytics', granted: true }),
    'POST', '/v1/athletes/ath_1/consent', { consent_type: 'analytics', granted: true }],
  ['athletes.revokeConsent', (c: Saturday) => c.athletes.revokeConsent('ath_1', 'con_1'),
    'DELETE', '/v1/athletes/ath_1/consent/con_1', undefined],
  ['activities.create', (c: Saturday) => c.activities.create('ath_1', { type: 'bike', duration_min: 150 }),
    'POST', '/v1/athletes/ath_1/activities', { type: 'bike', duration_min: 150 }],
  ['activities.update', (c: Saturday) => c.activities.update('ath_1', 'act_1', { duration_min: 160 }),
    'PATCH', '/v1/athletes/ath_1/activities/act_1', { duration_min: 160 }],
  ['activities.delete', (c: Saturday) => c.activities.delete('ath_1', 'act_1'),
    'DELETE', '/v1/athletes/ath_1/activities/act_1', undefined],
  ['reference.settingsSchema', (c: Saturday) => c.reference.settingsSchema(),
    'GET', '/v1/settings/schema', undefined],
  ['reference.activityTypes filtered', (c: Saturday) => c.reference.activityTypes({ activityType: 'run' }),
    'GET', '/v1/activity-types?activity_type=run', undefined],
  ['partner.get', (c: Saturday) => c.partner.get(),
    'GET', '/v1/partner', undefined],
  ['partner.usage', (c: Saturday) => c.partner.usage(),
    'GET', '/v1/partner/usage', undefined],
  ['partner.usageDaily', (c: Saturday) => c.partner.usageDaily(),
    'GET', '/v1/partner/usage/daily', undefined],
  ['partner.listApiKeys', (c: Saturday) => c.partner.listApiKeys(),
    'GET', '/v1/partner/api-keys', undefined],
  ['partner.createApiKey', (c: Saturday) => c.partner.createApiKey('ci-key'),
    'POST', '/v1/partner/api-keys', { name: 'ci-key' }],
  ['partner.createApiKey with scopes', (c: Saturday) => c.partner.createApiKey('ci-key', { scopes: ['read'] }),
    'POST', '/v1/partner/api-keys', { name: 'ci-key', scopes: ['read'] }],
  ['partner.revokeApiKey', (c: Saturday) => c.partner.revokeApiKey('key_1'),
    'DELETE', '/v1/partner/api-keys/key_1', undefined],
  ['partner.rotateApiKey', (c: Saturday) => c.partner.rotateApiKey('key_1'),
    'POST', '/v1/partner/api-keys/key_1/rotate', undefined],
  ['webhooks.list', (c: Saturday) => c.webhooks.list(),
    'GET', '/v1/webhooks', undefined],
  ['webhooks.get', (c: Saturday) => c.webhooks.get('wh_1'),
    'GET', '/v1/webhooks/wh_1', undefined],
  ['webhooks.update', (c: Saturday) => c.webhooks.update('wh_1', { active: false }),
    'PATCH', '/v1/webhooks/wh_1', { active: false }],
  ['webhooks.delete', (c: Saturday) => c.webhooks.delete('wh_1'),
    'DELETE', '/v1/webhooks/wh_1', undefined],
  ['webhooks.test', (c: Saturday) => c.webhooks.test('wh_1'),
    'POST', '/v1/webhooks/wh_1/test', undefined],
  ['organizations.create', (c: Saturday) => c.organizations.create({ display_name: 'Example Club', sport: 'triathlon' }),
    'POST', '/v1/organizations', { display_name: 'Example Club', sport: 'triathlon' }],
  ['organizations.addMember', (c: Saturday) => c.organizations.addMember('org_1', { email: 'a@example.com', role: 'member', athlete_id: 'ath_1' }),
    'POST', '/v1/organizations/org_1/members', { email: 'a@example.com', role: 'member', athlete_id: 'ath_1' }],
  ['organizations.listMembers', (c: Saturday) => c.organizations.listMembers('org_1'),
    'GET', '/v1/organizations/org_1/members', undefined],
  ['organizations.removeMember', (c: Saturday) => c.organizations.removeMember('org_1', 'mem_1'),
    'DELETE', '/v1/organizations/org_1/members/mem_1', undefined],
  ['organizations.setOffer', (c: Saturday) => c.organizations.setOffer('org_1', { discount_percent: 10 }),
    'PUT', '/v1/organizations/org_1/offer', { discount_percent: 10 }],
  ['organizations.deleteOffer', (c: Saturday) => c.organizations.deleteOffer('org_1'),
    'DELETE', '/v1/organizations/org_1/offer', undefined],
  ['organizations.createSubscription', (c: Saturday) => c.organizations.createSubscription('org_1', {
    type: 'team', seats: 5, start_date: 1700000000, end_date: 1700086400,
  }),
    'POST', '/v1/organizations/org_1/subscriptions', { type: 'team', seats: 5, start_date: 1700000000, end_date: 1700086400 }],
  ['organizations.listSubscriptions', (c: Saturday) => c.organizations.listSubscriptions('org_1'),
    'GET', '/v1/organizations/org_1/subscriptions', undefined],
  ['integrations.status', (c: Saturday) => c.integrations.status('intervals_icu', 'ath_1'),
    'GET', '/v1/integrations/intervals_icu/status?athlete_id=ath_1', undefined],
  ['testing.simulateSubscription off', (c: Saturday) => c.testing.simulateSubscription('ath_1', false),
    'POST', '/v1/test/athletes/ath_1/simulate-subscription', { active: false }],
  ['meta.discovery', (c: Saturday) => c.meta.discovery(),
    'GET', '/v1/', undefined],
  ['meta.errors', (c: Saturday) => c.meta.errors(),
    'GET', '/v1/errors', undefined],
  ['meta.health', (c: Saturday) => c.meta.health(),
    'GET', '/v1/health', undefined],
  // Coach optional-argument variants: bare reads send no query string, and an
  // unset scope_id is dropped from the JSON body rather than sent as null.
  ['coach.roster bare', (c: Saturday) => c.coach.roster(),
    'GET', '/v1/coach/roster', undefined],
  ['coach.rosterDigest bare', (c: Saturday) => c.coach.rosterDigest(),
    'GET', '/v1/coach/roster/digest', undefined],
  ['coach.fuelingRollup bare', (c: Saturday) => c.coach.fuelingRollup('ath_1'),
    'GET', '/v1/coach/athletes/ath_1/fueling-rollup', undefined],
  ['coach.report refresh', (c: Saturday) => c.coach.report('ath_1', { refresh: true }),
    'GET', '/v1/coach/athletes/ath_1/report?refresh=true', undefined],
  ['coach.getNotificationRules bare', (c: Saturday) => c.coach.getNotificationRules(),
    'GET', '/v1/coach/config/notification-rules', undefined],
  ['coach.getReportSettings bare', (c: Saturday) => c.coach.getReportSettings(),
    'GET', '/v1/coach/config/report-settings', undefined],
  ['coach.setNotificationRules overall', (c: Saturday) => c.coach.setNotificationRules('overall', {} as never),
    'PUT', '/v1/coach/config/notification-rules', { scope: 'overall', rules: {} }],
  ['coach.setReportSettings overall', (c: Saturday) => c.coach.setReportSettings('overall', { ai_report_window_days: 7 }),
    'PUT', '/v1/coach/config/report-settings', { scope: 'overall', settings: { ai_report_window_days: 7 } }],
  ['coach.applyPreset scoped', (c: Saturday) => c.coach.applyPreset({ scope: 'group', preset: 'hands_on', scopeId: 'grp_1' }),
    'POST', '/v1/coach/config/preset', { scope: 'group', scope_id: 'grp_1', preset: 'hands_on' }],
])('%s sends the documented request', async (_name, call, method, path, body) => {
  const mock = jest.fn().mockResolvedValue(Response.json({ ok: true }));
  global.fetch = mock;
  await call(new Saturday({ apiKey: 'sk_test_fixture', maxRetries: 0 }));
  expect(mock.mock.calls[0][0]).toBe(`https://api.saturday.fit${path}`);
  expect(mock.mock.calls[0][1].method).toBe(method);
  const sent = mock.mock.calls[0][1].body;
  expect(sent === undefined ? undefined : JSON.parse(sent)).toEqual(body);
});

it('athletes.list sends profileComplete as profile_complete, true and false alike', async () => {
  const mock = jest.fn().mockImplementation(async () => Response.json({
    athletes: [], pagination: { total: 0, has_more: false }, request_id: 'req_1',
  }));
  global.fetch = mock;
  const client = new Saturday({ apiKey: 'sk_test_fixture', maxRetries: 0 });
  await client.athletes.list({ profileComplete: true });
  await client.athletes.list({ profileComplete: false });
  await client.athletes.list({ limit: 5, cursor: '1700000000', externalId: 'user-42', profileComplete: true });
  expect(mock.mock.calls[0][0]).toBe('https://api.saturday.fit/v1/athletes?profile_complete=true');
  expect(mock.mock.calls[1][0]).toBe('https://api.saturday.fit/v1/athletes?profile_complete=false');
  expect(mock.mock.calls[2][0]).toBe(
    'https://api.saturday.fit/v1/athletes?limit=5&cursor=1700000000&external_id=user-42&profile_complete=true',
  );
});

it('partner usage sends the from and to dates it is given', async () => {
  const mock = jest.fn().mockImplementation(async () => Response.json({ ok: true }));
  global.fetch = mock;
  const client = new Saturday({ apiKey: 'sk_test_fixture', maxRetries: 0 });
  await client.partner.usage({ from: '2026-11-01', to: '2026-11-07' });
  await client.partner.usageDaily({ from: '2026-11-01', to: '2026-11-07' });
  await client.partner.usage({ from: '2026-11-01' });
  expect(mock.mock.calls[0][0]).toBe('https://api.saturday.fit/v1/partner/usage?from=2026-11-01&to=2026-11-07');
  expect(mock.mock.calls[1][0]).toBe('https://api.saturday.fit/v1/partner/usage/daily?from=2026-11-01&to=2026-11-07');
  expect(mock.mock.calls[2][0]).toBe('https://api.saturday.fit/v1/partner/usage?from=2026-11-01');
});

it('walks two athlete pages by feeding next_cursor back as cursor to has_more false', async () => {
  const page1 = {
    athletes: [{ id: 'ath_1' }],
    pagination: { total: 1, has_more: true, next_cursor: '1700000000' }, request_id: 'req_1',
  };
  const page2 = {
    athletes: [{ id: 'ath_2' }],
    pagination: { total: 1, has_more: false }, request_id: 'req_2',
  };
  const mock = jest.fn()
    .mockResolvedValueOnce(Response.json(page1))
    .mockResolvedValueOnce(Response.json(page2));
  global.fetch = mock;
  const client = new Saturday({ apiKey: 'sk_test_fixture', maxRetries: 0 });
  const first = await client.athletes.list({ limit: 1 });
  expect(first.pagination.has_more).toBe(true);
  const second = await client.athletes.list({ limit: 1, cursor: first.pagination.next_cursor });
  expect(second.pagination.has_more).toBe(false);
  expect(mock.mock.calls[0][0]).toBe('https://api.saturday.fit/v1/athletes?limit=1');
  expect(mock.mock.calls[1][0]).toBe('https://api.saturday.fit/v1/athletes?limit=1&cursor=1700000000');
});

it('walks two ledger pages by feeding the top-level next_cursor back as cursor', async () => {
  const page1 = { entries: [{ id: 'led_1' }], next_cursor: '1749480000000', request_id: 'req_1' };
  const page2 = { entries: [{ id: 'led_2' }], request_id: 'req_2' };
  const mock = jest.fn()
    .mockResolvedValueOnce(Response.json(page1))
    .mockResolvedValueOnce(Response.json(page2));
  global.fetch = mock;
  const client = new Saturday({ apiKey: 'cp_test_fixture', maxRetries: 0 });
  const first = await client.coach.ledger({ limit: 1 }) as unknown as { next_cursor?: string };
  const second = await client.coach.ledger({ limit: 1, cursor: first.next_cursor });
  expect(second).toEqual(page2);
  expect(mock.mock.calls[0][0]).toBe('https://api.saturday.fit/v1/coach/billing/ledger?limit=1');
  expect(mock.mock.calls[1][0]).toBe('https://api.saturday.fit/v1/coach/billing/ledger?limit=1&cursor=1749480000000');
});

it('sends an arbitrary cursor verbatim (form-encoded) for the API to judge', async () => {
  const mock = jest.fn().mockImplementation(async () => Response.json({
    athletes: [], pagination: { total: 0, has_more: false }, request_id: 'req_1',
  }));
  global.fetch = mock;
  const client = new Saturday({ apiKey: 'sk_test_fixture', maxRetries: 0 });
  await client.athletes.list({ cursor: 'not a/cursor' });
  expect(mock.mock.calls[0][0]).toBe('https://api.saturday.fit/v1/athletes?cursor=not+a%2Fcursor');
});

it('the shared profile fixture carries every shared answer and the unshared ones carry none', () => {
  expect(Object.keys(fixtures.fueling_profile_on.profile).sort()).toEqual([
    'age', 'athlete_weight_kg', 'carb_experience', 'concerns', 'fitness_level', 'saltiness',
    'satiety_level', 'sex', 'sweat_level', 'usual_carb_consumption',
  ]);
  for (const name of ['fueling_profile_off', 'fueling_profile_not_linked']) {
    expect(fixtures[name]).not.toHaveProperty('profile');
    expect(fixtures[name]).not.toHaveProperty('updated_at');
    expect(typeof fixtures[name].message).toBe('string');
  }
});
