# Saturday TypeScript SDK

[![npm](https://img.shields.io/npm/v/@saturdayinc/sdk)](https://www.npmjs.com/package/@saturdayinc/sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

The official TypeScript and Node.js client for the [Saturday API](https://docs.saturday.fit): carbohydrate, sodium and fluid prescriptions for endurance sessions, sized to each athlete, and product fit and prep against them.

## Install

```bash
npm install @saturdayinc/sdk
```

Node.js 18 or later. No runtime dependencies.

## Get a key

A key comes with any paid Saturday plan, member or coach: sign in at [saturday.fit/api](https://saturday.fit/api) to make yours. It is shown once and emailed to you. A new key covers 10 athletes; to cover more, write to [api@saturday.fit](mailto:api@saturday.fit) about what you're building. Platform partners get keys with their agreement.

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

- `precision.missing_fields` lists what is still unanswered, most impactful first, with how much each answer would narrow the ranges. `required: true` marks the safety core; every listed field is needed for exact numbers, `required` or not.
- `precision.missing_profile_fields` names the athlete's profile answers still missing: collect them in your UI (`saturday.onboarding.questions()` gives the questions) or send the athlete to `precision.onboarding.url`.
- `precision.missing_session_inputs` names the session inputs your call left out. Send every session input on every call: `intensity_level`, `thermal_stress_level`, `meal_before_min` and `is_race`. One left out returns ranges even for a complete profile; `precision.onboarding` comes only when profile answers are missing.
- Per-hour figures are whole numbers, as the Saturday app's Fuel card shows them, which is not always the total divided by the session's hours. Totals are for the whole session.
- A zero may be omitted from the response, so read numbers with `?? 0`.
- A new athlete's first calculation, product fit or compare starts a trial of the full tier: 15 calls on the first day, then 5 a day, each fit and compare spending one. `trial_calls_remaining_today` and `trial_ends_at` show where it stands, and `saturday.partner.get()` gives the trial's length in `rate_limits.trial_days`. Past a bound the answer is ranges with a flag and a note you can show the athlete: `trial_cap_reached` (today's calls are used), `trial_start_deferred` (your key has started its new trials for the day) or `trial_profile_limit_reached` (the trial covers a set number of distinct profiles), each with `trial_cap_note` or `trial_note`.

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
  intensity_level: 7,
  thermal_stress_level: 5,
  meal_before_min: 120,
  is_race: true,
});
if (fit.tier === 'full') console.log(fit.fit?.verdict);

const brickFit = await saturday.nutrition.productFit({
  athlete_id: 'ATHLETE_ID',
  product_query: 'maurten gel 100',
  activity_type: 'brick',
  meal_before_min: 120,
  is_race: false,
  legs: [
    { activity_type: 'bike', duration_min: 90, intensity_level: 6, thermal_stress_level: 6 },
    { activity_type: 'run', duration_min: 30, intensity_level: 7, thermal_stress_level: 6 },
  ],
});
for (const leg of brickFit.legs ?? []) console.log(`${leg.activity_type}: ${leg.fit.max_servings} servings`);
```

A stored activity uses `type` and `is_race_event`; a calculation uses `activity_type` and `is_race`. The API refuses the other spelling with a `ValidationError` whose `code` is `unsupported_field`.

When the athlete's profile or the session is missing inputs, prep, product fit and compare plan from the middle of the athlete's ranges and say so in `plan_basis`: its `source` is `profile_incomplete`, `session_incomplete` or both, `missing_profile_fields` and `missing_session_inputs` list what is missing, and `onboarding` comes only when profile answers are. A trial past today's calls plans from ranges too, with `source` `trial_allowance`. Show `plan_basis.message` with the plan. Product answers follow the athlete's Saturday subscription or trial: without one, `tier` is `'teaser'` and the response carries product categories in place of the fit.

`activities.update` with a change to the session (`type`, `legs`, `duration_min`, effort, heat, `is_race_event` or `meal_before_min`) removes the stored prescription: `getPrescription` answers `NotFoundError` (`prescription_not_found`) until you calculate the activity again. A field sent at its stored value changes nothing.

## Bricks and triathlons

A brick or a triathlon is one session with legs: send it as one call, never one per leg. Each leg carries its own effort and heat; `duration_min` is the legs' total and may be left out.

```typescript
import Saturday from '@saturdayinc/sdk';

const saturday = new Saturday({ apiKey: process.env.SATURDAY_API_KEY! });

const brick = await saturday.nutrition.calculate({
  athlete_id: 'ATHLETE_ID',
  activity_type: 'brick',
  meal_before_min: 120,
  is_race: false,
  legs: [
    { activity_type: 'bike', duration_min: 90, intensity_level: 6, thermal_stress_level: 6 },
    { activity_type: 'run', duration_min: 30, intensity_level: 7, thermal_stress_level: 6 },
  ],
});
for (const leg of brick.legs ?? []) console.log(`${leg.duration_min} min: ${leg.total_carb_g} g carbs`);

const stored = await saturday.activities.create('ATHLETE_ID', {
  type: 'triathlon',
  meal_before_min: 240,
  is_race_event: true,
  legs: [
    { type: 'swim', duration_min: 30, intensity_level: 7, thermal_stress_level: 3 },
    { type: 'bike', duration_min: 80, intensity_level: 7, thermal_stress_level: 6 },
    { type: 'run', duration_min: 40, intensity_level: 7, thermal_stress_level: 7 },
  ],
});
const calculated = await saturday.activities.calculatePrescription('ATHLETE_ID', stored.id);
console.log(calculated.prescription?.legs);

// One product list per leg; send `products` instead to size one list against each leg.
const prep = await saturday.activities.prep('ATHLETE_ID', stored.id, {
  legs: [
    { products: [] },
    { products: [{ product_query: 'tailwind endurance fuel' }] },
    { products: [{ product_query: 'maurten gel 100', servings: 2 }] },
  ],
});
for (const leg of prep.legs ?? []) console.log(leg.activity_type, leg.products.length, leg.remaining_gap);
```

- `legs` on an exact answer (calculate, batch, the stored prescription, import) is each leg's share, in order, as the Saturday app's leg cards show it. Answers with ranges carry no leg figures.
- A leg's sport is `activity_type` on a calculation and `type` on an activity, as for a single session.
- `activities.update` with `legs` replaces them; a brick or triathlon refuses a top-level effort or heat. Changing `type` to a single sport drops the legs.
- Prep, product fit and compare answer `legs` too: each leg's share with the products sized against it, as the Saturday app's Prep page for that leg sizes them. Fit and compare also size the whole session at the top level; prep's top level is its legs added up, each product once. A plan from ranges (`plan_basis`) carries no legs.
- Prep takes `products`, sized against each leg with its `servings` counting per leg, or `legs`, one product list per leg in order, never both (a `ValidationError` on `products`). Per-leg lists on a single session, or a count other than the activity's legs, are refused with a `ValidationError` on `legs`.
- `saturday.reference.activityTypes()` lists the rules under `linked_session_types`.

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
| `saturday.integrations` | `sync` (intervals.icu), `status`, `disconnect` |
| `saturday.testing` | `simulateSubscription` (test keys only) |
| `saturday.meta` | `discovery`, `errors`, `health` |
| `saturday.knowledge` | `search`, `listTopics`, `getArticle` (early access) |
| `saturday.coach` | Roster reads, alert and report configuration, coach webhooks and billing reads, with a coach key |

Every method returns the API's JSON as typed. Lists keep their array under its name (`athletes`, `activities`) with `pagination.next_cursor` to pass back as `cursor`. Batch responses keep request order with failed items left out; match a failure to your input by `errors[].index`.

Every timestamp a partner key receives is a number of Unix seconds: on athletes, activities, webhooks and their deliveries, API keys, your account, `trial_ends_at`, the fueling profile's `updated_at`, the export's `exported_at` and every time in its records. Coach routes answer in Unix milliseconds.

`athletes.updateSettings` replaces the whole settings object: send every setting you want kept. `athletes.delete` removes the athlete and everything stored under them in your account. `athletes.erase` is for a right-to-erasure request: it first revokes, at the provider, each connection you supplied for the athlete with `integrations.sync`, then deletes the athlete, everything stored under them and their link to a Saturday account. A linked athlete's own Saturday account is not changed. A 503 with code `provider_erasure_incomplete` means nothing was deleted yet: call `erase` again.

`integrations.sync('intervals_icu', ...)` fetches the activities of the intervals.icu user an access token belongs to, a token your intervals.icu app obtained, and stores them under your athlete; it is the only provider sync takes. Send TrainingPeaks workouts with `activities.importActivities` once the athlete agrees to share them. `integrations.disconnect` ends the connection you supplied and keeps the activities already synced.

Nutrition and knowledge sit behind [feature gates](https://docs.saturday.fit/guides/feature-gates) that Saturday opens per partner. Until a gate is open for your key, its routes answer `403` with code `feature_alpha` (`PermissionError`); ask api@saturday.fit to open one.

## Your own athlete ids

`external_id` is unique within your account. A create, batch item or update with an `external_id` another of your athletes holds changes nothing and throws a `ConflictError` (409, code `athlete_exists`) whose `athleteId` names that athlete, so a retried create is safe. `athletes.list({ externalId })` finds the athlete too.

```typescript
import Saturday, { ConflictError } from '@saturdayinc/sdk';

const saturday = new Saturday({ apiKey: process.env.SATURDAY_API_KEY! });
async function athleteFor(externalId: string) {
  try {
    return await saturday.athletes.create({ external_id: externalId, name: 'Sam' });
  } catch (error) {
    if (error instanceof ConflictError && error.athleteId) return saturday.athletes.get(error.athleteId);
    throw error;
  }
}
console.log((await athleteFor('user-42')).id);
```

## Webhooks

`webhooks.create()` returns the new webhook under `webhook`, with `secret`, the key that signs every delivery. It is returned this once: store it before anything else. `webhooks.test()` delivers a `webhook.test` event at once and returns the delivery record with your endpoint's status code; `webhooks.listDeliveries()` returns the 50 most recent attempts. Webhook and delivery times, and each event's `created_at`, are Unix seconds, as is the signature header's `t`.

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

Every API error is a `SaturdayError` with `status`, `code`, `message`, `requestId` and the full `error` object. Subclasses: `ValidationError` (400, with `param`, and `suggestion` for a field the request does not take), `AuthenticationError` (401), `PermissionError` (403: `feature_alpha`; `plan_inactive` when the paid plan a key comes with has ended; `resource_limit_exceeded` when the key's athletes are at their limit), `NotFoundError` (404), `ConflictError` (409, with `athleteId`), `RateLimitError` (429).

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
  } else if (error instanceof ValidationError && error.code === 'unsupported_field') {
    console.log(`${error.param} is not a field of this request; send ${error.suggestion ?? 'the documented fields'}`);
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
| `simulated_subscriber_daily_limit_reached` | Test environment: your key has marked its day's athletes with `testing.simulateSubscription`; athletes already marked keep their simulated subscription | Same |

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

Partner keys start `sk_live_` or `sk_test_`; coach keys start `cp_live_` or `cp_test_`. A test key reaches the test environment, where `saturday.testing.simulateSubscription(athleteId)` gives an athlete the full tier: by default up to 10 athletes a key a UTC day, each with up to 100 exact answers over 3 distinct profiles, then ranges with `simulated_limit_reached`.

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
