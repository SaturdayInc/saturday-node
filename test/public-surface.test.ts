// Wire and response coverage for every public method: mocked fetch, no network.
// Each case checks the request the method builds (method, full URL with query,
// JSON body, and the four SDK headers) and that the method returns the response
// body unchanged. Payloads come from the recorded live responses
// (test/fixtures/live.json), the backend contract samples
// (test/fixtures/contracts.json), or literals annotated with the SDK model they
// exercise where no recording exists. Void methods answer 204 in these tests,
// matching what the client treats as an empty success; test/live.test.ts
// confirms the same calls succeed against the real API.
import { readFileSync } from 'fs';
import { join } from 'path';
import { Saturday } from '../src';
import type {
  AlertRulesDoc, AthleteReport, CoachReportSettings, CoachWebhookEndpoint,
  CoachWebhookWithSecret, FuelingRollup, GearItem, InferActivityTypeResponse,
  InferBrickResponse, IntegrationDisconnectResponse, IntegrationSyncResponse,
  LicenseListResponse, NutritionExtractResponse, OrganizationSubscription,
  Roster, RosterDigest, SessionDetail,
} from '../src';

const live = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'live.json'), 'utf8'));
const contracts = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'contracts.json'), 'utf8'));
const pkgVersion = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')).version;
const liveBody = (key: string): unknown => live[key].body;
const BASE = 'https://api.saturday.fit';
const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

// Models with no recorded response: literals taken from src/types.ts, annotated
// so a field the model drops or renames fails compilation here.
const extractPayload: NutritionExtractResponse = {
  product_name: 'Example Gel', brand: 'Example', carbs_per_serving: 25,
  fueling_carbs_per_serving: 25, sodium_per_serving: 50, serving_size: '40 g',
  serving_size_grams: 40, servings_per_container: 1, confidence: 0.95, calories: 100,
};
const inferActivityPayload: InferActivityTypeResponse = {
  activity_type: 'bike', type: 'bike', confidence: 0.92, intensity: 5,
  reasoning: 'Power data and ride tags', alternatives: [{ activity_type: 'run', confidence: 0.05 }],
  request_id: 'req_surface',
};
const inferBrickPayload: InferBrickResponse = {
  segments: [
    { activity_type: 'bike', order: 1, estimated_duration_min: 90, confidence: 0.9 },
    { activity_type: 'run', order: 2, estimated_duration_min: 30, confidence: 0.85 },
  ],
  sub_types: ['bike', 'run'], total_duration_min: 120, confidence: 0.88, request_id: 'req_surface',
};
const syncPayload: IntegrationSyncResponse = {
  result: {
    provider: 'intervals_icu', status: 'completed', activities_found: 2,
    activities_synced: 1, activities_skipped: 1, prescription_tier: 'full',
  },
  request_id: 'req_surface',
};
const disconnectPayload: IntegrationDisconnectResponse = {
  message: 'Successfully disconnected intervals_icu', provider: 'intervals_icu', request_id: 'req_surface',
};
const subscriptionPayload: OrganizationSubscription = {
  id: 'sub_1', org_id: 'org_1', partner_id: 'partner_example', type: 'team',
  seats: 10, used_seats: 2, status: 'active', start_date: 1700000000, end_date: 1700086400,
  created_at: 1700000000,
};
const licensesPayload: LicenseListResponse = {
  licenses: [{ athlete_id: 'ath_1', email: 'a@example.com', name: 'Sam', added_at: 1700000000, active: true }],
  total: 1, request_id: 'req_surface',
};
const rosterPayload: Roster = {
  coach_uid: 'coach_1', window: 7,
  athletes: [{
    athlete_uid: 'ath_1', flagged: true, flagged_count: 2, top_reasons: ['under_fueled'],
    withheld: { kind: 'connected_app_sessions', message: 'Some sessions are not shown.' },
    session_count: 4,
  }],
};
const digestPayload: RosterDigest = {
  coach_uid: 'coach_1', window: 30, flagged_count: 1, total_count: 3, flagged: rosterPayload.athletes,
};
const rollupPayload: FuelingRollup = {
  athlete_uid: 'ath_1', window: 14, focus: 'rolling',
  sessions: [{ activity_id: 'act_1' }], concern: { flagged: true },
  settings_resolved: {
    report_window_days: 14, report_focus: 'rolling', concern_carb_cutoff: 0.8,
    concern_sodium_cutoff: 0.8, concern_fluid_cutoff: 0.8,
    hyponatremia_fluid_min: 1000, hyponatremia_sodium_max: 300,
  },
};
const reportPayload: AthleteReport = {
  athlete_uid: 'ath_1', window: 7, focus: 'worst', narrative: 'Under-fueled two long rides.',
  concern: { flagged: true }, generated_at: 1700000000000, latest_session_ms: 1699990000000,
  from_cache: false,
};
const sessionPayload: SessionDetail = {
  athlete_uid: 'ath_1', session: { activity_id: 'act_1', carb_g: 90 }, markers: [{ kind: 'under_fuel' }],
};
const alertRulesPayload: AlertRulesDoc = {
  channel_config: { email: { enabled: true, address: 'coach@example.com' }, push: { enabled: false } },
  notification_rules: { under_fuel: { enabled: true, urgent_threshold: 0.6, channels: ['email'], cadence: 'realtime' } },
  combinators: [{ trigger_a: 'under_fuel', trigger_b: 'symptom', channel: 'email', cadence: 'digest' }],
  quiet_hours: { enabled: true, start: '22:00', end: '06:00', tz: 'Europe/Zurich' },
  hourly_cap: { enabled: true, per_hour: 2 }, preset: 'custom',
};
const reportSettingsPayload: CoachReportSettings = {
  ai_report_window_days: 14, ai_report_focus: 'key', concern_carb_cutoff: 0.75,
};
const coachEndpointPayload: CoachWebhookEndpoint = {
  id: 'cwh_1', coach_uid: 'coach_1', url: 'https://example.com/hook',
  events: ['concern.detected'], active: true, created_at: 1700000000000,
  updated_at: 1700000000000, fail_count: 0,
};
const coachSecretPayload: CoachWebhookWithSecret = { ...coachEndpointPayload, secret: 'whsec_example' };
// A model carried inside PrepResponse.gear, exercised here since the recorded
// prep answers carry no gear.
export const gearFixture: GearItem = {
  id: 'gear_1', name: 'Soft flask', type: 'flask', capacity_ml: 500,
  is_default: true, created_at: 1700000000, updated_at: 1700000000,
};

