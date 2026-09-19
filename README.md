# Saturday TypeScript SDK

[![npm](https://img.shields.io/npm/v/@saturdayinc/sdk)](https://www.npmjs.com/package/@saturdayinc/sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Official TypeScript/Node.js SDK for the [Saturday Nutrition Intelligence API](https://docs.saturday.fit).

Personalized fuel, hydration, and electrolyte prescriptions for endurance athletes.

## Install

```bash
npm install @saturdayinc/sdk
```

## Quick Start

```typescript
import Saturday from '@saturdayinc/sdk';

const saturday = new Saturday({ apiKey: 'sk_live_...' });

// Calculate a nutrition prescription
const prescription = await saturday.nutrition.calculate({
  activity_type: 'bike',
  duration_min: 180,
  athlete_weight_kg: 75,
  thermal_stress_level: 7,
  is_race: true,
});

// Safety metadata is included on every tier.
console.log(prescription.safety.warnings);
const carbs = prescription.carb_range_g_per_hr ?? prescription.carb_g_per_hr ?? 0;
const sodium = prescription.sodium_range_mg_per_hr ?? prescription.sodium_mg_per_hr ?? 0;
const fluid = prescription.fluid_range_ml_per_hr ?? prescription.fluid_ml_per_hr ?? 0;
console.log(`Carbs: ${carbs} g/hr`);
console.log(`Sodium: ${sodium} mg/hr`);
console.log(`Fluid: ${fluid} mL/hr`);
```

Teaser responses and incomplete profiles return ranges. A `full` tier alone does not guarantee exact numbers. Exact zero values may be omitted from the response, so the example displays them as `0`. See [Athlete Onboarding](https://docs.saturday.fit/guides/onboarding).

## Features

- TypeScript response types for nutrition, activity prescriptions, and batch results
- Automatic retry with exponential backoff (429s and 5xx)
- Typed errors (AuthenticationError, RateLimitError, ValidationError, NotFoundError)
- API key and OAuth2 Bearer token authentication
- Safety types prominently surfaced (`SafetyMetadata`, `not_instructions`)

## Authentication

```typescript
// API key (server-to-server)
const serverClient = new Saturday({ apiKey: 'sk_live_...' });

// OAuth2 Bearer token (athlete-delegated access)
const delegatedClient = new Saturday({
  apiKey: 'sk_live_...',
  bearerToken: 'eyJ...',
});
```

## Resources

| Resource | Description |
|----------|-------------|
| `saturday.nutrition` | Calculate prescriptions, batch calculate |
| `saturday.athletes` | Athlete CRUD, settings, batch create, GDPR export |
| `saturday.activities` | Activity CRUD, prescription calculation, import, feedback |
| `saturday.products` | Product search, barcode lookup, curated list |
| `saturday.ai` | Conversation metadata and history; see AI writes below |
| `saturday.webhooks` | Webhook registration and management |
| `saturday.organizations` | Team/org management and member directories |
| `saturday.gear` | Athlete gear inventory |
| `saturday.knowledge` | Sports nutrition knowledge base search |

## Prescription and batch responses

Responses remain raw JSON objects. `nutrition.calculate()` returns flat nutrition fields. `activities.calculatePrescription()` returns a `PrescriptionEnvelope`: full-tier results are under `prescription`, while teaser ranges are at the top level. Full-tier prescriptions can also contain ranges when inputs are incomplete.

`activities.getPrescription()` returns `{ prescription, safety }`, with no `tier` field. Activity timestamps, including `prescription.calculated_at`, use epoch seconds; `trial_ends_at` uses epoch milliseconds. Safety warnings may be `null`.

```typescript
const saturday = new Saturday({ apiKey: 'sk_live_...' });
const stored = await saturday.activities.getPrescription('ath_123', 'act_123');
const carbs = stored.prescription.carb_range_g_per_hr ?? stored.prescription.carb_g_per_hr;
console.log(`Carbs: ${carbs} g/hr`);
for (const warning of stored.safety.warnings ?? []) console.log(warning);
```

Batch calculations return flat `results[]`, not indexed prescription wrappers. Athlete batches return `created[]`, not `athletes[]`. Success arrays preserve input order with failed items omitted; `errors[]` contains each failed item's original `index`, `code`, and `message`. Do not use a success-array position as the original input index after partial failure.

`activities.importActivities(athleteId, activities, { calculate: true })` creates activities and optionally calculates prescriptions. Omit the third argument to avoid global calculation; individual activities may explicitly set `calculate: true`. A global `false` does not override a per-activity `true`. Calculation outcomes appear in `prescriptions[]`; a failed calculation does not undo an imported activity. Each batch/import item counts toward the applicable quota; requested calculations may also consume trial calls.

The corrected declarations can expose TypeScript errors in code that relied on the former shapes. Update field access rather than casting to the old flat nutrition type. No response flattening or runtime conversion is performed.

## AI writes

`ai.createConversation()` and `ai.sendMessage()` currently do not support the API's server-sent event (SSE) responses. Conversation creation also uses an outdated request field. Use direct HTTP for these two operations while [streaming support is being aligned](https://github.com/SaturdayInc/saturday-node/issues/12). The metadata and history read methods use JSON.

For a partner with AI access enabled, this request starts a conversation and prints the complete event stream, including safety warnings and errors:

```bash
curl --no-buffer --fail-with-body https://api.saturday.fit/v1/ai/conversations \
  -H "Authorization: Bearer $SATURDAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"athlete_id":"YOUR_ATHLETE_ID","message":"Help me review my fueling plan"}'
```

The first `message_start` event supplies `conversation_id`. Send subsequent messages to `POST /v1/ai/conversations/{conversation_id}/messages` with a `message` field and consume the same SSE format. Do not parse a successful stream as JSON or discard `safety_warning` and `error` events.

## Documentation

Full API documentation: [docs.saturday.fit](https://docs.saturday.fit)

## Requirements

- Node.js 18+ (uses native `fetch`)
- TypeScript 5.0+ (for type inference)

## License

MIT
