# Saturday TypeScript SDK

[![npm](https://img.shields.io/npm/v/@saturdayinc/sdk)](https://www.npmjs.com/package/@saturdayinc/sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Official TypeScript/Node.js SDK for the [Saturday Nutrition Intelligence API](https://docs.saturday.fit).

Personalized fuel, hydration, and electrolyte prescriptions for endurance athletes.

## Install

```bash
npm install @saturdayinc/sdk
```

## Quick start

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

Teaser-tier responses and incomplete profiles return ranges rather than exact numbers, and the `full` tier alone does not guarantee exact values. A zero value may be omitted from the response, so the example prints `0` for it. See [Athlete Onboarding](https://docs.saturday.fit/guides/onboarding).

## Features

- TypeScript types for requests, responses, and errors
- Automatic retry for JSON operations, up to 3 times. A `429` is retried after the server's `Retry-After` when that is 30 s or less; a `429` with no `Retry-After` (a daily limit) or a longer one (a block that lasts minutes) throws `RateLimitError` at once. A `5xx` is retried with 1 s, 2 s, and 4 s backoff, except on a `POST` that creates or changes a record, so a retry cannot make a second athlete.
- Typed errors: `AuthenticationError`, `RateLimitError`, `ValidationError`, `NotFoundError`
- API key and OAuth2 Bearer token authentication
- `SafetyMetadata` type with `not_instructions` on every prescription

## Configuration

```typescript
const saturday = new Saturday({
  apiKey: 'sk_test_...',
  baseUrl: 'https://api.saturday.fit', // default
  timeout: 30000, // per attempt, in milliseconds, including the body read; default 30000
  maxRetries: 3, // default; 0 disables retries
});
```

## Authentication

```typescript
// Partner API key (server-to-server)
const serverClient = new Saturday({ apiKey: 'sk_live_...' });

// OAuth2 Bearer token (athlete-delegated access); it takes precedence over the API key
const delegatedClient = new Saturday({
  apiKey: 'sk_live_...',
  bearerToken: 'eyJ...',
});

// Coach API key, for the coach resource
const coachClient = new Saturday({ apiKey: 'cp_live_...' });
```

Partner keys carry the `sk_live_` or `sk_test_` prefix; coach keys carry `cp_live_` or `cp_test_`.

## Resources

| Resource | Description |
|----------|-------------|
| `saturday.nutrition` | Calculate prescriptions, batch calculate |
| `saturday.athletes` | Athlete CRUD, settings, the athlete's shared Saturday app answers, batch create, GDPR data export |
| `saturday.activities` | Activity CRUD, prescription calculation, import, feedback |
| `saturday.webhooks` | Webhook registration and management |
| `saturday.organizations` | Team and organization management with members |
| `saturday.knowledge` | Sports nutrition knowledge base search |
| `saturday.onboarding` | The versioned onboarding question schema, for collecting an athlete's profile in your UI |
| `saturday.coach` | Roster fueling reads, the coach's alert and report configuration, coach webhooks, and read-only billing (`seatState`, `ledger`, `tierStatus`, `connectSummary`, `connectEarnings`, `connectTransactions`, `connectArrangements`; the key must carry `billing:read`), with a coach key |

Nutrition and knowledge sit behind [feature gates](https://docs.saturday.fit/guides/feature-gates) that Saturday opens per partner. Until a gate is open for your key, its routes answer `404` (`NotFoundError`) or `403` with code `feature_alpha`; ask api@saturday.fit to open one.

## Finding an athlete by your own id

`athletes.list({ externalId })` returns the athletes you created with that `external_id`, newest first, in one page. Look an athlete up this way before creating one when a create may have been interrupted: the API does not deduplicate `external_id`.

```typescript
const saturday = new Saturday({ apiKey: 'sk_live_...' });
const { athletes } = await saturday.athletes.list({ externalId: 'user-42' });
const athlete = athletes[0] ?? await saturday.athletes.create({ external_id: 'user-42', name: 'Sam' });
console.log(athlete.id);
```

## Webhooks

`webhooks.create()` returns the new webhook under `webhook`, with `secret`, the key that signs every delivery. It is returned this once: store it before anything else. `webhooks.test()` delivers a `webhook.test` event at once and returns the delivery record with your endpoint's status code; `webhooks.listDeliveries()` returns the 50 most recent attempts.

```typescript
const saturday = new Saturday({ apiKey: 'sk_live_...' });
const { webhook } = await saturday.webhooks.create('https://example.com/saturday', ['athlete.created', 'prescription.calculated']);
const signingSecret = webhook.secret; // store it now
const { delivery } = await saturday.webhooks.test(webhook.id);
console.log(delivery.status, delivery.status_code);
```

Webhook timestamps are Unix milliseconds. See [Webhooks](https://docs.saturday.fit/guides/webhooks) for verifying signatures.

## Coach alert rules

`coach.setNotificationRules()` replaces the whole rule set at a scope, `channel_config` included. Read the rules first and send them back with your change: a set without `channel_config` clears it at that scope, and at the overall scope that turns the coach's email and push alerts off.

```typescript
const coach = new Saturday({ apiKey: 'cp_live_...' });
const rules = await coach.coach.getNotificationRules({ scope: 'overall' });
await coach.coach.setNotificationRules('overall', { ...rules, hourly_cap: { enabled: true, per_hour: 2 } });
```

## Prescription and batch responses

Responses remain raw JSON objects. `nutrition.calculate()` returns flat nutrition fields. `activities.calculatePrescription()` returns a `PrescriptionEnvelope`: full-tier results are under `prescription`, while teaser ranges are at the top level. Full-tier prescriptions can also contain ranges when inputs are incomplete; a banded activity prescription's six numbers are then absent or zero, so read the range first.

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

Athlete and activity list responses keep the resource array under `athletes` or `activities`. Pagination is nested: check `page.pagination.has_more` and pass `page.pagination.next_cursor` as the next request's `cursor` option. `page.pagination.total` counts records on that page, not the entire collection.

The legacy athlete-list `search` and activity-list `type` options are currently ignored by the backend. They remain accepted for source compatibility, but do not filter results.

Athlete settings use flat concern flags, such as `{ sweat_level: 5, gut_distress: true }`, not a nested `concerns` object. `athletes.updateSettings()` replaces the complete settings for a partner-managed athlete; omitted settings reset. Send the complete intended settings, including values you want to preserve. The SDK does not fetch or merge settings implicitly.

## Athlete profile sharing

An athlete whose Saturday account is connected to your athlete record can choose to share their Saturday app answers with you. `athletes.getFuelingProfile(athleteId)` returns a `FuelingProfile`; narrow on `sharing`. Only `on` carries `profile` (sex, age, weight and the fueling answers, each with its `value` and `calculations_use`); `off` and `not_linked` carry a `message` saying why there are none. `athletes.get()` returns the same state as `profile_sharing`.

```typescript
import Saturday, { type FuelingProfileUpdatedEvent, type ProfileSharingChangedEvent } from '@saturdayinc/sdk';

const saturday = new Saturday({ apiKey: 'sk_live_...' });
const fueling = await saturday.athletes.getFuelingProfile('ath_123');
if (fueling.sharing === 'on') {
  const sweat = fueling.profile.sweat_level;
  console.log(`Sweat level ${sweat.value ?? 'not answered'}; calculations use ${sweat.calculations_use}`);
} else {
  console.log(fueling.message);
}

// The two sharing webhooks carry the athlete record, with profile_sharing; read the route again on either.
function onSharingEvent(event: ProfileSharingChangedEvent | FuelingProfileUpdatedEvent) {
  if (event.type === 'athlete.fueling_profile_updated') console.log(event.data.id, event.data.changed_fields);
  else console.log(event.data.id, event.data.profile_sharing);
}
```

`value` is the app answer, `null` when the athlete has not answered it in the app. `calculations_use` says where the value Saturday's calculations use comes from: `partner` (yours), `saturday_app`, or `default`. Full guide: [Reading an athlete's fueling profile](https://docs.saturday.fit/guides/fueling-profile).

## Documentation

Full API reference: [docs.saturday.fit](https://docs.saturday.fit)

## Requirements

- Node.js 18+ (uses native `fetch`)
- TypeScript 5.0+ for the bundled types

## License

MIT