interface WireCase {
  /** `resource.method`, checked against the live client surface below. */
  covers: string;
  name?: string;
  method: string;
  url: string;
  body?: unknown;
  payload?: unknown;
  status?: number;
  apiKey?: string;
  run: (client: Saturday) => Promise<unknown>;
}

const calcRequest = {
  athlete_id: 'ath_1', activity_type: 'bike' as const, duration_min: 180,
  intensity_level: 5, thermal_stress_level: 7, meal_before_min: 120, is_race: false,
};
const createAthleteRequest = {
  external_id: 'user-42', sex: 'female' as const, year_of_birth: 1990, weight_kg: 62,
  settings: { sweat_level: 5, saltiness: 5, concerns_answered: true },
};

const cases: WireCase[] = [
  // nutrition
  { covers: 'nutrition.calculate', method: 'POST', url: `${BASE}/v1/nutrition/calculate`, body: calcRequest, payload: liveBody('calculate_exact'), run: c => c.nutrition.calculate(calcRequest) },
  { covers: 'nutrition.batchCalculate', method: 'POST', url: `${BASE}/v1/nutrition/calculate/batch`, body: { scenarios: [calcRequest] }, payload: liveBody('calculate_batch'), run: c => c.nutrition.batchCalculate([calcRequest]) },
  { covers: 'nutrition.batchCalculate', name: 'nutrition.batchCalculate estimateOnly', method: 'POST', url: `${BASE}/v1/nutrition/calculate/batch`, body: { scenarios: [calcRequest], estimate_only: true }, payload: contracts.batch_estimate, run: c => c.nutrition.batchCalculate([calcRequest], { estimateOnly: true }) },
  { covers: 'nutrition.productFit', method: 'POST', url: `${BASE}/v1/nutrition/products/fit`, body: { athlete_id: 'ath_1', product_query: 'maurten gel 100', activity_type: 'run', duration_min: 90, intensity_level: 7, thermal_stress_level: 5, meal_before_min: 120, is_race: true }, payload: liveBody('product_fit'), run: c => c.nutrition.productFit({ athlete_id: 'ath_1', product_query: 'maurten gel 100', activity_type: 'run', duration_min: 90, intensity_level: 7, thermal_stress_level: 5, meal_before_min: 120, is_race: true }) },
  { covers: 'nutrition.compareProducts', method: 'POST', url: `${BASE}/v1/nutrition/products/compare`, body: { athlete_id: 'ath_1', product_a: { product_query: 'maurten gel 100' }, product_b: { product_id: 'prod_2' }, activity_type: 'bike', duration_min: 180 }, payload: liveBody('product_compare'), run: c => c.nutrition.compareProducts({ athlete_id: 'ath_1', product_a: { product_query: 'maurten gel 100' }, product_b: { product_id: 'prod_2' }, activity_type: 'bike', duration_min: 180 }) },
  { covers: 'nutrition.extract', method: 'POST', url: `${BASE}/v1/nutrition/extract`, body: { images_base64: ['AA==', 'BB=='], label_region: 'US' }, payload: extractPayload, run: c => c.nutrition.extract({ images_base64: ['AA==', 'BB=='], label_region: 'US' }) },
  // athletes
  { covers: 'athletes.create', method: 'POST', url: `${BASE}/v1/athletes`, body: createAthleteRequest, payload: liveBody('athlete'), status: 201, run: c => c.athletes.create(createAthleteRequest) },
  { covers: 'athletes.get', method: 'GET', url: `${BASE}/v1/athletes/ath_1`, payload: liveBody('athlete_get'), run: c => c.athletes.get('ath_1') },
  { covers: 'athletes.list', method: 'GET', url: `${BASE}/v1/athletes?limit=5&cursor=cur_1&external_id=user-42&profile_complete=true`, payload: liveBody('athlete_list'), run: c => c.athletes.list({ limit: 5, cursor: 'cur_1', externalId: 'user-42', profileComplete: true }) },
  { covers: 'athletes.update', method: 'PATCH', url: `${BASE}/v1/athletes/ath_1`, body: { name: 'Live Suite' }, payload: liveBody('athlete_get'), run: c => c.athletes.update('ath_1', { name: 'Live Suite' }) },
  { covers: 'athletes.delete', method: 'DELETE', url: `${BASE}/v1/athletes/ath_1`, status: 204, run: c => c.athletes.delete('ath_1') },
  { covers: 'athletes.getSettings', method: 'GET', url: `${BASE}/v1/athletes/ath_1/settings`, payload: contracts.settings_full, run: c => c.athletes.getSettings('ath_1') },
  { covers: 'athletes.updateSettings', method: 'PATCH', url: `${BASE}/v1/athletes/ath_1/settings`, body: { sweat_level: 7, gut_distress: false }, payload: contracts.settings_updated, run: c => c.athletes.updateSettings('ath_1', { sweat_level: 7, gut_distress: false }) },
  { covers: 'athletes.getFuelingProfile', method: 'GET', url: `${BASE}/v1/athletes/ath_1/fueling-profile`, payload: contracts.fueling_profile_on, run: c => c.athletes.getFuelingProfile('ath_1') },
  { covers: 'athletes.createOnboardingLink', method: 'POST', url: `${BASE}/v1/athletes/ath_1/onboarding-link`, body: { locale: 'de' }, payload: contracts.onboarding_link, run: c => c.athletes.createOnboardingLink('ath_1', { locale: 'de' }) },
  { covers: 'athletes.batchCreate', method: 'POST', url: `${BASE}/v1/athletes/batch`, body: { athletes: [createAthleteRequest] }, payload: liveBody('athletes_batch'), run: c => c.athletes.batchCreate([createAthleteRequest]) },
  { covers: 'athletes.export', method: 'POST', url: `${BASE}/v1/athletes/ath_1/export`, payload: liveBody('export'), run: c => c.athletes.export('ath_1') },
  { covers: 'athletes.erase', method: 'POST', url: `${BASE}/v1/athletes/ath_1/delete`, status: 204, run: c => c.athletes.erase('ath_1') },
  { covers: 'athletes.listConsent', method: 'GET', url: `${BASE}/v1/athletes/ath_1/consent`, payload: liveBody('consent_list'), run: c => c.athletes.listConsent('ath_1') },
  { covers: 'athletes.recordConsent', method: 'POST', url: `${BASE}/v1/athletes/ath_1/consent`, body: { consent_type: 'analytics', granted: true }, payload: liveBody('consent'), status: 201, run: c => c.athletes.recordConsent('ath_1', { consent_type: 'analytics', granted: true }) },
  { covers: 'athletes.revokeConsent', method: 'DELETE', url: `${BASE}/v1/athletes/ath_1/consent/con_1`, status: 204, run: c => c.athletes.revokeConsent('ath_1', 'con_1') },
  // activities
  { covers: 'activities.create', method: 'POST', url: `${BASE}/v1/athletes/ath_1/activities`, body: { type: 'bike', duration_min: 150, intensity_level: 6, thermal_stress_level: 6, meal_before_min: 120, is_race_event: false }, payload: liveBody('activity'), status: 201, run: c => c.activities.create('ath_1', { type: 'bike', duration_min: 150, intensity_level: 6, thermal_stress_level: 6, meal_before_min: 120, is_race_event: false }) },
  { covers: 'activities.get', method: 'GET', url: `${BASE}/v1/athletes/ath_1/activities/act_1`, payload: liveBody('activity_get'), run: c => c.activities.get('ath_1', 'act_1') },
  { covers: 'activities.list', method: 'GET', url: `${BASE}/v1/athletes/ath_1/activities?limit=10&cursor=cur_1`, payload: liveBody('activity_list'), run: c => c.activities.list('ath_1', { limit: 10, cursor: 'cur_1' }) },
  { covers: 'activities.update', method: 'PATCH', url: `${BASE}/v1/athletes/ath_1/activities/act_1`, body: { duration_min: 160 }, payload: liveBody('activity_get'), run: c => c.activities.update('ath_1', 'act_1', { duration_min: 160 }) },
  { covers: 'activities.delete', method: 'DELETE', url: `${BASE}/v1/athletes/ath_1/activities/act_1`, status: 204, run: c => c.activities.delete('ath_1', 'act_1') },
  { covers: 'activities.calculatePrescription', method: 'POST', url: `${BASE}/v1/athletes/ath_1/activities/act_1/calculate`, payload: liveBody('activity_calculate'), run: c => c.activities.calculatePrescription('ath_1', 'act_1') },
  { covers: 'activities.getPrescription', method: 'GET', url: `${BASE}/v1/athletes/ath_1/activities/act_1/prescription`, payload: liveBody('activity_prescription'), run: c => c.activities.getPrescription('ath_1', 'act_1') },
  { covers: 'activities.prep', method: 'POST', url: `${BASE}/v1/athletes/ath_1/activities/act_1/prep`, body: { products: [{ product_query: 'maurten gel 100', servings: 2 }] }, payload: liveBody('prep'), run: c => c.activities.prep('ath_1', 'act_1', { products: [{ product_query: 'maurten gel 100', servings: 2 }] }) },
  { covers: 'activities.prep', name: 'activities.prep default request', method: 'POST', url: `${BASE}/v1/athletes/ath_1/activities/act_1/prep`, body: {}, payload: liveBody('prep'), run: c => c.activities.prep('ath_1', 'act_1') },
  { covers: 'activities.importActivities', method: 'POST', url: `${BASE}/v1/athletes/ath_1/activities/import`, body: { activities: [{ type: 'run', duration_min: 45 }], calculate: true }, payload: liveBody('activity_import'), run: c => c.activities.importActivities('ath_1', [{ type: 'run', duration_min: 45 }], { calculate: true }) },
  { covers: 'activities.submitFeedback', method: 'POST', url: `${BASE}/v1/athletes/ath_1/activities/act_1/feedback`, body: { rating: 4, notes: 'Felt strong' }, payload: liveBody('feedback'), run: c => c.activities.submitFeedback('ath_1', 'act_1', { rating: 4, notes: 'Felt strong' }) },
  // onboarding, reference, infer
  { covers: 'onboarding.questions', method: 'GET', url: `${BASE}/v1/onboarding/questions`, payload: liveBody('onboarding_questions'), run: c => c.onboarding.questions() },
  { covers: 'reference.activityTypes', method: 'GET', url: `${BASE}/v1/activity-types`, payload: liveBody('activity_types'), run: c => c.reference.activityTypes() },
  { covers: 'reference.activityTypes', name: 'reference.activityTypes filtered', method: 'GET', url: `${BASE}/v1/activity-types?activity_type=brick`, payload: liveBody('activity_types_filtered'), run: c => c.reference.activityTypes({ activityType: 'brick' }) },
  { covers: 'reference.settingsSchema', method: 'GET', url: `${BASE}/v1/settings/schema`, payload: liveBody('settings_schema'), run: c => c.reference.settingsSchema() },
  { covers: 'infer.activityType', method: 'POST', url: `${BASE}/v1/infer/activity-type`, body: { activity_name: 'Morning Ride', tags: ['bike'], has_power: true }, payload: inferActivityPayload, run: c => c.infer.activityType({ activity_name: 'Morning Ride', tags: ['bike'], has_power: true }) },
  { covers: 'infer.brickTypes', method: 'POST', url: `${BASE}/v1/infer/brick-types`, body: { activity_name: 'Brick session', structure_summary: '90 bike into 30 run' }, payload: inferBrickPayload, run: c => c.infer.brickTypes({ activity_name: 'Brick session', structure_summary: '90 bike into 30 run' }) },
  // partner
  { covers: 'partner.get', method: 'GET', url: `${BASE}/v1/partner`, payload: liveBody('partner'), run: c => c.partner.get() },
  { covers: 'partner.usage', method: 'GET', url: `${BASE}/v1/partner/usage?from=2026-11-01&to=2026-11-07`, payload: liveBody('usage'), run: c => c.partner.usage({ from: '2026-11-01', to: '2026-11-07' }) },
  { covers: 'partner.usageDaily', method: 'GET', url: `${BASE}/v1/partner/usage/daily?from=2026-11-01`, payload: liveBody('usage_daily'), run: c => c.partner.usageDaily({ from: '2026-11-01' }) },
  { covers: 'partner.listApiKeys', method: 'GET', url: `${BASE}/v1/partner/api-keys`, payload: liveBody('api_keys'), run: c => c.partner.listApiKeys() },
  { covers: 'partner.createApiKey', method: 'POST', url: `${BASE}/v1/partner/api-keys`, body: { name: 'ci-key', scopes: ['read'] }, payload: liveBody('api_key_created'), status: 201, run: c => c.partner.createApiKey('ci-key', { scopes: ['read'] }) },
  { covers: 'partner.revokeApiKey', method: 'DELETE', url: `${BASE}/v1/partner/api-keys/key_1`, status: 204, run: c => c.partner.revokeApiKey('key_1') },
  { covers: 'partner.rotateApiKey', method: 'POST', url: `${BASE}/v1/partner/api-keys/key_1/rotate`, payload: liveBody('api_key_rotated'), run: c => c.partner.rotateApiKey('key_1') },
  // webhooks
  { covers: 'webhooks.create', method: 'POST', url: `${BASE}/v1/webhooks`, body: { url: 'https://example.com/saturday', events: ['athlete.created', 'prescription.calculated'] }, payload: liveBody('webhook_created'), status: 201, run: c => c.webhooks.create('https://example.com/saturday', ['athlete.created', 'prescription.calculated']) },
  { covers: 'webhooks.list', method: 'GET', url: `${BASE}/v1/webhooks`, payload: liveBody('webhook_list'), run: c => c.webhooks.list() },
  { covers: 'webhooks.get', method: 'GET', url: `${BASE}/v1/webhooks/wh_1`, payload: liveBody('webhook'), run: c => c.webhooks.get('wh_1') },
  { covers: 'webhooks.update', method: 'PATCH', url: `${BASE}/v1/webhooks/wh_1`, body: { active: false }, payload: liveBody('webhook'), run: c => c.webhooks.update('wh_1', { active: false }) },
  { covers: 'webhooks.delete', method: 'DELETE', url: `${BASE}/v1/webhooks/wh_1`, status: 204, run: c => c.webhooks.delete('wh_1') },
  { covers: 'webhooks.test', method: 'POST', url: `${BASE}/v1/webhooks/wh_1/test`, payload: liveBody('webhook_test'), run: c => c.webhooks.test('wh_1') },
  { covers: 'webhooks.listDeliveries', method: 'GET', url: `${BASE}/v1/webhooks/wh_1/deliveries`, payload: liveBody('webhook_deliveries'), run: c => c.webhooks.listDeliveries('wh_1') },
  // organizations
  { covers: 'organizations.create', method: 'POST', url: `${BASE}/v1/organizations`, body: { display_name: 'Example Club', sport: 'triathlon' }, payload: liveBody('organization'), status: 201, run: c => c.organizations.create({ display_name: 'Example Club', sport: 'triathlon' }) },
  { covers: 'organizations.list', method: 'GET', url: `${BASE}/v1/organizations?limit=50&cursor=cur_1`, payload: liveBody('organization_list'), run: c => c.organizations.list({ limit: 50, cursor: 'cur_1' }) },
  { covers: 'organizations.get', method: 'GET', url: `${BASE}/v1/organizations/org_1`, payload: liveBody('organization'), run: c => c.organizations.get('org_1') },
  { covers: 'organizations.update', method: 'PATCH', url: `${BASE}/v1/organizations/org_1`, body: { description: 'Weekend riders' }, payload: liveBody('organization'), run: c => c.organizations.update('org_1', { description: 'Weekend riders' }) },
  { covers: 'organizations.addMember', method: 'POST', url: `${BASE}/v1/organizations/org_1/members`, body: { email: 'a@example.com', role: 'member', athlete_id: 'ath_1' }, payload: liveBody('organization_member'), status: 201, run: c => c.organizations.addMember('org_1', { email: 'a@example.com', role: 'member', athlete_id: 'ath_1' }) },
  { covers: 'organizations.listMembers', method: 'GET', url: `${BASE}/v1/organizations/org_1/members`, payload: liveBody('organization_members'), run: c => c.organizations.listMembers('org_1') },
  { covers: 'organizations.removeMember', method: 'DELETE', url: `${BASE}/v1/organizations/org_1/members/mem_1`, status: 204, run: c => c.organizations.removeMember('org_1', 'mem_1') },
  { covers: 'organizations.setOffer', method: 'PUT', url: `${BASE}/v1/organizations/org_1/offer`, body: { discount_percent: 10, applies_to_plan: '12_month' }, payload: liveBody('organization_offer'), run: c => c.organizations.setOffer('org_1', { discount_percent: 10, applies_to_plan: '12_month' }) },
  { covers: 'organizations.getOffer', method: 'GET', url: `${BASE}/v1/organizations/org_1/offer`, payload: liveBody('organization_offer_get'), run: c => c.organizations.getOffer('org_1') },
  { covers: 'organizations.deleteOffer', method: 'DELETE', url: `${BASE}/v1/organizations/org_1/offer`, status: 204, run: c => c.organizations.deleteOffer('org_1') },
  { covers: 'organizations.createSubscription', method: 'POST', url: `${BASE}/v1/organizations/org_1/subscriptions`, body: { type: 'team', seats: 10, start_date: 1700000000, end_date: 1700086400 }, payload: subscriptionPayload, status: 201, run: c => c.organizations.createSubscription('org_1', { type: 'team', seats: 10, start_date: 1700000000, end_date: 1700086400 }) },
  { covers: 'organizations.listSubscriptions', method: 'GET', url: `${BASE}/v1/organizations/org_1/subscriptions`, payload: liveBody('organization_subscriptions'), run: c => c.organizations.listSubscriptions('org_1') },
  { covers: 'organizations.updateSubscription', method: 'PATCH', url: `${BASE}/v1/organizations/org_1/subscriptions/sub_1`, body: { seats: 25, status: 'active' }, payload: subscriptionPayload, run: c => c.organizations.updateSubscription('org_1', 'sub_1', { seats: 25, status: 'active' }) },
  { covers: 'organizations.addLicenses', method: 'POST', url: `${BASE}/v1/organizations/org_1/subscriptions/sub_1/licenses`, body: { licenses: [{ athlete_id: 'ath_1', email: 'a@example.com' }] }, payload: licensesPayload, run: c => c.organizations.addLicenses('org_1', 'sub_1', [{ athlete_id: 'ath_1', email: 'a@example.com' }]) },
  { covers: 'organizations.listLicenses', method: 'GET', url: `${BASE}/v1/organizations/org_1/subscriptions/sub_1/licenses`, payload: licensesPayload, run: c => c.organizations.listLicenses('org_1', 'sub_1') },
  { covers: 'organizations.removeLicense', method: 'DELETE', url: `${BASE}/v1/organizations/org_1/subscriptions/sub_1/licenses/ath_1`, status: 204, run: c => c.organizations.removeLicense('org_1', 'sub_1', 'ath_1') },
  // integrations, testing, meta
  { covers: 'integrations.sync', method: 'POST', url: `${BASE}/v1/integrations/intervals_icu/sync`, body: { athlete_id: 'ath_1', access_token: 'tok', sync_types: ['activities'] }, payload: syncPayload, run: c => c.integrations.sync('intervals_icu', { athlete_id: 'ath_1', access_token: 'tok' }) },
  { covers: 'integrations.sync', name: 'integrations.sync explicit range', method: 'POST', url: `${BASE}/v1/integrations/intervals_icu/sync`, body: { athlete_id: 'ath_1', access_token: 'tok', date_range: { start: '2026-11-01', end: '2026-11-07' }, sync_types: ['activities'] }, payload: syncPayload, run: c => c.integrations.sync('intervals_icu', { athlete_id: 'ath_1', access_token: 'tok', date_range: { start: '2026-11-01', end: '2026-11-07' }, sync_types: ['activities'] }) },
  { covers: 'integrations.status', method: 'GET', url: `${BASE}/v1/integrations/strava/status?athlete_id=ath_1`, payload: liveBody('integration_status'), run: c => c.integrations.status('strava', 'ath_1') },
  { covers: 'integrations.disconnect', method: 'POST', url: `${BASE}/v1/integrations/intervals_icu/disconnect`, body: { athlete_id: 'ath_1' }, payload: disconnectPayload, run: c => c.integrations.disconnect('intervals_icu', 'ath_1') },
  { covers: 'testing.simulateSubscription', method: 'POST', url: `${BASE}/v1/test/athletes/ath_1/simulate-subscription`, body: { active: true }, payload: liveBody('simulate_subscription'), run: c => c.testing.simulateSubscription('ath_1') },
  { covers: 'testing.simulateSubscription', name: 'testing.simulateSubscription off', method: 'POST', url: `${BASE}/v1/test/athletes/ath_1/simulate-subscription`, body: { active: false }, payload: liveBody('simulate_subscription'), run: c => c.testing.simulateSubscription('ath_1', false) },
  { covers: 'meta.discovery', method: 'GET', url: `${BASE}/v1/`, payload: liveBody('discovery'), run: c => c.meta.discovery() },
  { covers: 'meta.errors', method: 'GET', url: `${BASE}/v1/errors`, payload: liveBody('errors'), run: c => c.meta.errors() },
  { covers: 'meta.health', method: 'GET', url: `${BASE}/v1/health`, payload: liveBody('health'), run: c => c.meta.health() },
  // knowledge returns Promise<unknown>: no response model exists in the repo,
  // so these assert request shape and unchanged passthrough of the body.
  { covers: 'knowledge.search', method: 'POST', url: `${BASE}/v1/knowledge/search`, body: { query: 'sodium', limit: 5, category: 'hydration' }, payload: { results: [{ id: 'art_1', title: 'Sodium basics' }], request_id: 'req_surface' }, run: c => c.knowledge.search({ query: 'sodium', limit: 5, category: 'hydration' }) },
  { covers: 'knowledge.listTopics', method: 'GET', url: `${BASE}/v1/knowledge/topics`, payload: { topics: [{ id: 'hydration', name: 'Hydration' }] }, run: c => c.knowledge.listTopics() },
  { covers: 'knowledge.getArticle', method: 'GET', url: `${BASE}/v1/knowledge/articles/art_1`, payload: { id: 'art_1', title: 'Sodium basics', body: 'Drink to thirst.' }, run: c => c.knowledge.getArticle('art_1') },
  // coach (cp_test_ keys)
  { covers: 'coach.roster', apiKey: 'cp_test_surface', method: 'GET', url: `${BASE}/v1/coach/roster?window=7`, payload: rosterPayload, run: c => c.coach.roster({ window: 7 }) },
  { covers: 'coach.rosterDigest', apiKey: 'cp_test_surface', method: 'GET', url: `${BASE}/v1/coach/roster/digest?window=30`, payload: digestPayload, run: c => c.coach.rosterDigest({ window: 30 }) },
  { covers: 'coach.fuelingRollup', apiKey: 'cp_test_surface', method: 'GET', url: `${BASE}/v1/coach/athletes/ath_1/fueling-rollup?window=14&focus=rolling`, payload: rollupPayload, run: c => c.coach.fuelingRollup('ath_1', { window: 14, focus: 'rolling' }) },
  { covers: 'coach.report', apiKey: 'cp_test_surface', method: 'GET', url: `${BASE}/v1/coach/athletes/ath_1/report?window=7&focus=worst&refresh=true`, payload: reportPayload, run: c => c.coach.report('ath_1', { window: 7, focus: 'worst', refresh: true }) },
  { covers: 'coach.sessionDetail', apiKey: 'cp_test_surface', method: 'GET', url: `${BASE}/v1/coach/athletes/ath_1/sessions/act_1`, payload: sessionPayload, run: c => c.coach.sessionDetail('ath_1', 'act_1') },
  { covers: 'coach.getNotificationRules', apiKey: 'cp_test_surface', method: 'GET', url: `${BASE}/v1/coach/config/notification-rules?scope=group&scope_id=grp_1`, payload: alertRulesPayload, run: c => c.coach.getNotificationRules({ scope: 'group', scopeId: 'grp_1' }) },
  { covers: 'coach.setNotificationRules', apiKey: 'cp_test_surface', method: 'PUT', url: `${BASE}/v1/coach/config/notification-rules`, body: { scope: 'group', scope_id: 'grp_1', rules: alertRulesPayload }, payload: { ok: true, scope: 'group' }, run: c => c.coach.setNotificationRules('group', alertRulesPayload, 'grp_1') },
  { covers: 'coach.applyPreset', apiKey: 'cp_test_surface', method: 'POST', url: `${BASE}/v1/coach/config/preset`, body: { scope: 'overall', preset: 'balanced' }, payload: { ok: true, preset: 'balanced' }, run: c => c.coach.applyPreset({ scope: 'overall', preset: 'balanced' }) },
  { covers: 'coach.getReportSettings', apiKey: 'cp_test_surface', method: 'GET', url: `${BASE}/v1/coach/config/report-settings?scope=athlete&scope_id=ath_1`, payload: reportSettingsPayload, run: c => c.coach.getReportSettings({ scope: 'athlete', scopeId: 'ath_1' }) },
  { covers: 'coach.setReportSettings', apiKey: 'cp_test_surface', method: 'PUT', url: `${BASE}/v1/coach/config/report-settings`, body: { scope: 'athlete', scope_id: 'ath_1', settings: reportSettingsPayload }, payload: { ok: true, scope: 'athlete' }, run: c => c.coach.setReportSettings('athlete', reportSettingsPayload, 'ath_1') },
  { covers: 'coach.listWebhooks', apiKey: 'cp_test_surface', method: 'GET', url: `${BASE}/v1/coach/webhooks`, payload: { endpoints: [coachEndpointPayload] }, run: c => c.coach.listWebhooks() },
  { covers: 'coach.registerWebhook', apiKey: 'cp_test_surface', method: 'POST', url: `${BASE}/v1/coach/webhooks`, body: { url: 'https://example.com/hook', events: ['concern.detected'] }, payload: coachSecretPayload, status: 201, run: c => c.coach.registerWebhook('https://example.com/hook', ['concern.detected']) },
  { covers: 'coach.deleteWebhook', apiKey: 'cp_test_surface', method: 'DELETE', url: `${BASE}/v1/coach/webhooks/cwh_1`, payload: { ok: true }, run: c => c.coach.deleteWebhook('cwh_1') },
  { covers: 'coach.disableWebhook', apiKey: 'cp_test_surface', method: 'POST', url: `${BASE}/v1/coach/webhooks/cwh_1/disable`, payload: { ok: true, active: false }, run: c => c.coach.disableWebhook('cwh_1') },
  { covers: 'coach.enableWebhook', apiKey: 'cp_test_surface', method: 'POST', url: `${BASE}/v1/coach/webhooks/cwh_1/enable`, payload: { ok: true, active: true }, run: c => c.coach.enableWebhook('cwh_1') },
  { covers: 'coach.seatState', apiKey: 'cp_test_surface', method: 'GET', url: `${BASE}/v1/coach/billing/seat-state?org_id=org_1`, payload: contracts.billing_seat_state, run: c => c.coach.seatState({ orgId: 'org_1' }) },
  { covers: 'coach.ledger', apiKey: 'cp_test_surface', method: 'GET', url: `${BASE}/v1/coach/billing/ledger?view=inflows&limit=50&cursor=1749480000000`, payload: contracts.billing_ledger_page, run: c => c.coach.ledger({ view: 'inflows', limit: 50, cursor: '1749480000000' }) },
  { covers: 'coach.tierStatus', apiKey: 'cp_test_surface', method: 'GET', url: `${BASE}/v1/coach/billing/tier-status`, payload: contracts.billing_tier_status, run: c => c.coach.tierStatus() },
  { covers: 'coach.connectSummary', apiKey: 'cp_test_surface', method: 'GET', url: `${BASE}/v1/coach/billing/connect/summary`, payload: contracts.billing_connect_summary, run: c => c.coach.connectSummary() },
  { covers: 'coach.connectEarnings', apiKey: 'cp_test_surface', method: 'GET', url: `${BASE}/v1/coach/billing/connect/earnings`, payload: contracts.billing_connect_earnings, run: c => c.coach.connectEarnings() },
  { covers: 'coach.connectTransactions', apiKey: 'cp_test_surface', method: 'GET', url: `${BASE}/v1/coach/billing/connect/transactions?limit=20&cursor=1749480000000`, payload: contracts.billing_connect_transactions, run: c => c.coach.connectTransactions({ limit: 20, cursor: '1749480000000' }) },
  { covers: 'coach.connectArrangements', apiKey: 'cp_test_surface', method: 'GET', url: `${BASE}/v1/coach/billing/connect/arrangements`, payload: contracts.billing_connect_arrangements, run: c => c.coach.connectArrangements() },
];

