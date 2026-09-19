import { readFileSync } from 'fs';
import { join } from 'path';
import ts from 'typescript';
import { Saturday } from '../src';

const fixtures = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'contracts.json'), 'utf8'));
const originalFetch = global.fetch;

afterEach(() => { global.fetch = originalFetch; });

it('type-checks backend-generated payloads and resource returns without inventing fields', () => {
  const root = join(__dirname, '..');
  const filename = join(__dirname, 'contract-fixtures.ts');
  const mappings: Record<string, string> = {
    activity_exact: 'ActivityPrescription', activity_banded: 'ActivityPrescription',
    nutrition_exact: 'NutritionCalculateResponse', nutrition_banded: 'NutritionCalculateResponse',
    nutrition_teaser: 'NutritionCalculateResponse', nutrition_trial: 'NutritionCalculateResponse', nutrition_zero: 'NutritionCalculateResponse',
    activity_full: 'PrescriptionEnvelope', activity_full_banded: 'PrescriptionEnvelope',
    activity_teaser: 'PrescriptionEnvelope', activity_trial: 'PrescriptionEnvelope',
    stored_exact: 'StoredPrescriptionResponse', stored_banded: 'StoredPrescriptionResponse',
    activity: 'Activity', athlete: 'Athlete', feedback: 'ActivityFeedback',
    batch_partial: 'BatchCalculateResponse', batch_all_failed: 'BatchCalculateResponse', batch_estimate: 'BatchCalculateResponse',
    athletes_partial: 'BatchAthleteResponse', athletes_all_failed: 'BatchAthleteResponse',
    import_plain: 'ActivityImportResponse', import_calculated: 'ActivityImportResponse',
    import_calc_failed: 'ActivityImportResponse', import_all_failed: 'ActivityImportResponse',
  };
  const source = `import Saturday, {${[...new Set(Object.values(mappings))].join(',')}} from '../src';\n`
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
  'nutrition_exact', 'nutrition_banded', 'nutrition_teaser', 'nutrition_trial', 'nutrition_zero',
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
    const activities = [{ type: 'bike', duration_min: 120, external_id: 'partner-act' }];
    const result = await (client.activities as any).importActivities('ath_1', activities);
    expect(result).toEqual(fixtures[name]);
    expect(mock.mock.calls[0][0]).toBe('https://api.saturday.fit/v1/athletes/ath_1/activities/import');
    expect(JSON.parse(mock.mock.calls[0][1].body)).toEqual({ activities });
  },
);

it.each([false, true])('passes explicit global and per-item calculate flags (%s)', async calculate => {
  const mock = jest.fn().mockResolvedValue(Response.json(fixtures.import_calculated));
  global.fetch = mock;
  const client = new Saturday({ apiKey: 'sk_test_fixture' });
  const activities = [{ type: 'bike', duration_min: 120, calculate: true }];
  await (client.activities as any).importActivities('ath_1', activities, { calculate });
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
