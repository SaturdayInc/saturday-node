# Saturday TypeScript SDK

[![npm](https://img.shields.io/npm/v/@saturdayinc/sdk)](https://www.npmjs.com/package/@saturdayinc/sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

The official TypeScript and Node.js client for the [Saturday API](https://docs.saturday.fit): carbohydrate, sodium and fluid prescriptions for endurance sessions, sized to each athlete, and product fit and prep against them.

## Install

```bash
npm install @saturdayinc/sdk
```

Node.js 18 or later. No runtime dependencies.

## Quick start

Create an athlete with a complete profile, then calculate a session for them. Use an `sk_test_` key while you build.

```typescript
import Saturday from '@saturdayinc/sdk';

const saturday = new Saturday({ apiKey: process.env.SATURDAY_API_KEY! });

const athlete = await saturday.athletes.create({
  external_id: 'user-42',
  sex: 'female',
  year_of_birth: 1990,
  weight_kg: 62,
  settings: {
    sweat_level: 5,
    saltiness: 5,
    satiety_level: 5,
    fitness_level: 5,
    carb_experience: 'range_40_60',
    usual_carb_consumption: 'range_60_80',
    concerns_answered: true,
  },
});

const plan = await saturday.nutrition.calculate({
  athlete_id: athlete.id,
  activity_type: 'bike',
  duration_min: 180,
  intensity_level: 5,
  thermal_stress_level: 7,
  meal_before_min: 120,
  is_race: false,
});

if (plan.precision?.profile_complete) {
  console.log(`Carbs: ${plan.carb_g_per_hr ?? 0} g/hr`);
  console.log(`Sodium: ${plan.sodium_mg_per_hr ?? 0} mg/hr`);
  console.log(`Fluid: ${plan.fluid_ml_per_hr ?? 0} mL/hr`);
} else {
  console.log(`Carbs: ${plan.carb_range_g_per_hr} g/hr`);
  console.log(`Sodium: ${plan.sodium_range_mg_per_hr} mg/hr`);
  console.log(`Fluid: ${plan.fluid_range_ml_per_hr} mL/hr`);
}
for (const warning of plan.safety.warnings ?? []) console.log(warning);
```

Show `plan.attribution` wherever you show the numbers, and show every safety warning.

## Exact numbers and ranges

A calculation carries exact per-hour numbers and totals only when the athlete's profile is complete and their tier is full; otherwise it carries ranges such as `"60-80"`. `precision.profile_complete` tells you which. `tier: 'full'` alone does not mean exact.

- `precision.missing_fields` lists what is still unanswered, most impactful first, with how much each answer would narrow the ranges. Collect those answers in your UI (`saturday.onboarding.questions()` gives the questions) or send the athlete to `precision.onboarding.url`.
- Send `meal_before_min` and `is_race` on every call. Leaving either out returns ranges even for a complete profile.
- Per-hour figures are whole numbers. For a fasted start (`meal_before_min` over 180) the totals include a 20-minute pre-load, and the per-hour figures spread the totals over the session plus those 20 minutes.
- A zero may be omitted from the response, so read numbers with `?? 0`.
- A new athlete's first calculation starts a 30-day trial of the full tier: 15 calls on the first day, then 5 a day. `trial_calls_remaining_today` and `trial_ends_at` show where it stands.

## Prep and product fit

Store a session, calculate it, then size the products the athlete plans to carry against it.

```typescript
import Saturday from '@saturdayinc/sdk';

const saturday = new Saturday({ apiKey: process.env.SATURDAY_API_KEY! });

const ride = await saturday.activities.create('ATHLETE_ID', {
  type: 'bike',
  duration_min: 150,
  intensity_level: 6,
  thermal_stress_level: 6,
  meal_before_min: 120,
  is_race_event: false,
});
await saturday.activities.calculatePrescription('ATHLETE_ID', ride.id);

const prep = await saturday.activities.prep('ATHLETE_ID', ride.id, {
  products: [
    { product_query: 'maurten gel 100', servings: 2 },
    { product_query: 'tailwind endurance fuel' },
  ],
});
for (const product of prep.products) console.log(`${product.servings} x ${product.product_name}`);
console.log('Still needed:', prep.remaining_gap);

const fit = await saturday.nutrition.productFit({
  athlete_id: 'ATHLETE_ID',
  product_query: 'maurten gel 100',
  activity_type: 'run',
  duration_min: 90,
  meal_before_min: 120,
  is_race: true,
});
if (fit.tier === 'full') console.log(fit.fit?.verdict);
```

A stored activity uses `type` and `is_race_event`; a calculation uses `activity_type` and `is_race`. The API refuses the other spelling with a `ValidationError` whose `code` is `unsupported_field`.

When the athlete's profile is missing answers, prep, product fit and compare plan from the middle of the athlete's ranges and say so in `plan_basis`. Product answers follow the athlete's Saturday subscription or trial: without one, `tier` is `'teaser'` and the response carries product categories in place of the fit.

## Resources

| Resource | Methods |
|----------|---------|
| `saturday.nutrition` | `calculate`, `batchCalculate`, `productFit`, `compareProducts`, `extract` |
| `saturday.athletes` | `create`, `get`, `list`, `update`, `delete`, `getSettings`, `updateSettings`, `getFuelingProfile`, `batchCreate`, `export`, `erase`, `listConsent`, `recordConsent`, `revokeConsent` |
| `saturday.activities` | `create`, `get`, `list`, `update`, `delete`, `calculatePrescription`, `getPrescription`, `prep`, `importActivities`, `submitFeedback` |
| `saturday.onboarding` | `questions` |
| `saturday.reference` | `activityTypes`, `settingsSchema` |
| `saturday.infer` | `activityType`, `brickTypes` |
| `saturday.partner` | `get`, `usage`, `usageDaily`, `listApiKeys`, `createApiKey`, `revokeApiKey`, `rotateApiKey` |
| `saturday.webhooks` | `create`, `list`, `get`, `update`, `delete`, `test`, `listDeliveries` |
| `saturday.organizations` | `create`, `list`, `get`, `update`, `addMember`, `listMembers`, `removeMember`, `setOffer`, `getOffer`, `deleteOffer`, `createSubscription`, `listSubscriptions`, `updateSubscription`, `addLicenses`, `listLicenses`, `removeLicense` |
| `saturday.integrations` | `sync`, `status`, `disconnect` |
| `saturday.testing` | `simulateSubscription` (test keys only) |
| `saturday.meta` | `discovery`, `errors`, `health` |
| `saturday.knowledge` | `search`, `listTopics`, `getArticle` (early access) |
| `saturday.coach` | Roster reads, alert and report configuration, coach webhooks and billing reads, with a coach key |

Every method returns the API's JSON as typed. Lists keep their array under its name (`athletes`, `activities`) with `pagination.next_cursor` to pass back as `cursor`. Batch responses keep request order with failed items left out; match a failure to your input by `errors[].index`.

`athletes.updateSettings` replaces the whole settings object: send every setting you want kept. `athletes.delete` removes the athlete and everything stored under them in your account. `athletes.erase` is for a right-to-erasure request: it also ends the athlete's connected-provider grants, erases what those providers sent, and keeps an audit record of the deletion.

Nutrition and knowledge sit behind [feature gates](https://docs.saturday.fit/guides/feature-gates) that Saturday opens per partner. Until a gate is open for your key, its routes answer `403` with code `feature_alpha` (`PermissionError`); ask api@saturday.fit to open one.

## Finding an athlete by your own id

`athletes.list({ externalId })` returns the athletes you created with that `external_id`, newest first, in one page. The API does not deduplicate `external_id`, so look an athlete up this way before creating one when a create may have been interrupted.

```typescript
import Saturday from '@saturdayinc/sdk';

const saturday = new Saturday({ apiKey: process.env.SATURDAY_API_KEY! });
const { athletes } = await saturday.athletes.list({ externalId: 'user-42' });
const athlete = athletes[0] ?? await saturday.athletes.create({ external_id: 'user-42', name: 'Sam' });
console.log(athlete.id);
```

## Webhooks

`webhooks.create()` returns the new webhook under `webhook`, with `secret`, the key that signs every delivery. It is returned this once: store it before anything else. `webhooks.test()` delivers a `webhook.test` event at once and returns the delivery record with your endpoint's status code; `webhooks.listDeliveries()` returns the 50 most recent attempts. Webhook timestamps are Unix milliseconds.

```typescript
import Saturday from '@saturdayinc/sdk';

const saturday = new Saturday({ apiKey: process.env.SATURDAY_API_KEY! });
const created = await saturday.webhooks.create('https://example.com/saturday', ['athlete.created', 'prescription.calculated']);
const signingSecret = created.webhook.secret; // store it now
const { delivery } = await saturday.webhooks.test(created.webhook.id);
console.log(delivery.status, delivery.status_code, signingSecret.length);
```

See [Webhooks](https://docs.saturday.fit/guides/webhooks) for verifying signatures.

## Coach alert rules

`coach.setNotificationRules()` replaces the whole rule set at a scope, `channel_config` included. Read the rules first and send them back with your change: a set without `channel_config` clears it at that scope, and at the overall scope that turns the coach's email and push alerts off.

```typescript
import Saturday from '@saturdayinc/sdk';

const coach = new Saturday({ apiKey: process.env.SATURDAY_COACH_KEY! });
const rules = await coach.coach.getNotificationRules({ scope: 'overall' });
await coach.coach.setNotificationRules('overall', { ...rules, hourly_cap: { enabled: true, per_hour: 2 } });
```

## Errors, retries and limits

Every API error is a `SaturdayError` with `status`, `code`, `message`, `requestId` and the full `error` object. Subclasses: `ValidationError` (400, with `param`), `AuthenticationError` (401), `PermissionError` (403), `NotFoundError` (404), `RateLimitError` (429).

```typescript
import Saturday, { RateLimitError, ValidationError } from '@saturdayinc/sdk';

const saturday = new Saturday({ apiKey: process.env.SATURDAY_API_KEY! });
try {
  await saturday.nutrition.calculate({ activity_type: 'run', duration_min: 60 });
} catch (error) {
  if (error instanceof RateLimitError && error.dailyLimit) {
    console.log(`${error.code}: resets at ${error.resetsAt?.toISOString()}`);
  } else if (error instanceof RateLimitError) {
    console.log(`${error.code}: try again in ${error.retryAfter} s`);
  } else if (error instanceof ValidationError) {
    console.log(`Fix ${error.param}: ${error.message}`);
  } else {
    throw error;
  }
}
```

A `RateLimitError`'s `code` says which limit was hit:

| `code` | What it means | What the client does |
|--------|---------------|----------------------|
| `rate_limit_exceeded` | Short-term throttle | Waits `retryAfter` seconds and retries |
| `catalog_paced` | New products are paced after a large share of the catalog in 24 hours; products already answered keep working | Retries a wait of 30 seconds or less; returns a longer one to you |
| `rate_limited` | Calculations blocked after an unusual request pattern, for `retryAfter` seconds | Returns it to you |
| `daily_call_limit_reached` | Your daily call ceiling | Returns it to you, with `dailyLimit` true and `resetsAt` (UTC midnight) |
| `intelligence_daily_limit_reached` | Your daily ceiling on calculations, products, inference, knowledge and AI; your athletes, activities and other data keep working | Same |
| `athlete_free_daily_limit_reached` | Your daily budget of calculations sent without an `athlete_id` | Same |
| `distinct_lookup_daily_limit_reached` | Your daily budget of distinct product lookups; repeat lookups keep working | Same |

A 5xx is retried after its `Retry-After` (usually 5 seconds) or after 1 s, 2 s and 4 s, up to `maxRetries` times, except on a `POST` that creates or changes a record (an athlete, an activity, an import, a webhook), since the server may have done the write; the calculation, product, inference, prep and export `POST`s are retried. The client never sleeps longer than 30 seconds inside one call. `saturday.partner.get()` shows your limits and `saturday.partner.usage()` what you have used.

## Configuration

```typescript
import Saturday from '@saturdayinc/sdk';

const saturday = new Saturday({
  apiKey: 'sk_test_...',
  baseUrl: 'https://api.saturday.fit', // default
  timeout: 30000, // per attempt, in milliseconds, including the body read
  maxRetries: 3, // 0 disables retries
});

// An athlete's OAuth2 access token, sent in place of the API key
const delegated = new Saturday({ apiKey: 'sk_live_...', bearerToken: 'eyJ...' });
```

Partner keys start `sk_live_` or `sk_test_`; coach keys start `cp_live_` or `cp_test_`. A test key reaches the test environment, where `saturday.testing.simulateSubscription(athleteId)` gives an athlete the full tier.

## Athlete profile sharing

An athlete who connects their Saturday account to your athlete record can share their Saturday app answers with you. `athletes.getFuelingProfile(athleteId)` returns a `FuelingProfile`; narrow on `sharing`. Only `on` carries `profile`; `off` and `not_linked` carry a `message`.

```typescript
import Saturday, { type FuelingProfileUpdatedEvent, type ProfileSharingChangedEvent } from '@saturdayinc/sdk';

const saturday = new Saturday({ apiKey: 'sk_live_...' });
const fueling = await saturday.athletes.getFuelingProfile('ATHLETE_ID');
if (fueling.sharing === 'on') {
  const sweat = fueling.profile.sweat_level;
  console.log(`Sweat level ${sweat.value ?? 'not answered'}; calculations use ${sweat.calculations_use}`);
} else {
  console.log(fueling.message);
}

// Both sharing webhooks carry the athlete record with profile_sharing.
function onSharingEvent(event: ProfileSharingChangedEvent | FuelingProfileUpdatedEvent) {
  if (event.type === 'athlete.fueling_profile_updated') console.log(event.data.id, event.data.changed_fields);
  else console.log(event.data.id, event.data.profile_sharing);
}
```

Guide: [Reading an athlete's fueling profile](https://docs.saturday.fit/guides/fueling-profile).

## Tests

`npm test` runs the unit tests with mocked HTTP. `test/live.test.ts` runs every partner method against a real API with a test key; [test/LIVE.md](test/LIVE.md) says how.

## Documentation

[docs.saturday.fit](https://docs.saturday.fit)

## License

MIT