for (const tc of cases) {
  it(`${tc.name ?? tc.covers} builds the documented request and returns the response unchanged`, async () => {
    const apiKey = tc.apiKey ?? 'sk_test_surface';
    const mock = jest.fn().mockResolvedValue(
      tc.status === 204 ? new Response(null, { status: 204 }) : Response.json(tc.payload, { status: tc.status ?? 200 }),
    );
    global.fetch = mock;
    const client = new Saturday({ apiKey, maxRetries: 0 });
    const result = await tc.run(client);
    if (tc.status === 204) expect(result).toBeUndefined();
    else expect(result).toEqual(tc.payload);
    expect(mock).toHaveBeenCalledTimes(1);
    const [url, init] = mock.mock.calls[0];
    expect(url).toBe(tc.url);
    expect(init.method).toBe(tc.method);
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      'User-Agent': `saturday-node/${pkgVersion}`,
      'X-SDK-Version': pkgVersion,
      Authorization: `Bearer ${apiKey}`,
    });
    expect(init.body === undefined ? undefined : JSON.parse(init.body)).toEqual(tc.body);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
}

const bespoke = ['coach.reportPdf', 'request'];

it('coach.reportPdf builds the documented request and returns the bytes unchanged', async () => {
  const pdf = Buffer.from('%PDF-1.7\nsurface', 'latin1');
  const mock = jest.fn().mockResolvedValue(new Response(pdf, { headers: { 'Content-Type': 'application/pdf' } }));
  global.fetch = mock;
  const client = new Saturday({ apiKey: 'cp_test_surface', maxRetries: 0 });
  const result = await client.coach.reportPdf('ath_1', { window: 30, focus: 'key' });
  expect(Buffer.from(result)).toEqual(pdf);
  const [url, init] = mock.mock.calls[0];
  expect(url).toBe(`${BASE}/v1/coach/athletes/ath_1/report?format=pdf&window=30&focus=key`);
  expect(init.method).toBe('GET');
  expect(init.headers.Authorization).toBe('Bearer cp_test_surface');
  expect(init.body).toBeUndefined();
});

