// Tests for the API_OB additions: the onboarding question-schema resource and
// the precision object on calculate responses. The HTTP layer is stubbed via a
// fetch mock so these run offline (no network, no API key needed).
import { Saturday } from '../src/client';
import type {
  NutritionCalculateResponse,
  OnboardingQuestionsResponse,
  Precision,
} from '../src/types';

type FetchArgs = { url: string; method: string };
let lastCall: FetchArgs | null = null;

// Stub global fetch — capture the request, return the queued JSON body.
function mockFetch(body: unknown, status = 200) {
  lastCall = null;
  (global as unknown as { fetch: jest.Mock }).fetch = jest.fn(
    async (url: string, init?: { method?: string }) => {
      lastCall = { url, method: init?.method ?? 'GET' };
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        headers: new Map(),
      } as unknown as Response;
    },
  ) as unknown as jest.Mock;
}

describe('onboarding.questions()', () => {
  it('GETs /v1/onboarding/questions and returns the typed schema', async () => {
    const schema: OnboardingQuestionsResponse = {
      schema_version: '2026-06-12.1',
      questions: [
        {
          field: 'sweat_level',
          type: 'single_select',
          required: true,
          title_en: 'How much do you sweat?',
          options: [
            { value: 1, label_en: 'Light' },
            { value: 5, label_en: 'Average' },
            { value: 9, label_en: 'Heavy' },
          ],
        },
      ],
      attribution: { text: 'Powered by Saturday', logo_url: '', link: '', required: true },
    };
    mockFetch(schema);

    const saturday = new Saturday({ apiKey: 'sk_test_x' });
    const res = await saturday.onboarding.questions();

    expect(lastCall?.method).toBe('GET');
    expect(lastCall?.url).toBe('https://api.saturday.fit/v1/onboarding/questions');
    expect(res.schema_version).toBe('2026-06-12.1');
    expect(res.questions[0].field).toBe('sweat_level');
    expect(res.questions[0].options?.[0].value).toBe(1);
    // Attribution is required when rendering these questions in your UI.
    expect(res.attribution?.required).toBe(true);
  });
});

describe('precision object on calculate', () => {
  it('surfaces bands + missing_fields + onboarding.url when profile incomplete', async () => {
    const incomplete: NutritionCalculateResponse = {
      tier: 'full',
      carb_range_g_per_hr: '60-80',
      safety: { confidence_score: 0.62 } as NutritionCalculateResponse['safety'],
      precision: {
        profile_complete: false,
        missing_fields: [
          {
            field: 'sweat_level',
            required: true,
            // band_impact arrives on the same grid the band endpoints render
            // on: 10 g/hr, 100 mg/hr, 100 mL/hr. Keep fixtures on it.
            band_impact: { carb_g_per_hr: 10, sodium_mg_per_hr: 100, fluid_ml_per_hr: 100 },
          },
        ],
        message: 'Exact numbers unavailable: critical fields missing (sweat_level).',
        onboarding: { url: 'https://saturday.fit/onboard?ot=abc', message: 'Answer once…' },
      },
    };
    mockFetch(incomplete);

    const saturday = new Saturday({ apiKey: 'sk_test_x' });
    const res = await saturday.nutrition.calculate({ activity_type: 'run', duration_min: 90 });

    const p = res.precision as Precision;
    expect(p.profile_complete).toBe(false);
    expect(p.missing_fields?.[0].field).toBe('sweat_level');
    expect(p.missing_fields?.[0].band_impact.sodium_mg_per_hr).toBe(100);
    expect(p.onboarding?.url).toContain('ot=');
  });

  it('carries profile_complete:true with exact numbers when complete', async () => {
    const complete: NutritionCalculateResponse = {
      tier: 'full',
      carb_g_per_hr: 70,
      sodium_mg_per_hr: 900,
      fluid_ml_per_hr: 1000,
      safety: { confidence_score: 1.0 } as NutritionCalculateResponse['safety'],
      precision: { profile_complete: true },
    };
    mockFetch(complete);

    const saturday = new Saturday({ apiKey: 'sk_test_x' });
    const res = await saturday.nutrition.calculate({ activity_type: 'run', duration_min: 90 });

    expect(res.precision?.profile_complete).toBe(true);
    expect(res.precision?.missing_fields).toBeUndefined();
    expect(res.carb_g_per_hr).toBe(70);
  });
});
