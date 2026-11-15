import { join } from 'path';
import ts from 'typescript';
import { Saturday } from '../src';

// Shapes the deployed API returned on 2026-11-15, written out by hand with example values.
const webhook = {
  id: 'wh_1', partner_id: 'partner_example', url: 'https://example.com/saturday',
  events: ['athlete.created', 'webhook.test'], active: true,
  created_at: 1794765411324, updated_at: 1794765411324, fail_count: 0,
};
const fixtures = {
  webhook_create: {
    message: 'Store the secret securely: it will not be shown again.',
    request_id: 'req_0a1b2c3d4e5f',
    webhook: { ...webhook, secret: '0'.repeat(64) },
  },
  webhook,
  webhook_list: { webhooks: [webhook], total: 1, request_id: 'req_0a1b2c3d4e60' },
  webhook_test: {
    delivery: {
      id: 'dlv_1', webhook_id: 'wh_1', partner_id: 'partner_example', event_id: 'evt_1', event_type: 'webhook.test',
      event_data: 'eyJ0eXBlIjoid2ViaG9vay50ZXN0In0=', url: 'https://example.com/saturday',
      status_code: 405, attempts: 1, status: 'failed', created_at: 1794765464844,
    },
    request_id: 'req_0a1b2c3d4e61',
  },
  organization: {
    id: 'org_1', partner_id: 'partner_example', display_name: 'Example Club', description: 'Weekend riders',
    sport: 'triathlon', created_at: 1794765412, updated_at: 1794765412, member_count: 0,
  },
  onboarding: {
    schema_version: '1', request_id: 'req_0a1b2c3d4e62',
    questions: [{ field: 'sex', type: 'single_select', required: true, title_en: 'What sex are you?',
      options: [{ value: 'female', label_en: 'Female' }] }],
    attribution: { text: 'Powered by Saturday', logo_url: 'https://saturday.fit/logo.png', link: 'https://saturday.fit', required: true },
  },
  alert_rules: { channel_config: { email: { enabled: false }, push: { enabled: false } }, quiet_hours: { enabled: false } },
  stored_banded_without_numbers: {
    prescription: { calculated_at: 1794764945, profile_complete: false,
      carb_range_g_per_hr: '30-40', sodium_range_mg_per_hr: '300-400', fluid_range_ml_per_hr: '400-500' },
    safety: { max_safe_fluid_ml_per_hr: 1500, max_safe_sodium_mg_per_hr: 3000, confidence_score: 0,
      requires_human_review: false, warnings: [], not_instructions: true },
  },
};
const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

it('types the live webhook, organization, onboarding, alert-rule and banded prescription shapes', () => {
  const filename = join(__dirname, 'live-shapes-fixtures.ts');
  const types: Record<string, string> = {
    webhook_create: 'WebhookCreateResponse', webhook: 'Webhook', webhook_list: 'WebhookListResponse',
    webhook_test: 'WebhookTestResponse', organization: 'Organization', onboarding: 'OnboardingQuestionsResponse',
    alert_rules: 'AlertRulesDoc', stored_banded_without_numbers: 'StoredPrescriptionResponse',
  };
  const source = `import Saturday, {${Object.values(types).join(',')}} from '../src';\n`
    + Object.entries(types).map(([name, type]) => `const ${name}: ${type} = ${JSON.stringify((fixtures as any)[name])};`).join('\n')
    + `\nasync function read(client: Saturday) {
      const created = await client.webhooks.create('https://example.com/saturday', ['athlete.created']);
      const secret: string = created.webhook.secret;
      const id: string = created.webhook.id;
      // @ts-expect-error the secret is under webhook, not at the top level
      created.secret;
      const createdAt: number = (await client.webhooks.get(id)).created_at;
      const status: number = (await client.webhooks.test(id)).delivery.status_code;
      const attempts: number = (await client.webhooks.listDeliveries(id)).deliveries[0].attempts;
      const count: number = (await client.webhooks.list()).total;
      const orgCreated: number = (await client.organizations.get('org_1')).created_at;
      const page = await client.athletes.list({ externalId: 'user-42' });
      const rx = (await client.activities.getPrescription('ath_1', 'act_1')).prescription;
      const carbs: string | number | undefined = rx.carb_range_g_per_hr ?? rx.carb_g_per_hr;
      // @ts-expect-error a banded prescription may carry no numbers
      const exact: number = rx.carb_g_per_hr;
      const rules = await client.coach.getNotificationRules();
      await client.coach.setNotificationRules('overall', { ...rules, quiet_hours: { enabled: true, start: '22:00', end: '06:00', tz: 'Europe/Zurich' } });
      const emailOn: boolean | undefined = rules.channel_config?.email.enabled;
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

it('webhooks.create returns the response as sent, with the secret under webhook', async () => {
  global.fetch = jest.fn().mockResolvedValue(Response.json(fixtures.webhook_create, { status: 201 }));
  const client = new Saturday({ apiKey: 'sk_test_fixture', maxRetries: 0 });
  const created = await client.webhooks.create('https://example.com/saturday', ['athlete.created']);
  expect(created.webhook.secret).toHaveLength(64);
  expect(created).toEqual(fixtures.webhook_create);
});

it('webhooks.listDeliveries reads the deliveries route', async () => {
  const body = { deliveries: [fixtures.webhook_test.delivery], total: 1, request_id: 'req_1' };
  const mock = jest.fn().mockResolvedValue(Response.json(body));
  global.fetch = mock;
  const client = new Saturday({ apiKey: 'sk_test_fixture', maxRetries: 0 });
  expect(await client.webhooks.listDeliveries('wh_1')).toEqual(body);
  expect(mock.mock.calls[0][0]).toBe('https://api.saturday.fit/v1/webhooks/wh_1/deliveries');
  expect(mock.mock.calls[0][1].method).toBe('GET');
});

it('athletes.list sends externalId as the external_id query parameter', async () => {
  const mock = jest.fn().mockResolvedValue(Response.json({ athletes: [], pagination: { total: 0, has_more: false }, request_id: 'req_1' }));
  global.fetch = mock;
  const client = new Saturday({ apiKey: 'sk_test_fixture', maxRetries: 0 });
  await client.athletes.list({ externalId: 'user 42' });
  expect(mock.mock.calls[0][0]).toBe('https://api.saturday.fit/v1/athletes?external_id=user+42');
});