it('Saturday.request sends a caller-built request and parses JSON and bytes', async () => {
  const mock = jest.fn()
    .mockResolvedValueOnce(Response.json({ ok: true, request_id: 'req_1' }))
    .mockResolvedValueOnce(new Response('raw-bytes'));
  global.fetch = mock;
  const client = new Saturday({ apiKey: 'sk_test_surface', maxRetries: 0 });
  await expect(client.request('PUT', '/v1/custom?x=1', { a: 1 })).resolves.toEqual({ ok: true, request_id: 'req_1' });
  expect(Buffer.from(await client.request<ArrayBuffer>('GET', '/v1/custom', undefined, 'arrayBuffer')).toString()).toBe('raw-bytes');
  expect(mock.mock.calls[0][0]).toBe(`${BASE}/v1/custom?x=1`);
  expect(mock.mock.calls[0][1].method).toBe('PUT');
  expect(JSON.parse(mock.mock.calls[0][1].body)).toEqual({ a: 1 });
});

it('trims trailing slashes from a custom baseUrl and prefers bearerToken over apiKey', async () => {
  const mock = jest.fn().mockResolvedValue(Response.json(liveBody('health')));
  global.fetch = mock;
  const client = new Saturday({
    apiKey: 'sk_test_surface', bearerToken: 'oauth-token',
    baseUrl: 'https://example.test/api///', maxRetries: 0,
  });
  await client.meta.health();
  expect(mock.mock.calls[0][0]).toBe('https://example.test/api/v1/health');
  expect(mock.mock.calls[0][1].headers.Authorization).toBe('Bearer oauth-token');
});

it('segment-encodes ids on partner routes so they cannot escape their segment', async () => {
  const mock = jest.fn().mockImplementation(async () => Response.json({ ok: true }));
  global.fetch = mock;
  const client = new Saturday({ apiKey: 'sk_test_surface', maxRetries: 0 });
  await client.athletes.get('a/b c');
  await client.activities.get('ath 1', 'act?x=1');
  await client.webhooks.get('wh/../x');
  await client.organizations.get('org 1');
  await client.partner.revokeApiKey('key/1').catch(() => undefined);
  await client.knowledge.getArticle('art/1');
  await client.integrations.status('intervals_icu', 'ath 1');
  const urls = mock.mock.calls.map(call => call[0] as string);
  expect(urls).toEqual([
    `${BASE}/v1/athletes/a%2Fb%20c`,
    `${BASE}/v1/athletes/ath%201/activities/act%3Fx%3D1`,
    `${BASE}/v1/webhooks/wh%2F..%2Fx`,
    `${BASE}/v1/organizations/org%201`,
    `${BASE}/v1/partner/api-keys/key%2F1`,
    `${BASE}/v1/knowledge/articles/art%2F1`,
    `${BASE}/v1/integrations/intervals_icu/status?athlete_id=ath+1`,
  ]);
});

it('covers every public method on the client surface', () => {
  const client = new Saturday({ apiKey: 'sk_test_surface' }) as unknown as Record<string, unknown>;
  const actual: string[] = [];
  for (const [resource, value] of Object.entries(client)) {
    if (resource === 'config' || value === null || typeof value !== 'object') continue;
    for (const name of Object.getOwnPropertyNames(Object.getPrototypeOf(value))) {
      if (name !== 'constructor') actual.push(`${resource}.${name}`);
    }
  }
  expect(Object.getOwnPropertyNames(Saturday.prototype)).toContain('request');
  const covered = new Set([...cases.map(tc => tc.covers), ...bespoke]);
  expect(actual.sort()).toEqual([...covered].filter(name => name !== 'request').sort());
  expect(covered.has('request')).toBe(true);
  expect(actual).toHaveLength(98);
});
