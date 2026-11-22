# Changelog

## 0.9.0

Breaking changes:

- `sweat_level`, `satiety_level` and `fitness_level` on a calculate request are `AppLevel` (`1 | 3 | 5 | 7 | 9`) and `saltiness` is `AppSaltiness` (`1 | 5 | 9`), the levels the Saturday app stores; the API refuses any other value with a `ValidationError` of code `invalid_value`, and on an athlete's settings too. `carb_upper_limit_override` takes 50 to 150 g/hr in steps of 10 (code `out_of_range` otherwise). `SettingsFieldSchema` gains `values` and `step`.
- `new Saturday()` checks its options and throws a `TypeError` naming the one at fault: an `apiKey` that is not a string, is empty without a `bearerToken`, or holds a control character; a `bearerToken` with a control character; a `timeout` that is not a finite number above 0 (`timeout: 0` used to mean the default); a `maxRetries` that is not a whole number of 0 or more.
- A request that gets no answer (a DNS failure, a refused or reset connection) throws `SaturdayError` with `status` 0 and `code` `connection_error`, as a timeout does, and is not retried. It threw fetch's `TypeError`.
- `request()` refuses an absolute or scheme-relative URL with a `TypeError`, so the key goes only to `baseUrl`. An id of `.` or `..` is refused the same way.

Added:

- `athletes.createOnboardingLink(athleteId, { locale })` (`POST /v1/athletes/{athlete_id}/onboarding-link`) returns `OnboardingLink`: a fresh link to the hosted onboarding page (`url`), valid until `expires_at` (Unix seconds, 90 days on). Call it from your refresh address, where an athlete who opens an expired link is sent with `athlete_id` and `locale` in the query, and redirect them to `url`. Production refuses it with a `PermissionError` (`hosted_onboarding_unavailable`) until the page opens there. A 5xx on it is retried.
- `PartnerAccount.return_url` and `PartnerAccount.refresh_url`: the addresses on your account that the hosted onboarding page sends athletes to.
- `organizations.list({ limit, cursor })`: one page of organizations, newest first, `limit` 1 to 200 (default 50); pass `pagination.next_cursor` back as `cursor`.
- `nutrition.batchCalculate(scenarios, { estimateOnly: true })` returns `total` and `estimated_ms`, the expected wall time of the real call, without calculating or counting against your limits.
- `CoachWebhookEvent` takes `coach.message.sent`, `athlete.deleted` and `'*'` (every coach event). Leaving `events` out of `coach.registerWebhook` subscribes to `concern.detected` and `athlete.needs_attention`.

Fixed:

- Coach ids are encoded into the path in `coach.fuelingRollup`, `report`, `reportPdf`, `sessionDetail`, `deleteWebhook`, `disableWebhook` and `enableWebhook`. An id holding `/`, `?` or `..` could reach another route.
- A lowercase method passed to `request()` is upper-cased first, so a `post` that creates a record is no longer retried after a 5xx.
- `Retry-After` as an HTTP date is read as the seconds until that date. An empty or unreadable header counts as absent (an empty one used to retry at once), and a negative one as 0.
- An error answer whose body is `null`, a string, a number or an array throws the status's `SaturdayError` subclass with `code` `unknown` and the message `HTTP <status>`. It threw a `TypeError`, or an error with no `code`.
- The wait between 5xx retries stops growing at 30 seconds, the longest `Retry-After` the client waits.
- `CreateAthleteRequest` says what a create needs: nothing on `athletes.create` (the answer carries the athlete's `id`), and one of `name`, `email` or `external_id` per `batchCreate` item (`missing_identifier` otherwise).
- `meta.errors()`: the catalog lists `missing_identifier` (a batch item with no identifier) and, for a key with nutrition open, `product_not_found`, and its `retryable` is `false` for the daily ceilings (fuel-backend #2424). `ErrorCatalogEntry.retryable` says what it means: whether to retry the same call automatically after `Retry-After`.

## 0.8.0

Breaking changes:

- `integrations.sync` takes `'intervals_icu'` only (the new `SyncProvider` type): the API refuses Strava and TrainingPeaks tokens with a `ValidationError` of code `invalid_provider`. Send TrainingPeaks workouts with `activities.importActivities` once the athlete agrees to share them. The sync answer is `{ result, request_id }`, with what the sync did under `result` (`IntegrationSyncResult`, whose `status` is `completed`, `partial` or `failed`). `date_range` takes `start` and `end` (it said `from` and `to`, which the API never read), `refresh_token` is gone (the API did not use it), and the client sends `sync_types: ['activities']` when you leave it out. `IntegrationProvider` is `'intervals_icu' | 'strava' | 'training_peaks'`, the providers `status` and `disconnect` take, and `integrations.disconnect` returns `IntegrationDisconnectResponse` (`message`, `provider`, `request_id`), and throws `NotFoundError` (`integration_not_found`) for a provider the athlete never connected.
- `external_id` is unique within your account. `athletes.create` or `athletes.update` with an `external_id` another of your athletes holds changes nothing and throws the new `ConflictError` (409, code `athlete_exists`), whose `athleteId` names that athlete; a `batchCreate` item fails with `athlete_exists` and `errors[].athlete_id`. A retried create is safe.
- `DiscoveryResponse` is typed in full and has no open index: `get_a_key` (`DiscoveryKeyInfo`) says how a key is had (any paid Saturday plan, made at saturday.fit/api, `athletes_per_key`, `api@saturday.fit`). The API no longer sells a key, so nothing in the package names a price or a signup route.
- `products`, `gear` and `ai` are removed, with their types and `AIStreamError`. Those routes are not open to partner keys.
- `webhooks.create(url, events)` returns `WebhookCreateResponse`: the webhook (`WebhookFull`), with its signing secret, is under `webhook`; read `created.webhook.secret`. The `description` argument is gone; the API does not take one.
- `organizations.create` takes an object (`{ display_name, description?, sport? }`) and `organizations.addMember` takes `{ email, role?, athlete_id? }`.
- `knowledge.search` takes `{ query, limit?, category? }`.
- Every timestamp a partner key receives is Unix seconds, matching the API: webhooks and deliveries, `WebhookEvent.created_at`, `PartnerAccount.created_at`, `ApiKeyInfo` and `CreatedApiKey` times, `TrialMetadata.trial_ends_at`, the fueling profile's `updated_at` and `IntegrationStatusResponse.status.last_sync_at` were milliseconds. `AthleteDataExport.exported_at` is a number of Unix seconds (it was an RFC 3339 string), and every time in the export's records is Unix seconds. Coach types keep Unix milliseconds.
- `athletes.list` drops the `search` option and `activities.list` the `type` option, which the API ignored. `athletes.list` gains `externalId` (the athletes you created with that `external_id`, newest first) and `profileComplete`.
- Retries follow what the API says. A `RateLimitError` is read by its `code`: `rate_limit_exceeded` (a throttle) is retried after `Retry-After`, and `catalog_paced` when that wait is 30 s or less; `rate_limited` (a block after an unusual request pattern) and the four daily ceilings (`daily_call_limit_reached`, `intelligence_daily_limit_reached`, `athlete_free_daily_limit_reached`, `distinct_lookup_daily_limit_reached`) throw at once. A daily ceiling has `dailyLimit` true and `resetsAt`, the UTC midnight it resets at. A 429 with no `Retry-After` is treated as a daily ceiling. A 5xx is retried after its `Retry-After`, or after 1 s, 2 s and 4 s, except on a `POST` that creates or changes a record, since the server may have done the write; calculation, product, inference, prep and export `POST`s still are, with every `GET`, `PUT`, `PATCH` and `DELETE`. The client never sleeps longer than 30 s inside one call.
- `SaturdayError.retryAfter`, from `Retry-After` on any error that carries one. `DAILY_LIMIT_CODES` and the `RateLimitCode` type are exported.
- `organizations.updateSubscription` takes `seats`, `status`, `start_date` and `end_date` (Unix seconds); the API refuses any other field.
- 403 responses raise the new `PermissionError`.
- `NutritionCalculateRequest` is a union of `SingleSessionCalculateRequest` and `LinkedSessionCalculateRequest`, and `CreateActivityRequest` of `SingleActivityRequest` and `LinkedActivityRequest`: a brick or triathlon carries `legs` and no top-level `intensity_level` or `thermal_stress_level`. `UpdateActivityRequest` is its own interface. `ImportActivityRequest` is `CreateActivityRequest & { calculate? }`.
- `PlanBasis.source` is `PlanBasisSource` (`profile_incomplete`, `session_incomplete`, `profile_and_session_incomplete`, `stored_ranges`), with `missing_profile_fields` and `missing_session_inputs`. `ProductSession` documents no defaults: a session input left out plans from ranges.
- `ApiKeyInfo.last_used_at` is always present: 0 for a key never used.
- `ProductSession` is a union of `SingleProductSession` and `LinkedProductSession`, and `ProductCompareRequest` is a type, no longer an interface: product fit and compare take a brick or triathlon with `legs`. Compare's `winner` is the named `ComparisonWinner`.

Added:

- `ConflictError` (409), with `athleteId`; `SaturdayErrorDetail.athlete_id` and `BatchError.athlete_id`.
- The trial's bounds on calculate and the activity calculate (`TrialMetadata`): `trial_start_deferred` (your key has started its new trials for the UTC day), `trial_profile_limit_reached` (the athlete's trial covers its allowance of distinct profiles), `trial_answers_used_up` (the athlete's trial has given all its exact answers) and `trial_note`, words you can show the athlete; on the test environment, `simulated_limit_reached` and `simulation_note`. Product fit and compare answers carry `trial_start_deferred` and `trial_note` on the teaser tier. `PlanBasisSource` gains `trial_allowance` (product fit and compare spend one of the athlete's trial calls, as calculate does, and plan from ranges once today's calls or the trial's exact answers are used) and `simulation_allowance`.
- `PartnerAccount.rate_limits` gains `trial_starts_per_day`, `trial_profiles_per_athlete`, `trial_days` (the trial's length) and `trial_answers` (the exact answers one athlete's trial gives in all). `PartnerAccount.plan` `individual` is a key that comes with a Saturday account's paid plan.
- `DAILY_LIMIT_CODES` gains `simulated_subscriber_daily_limit_reached`: on the test environment, `testing.simulateSubscription` marks at most 10 athletes per key per UTC day by default, then throws a `RateLimitError` with `dailyLimit` true and `resetsAt`.
- `PermissionError` documents `plan_inactive` (the paid plan a key comes with has ended; the key works again, with its athletes, once the plan is active) and `resource_limit_exceeded` (the key's athletes are at their limit).
- Documented: `activities.update` with a change to the session removes the stored prescription, so `getPrescription` answers 404 `prescription_not_found` until the activity is calculated again; `activities.prep` refuses `products` beside `legs` (`invalid_value` on `products`); `athletes.erase` revokes the connections you supplied, deletes everything stored under the athlete and its link to a Saturday account, leaves the member's own Saturday account as it is, and answers 503 `provider_erasure_incomplete`, having deleted nothing, when a connection could not be revoked yet. The README's new "Get a key" section: a key comes with any paid Saturday plan, from saturday.fit/api, and covers 10 athletes; for more, write to api@saturday.fit.
- `nutrition.productFit`, `nutrition.compareProducts` and `activities.prep`, with `PlanBasis` for plans made from the middle of the ranges, naming what is missing.
- Prep, product fit and compare on a brick or triathlon: `ProductFitLeg` and `ProductCompareLeg` under `legs` on the fit and compare answers, each leg's share with the product or products sized against it; `PrepRequest.legs` (`PrepLegInput`) for a product list per leg, and `PrepLeg` under `PrepResponse.legs`, whose top level is the legs added up.
- `Precision.missing_profile_fields` and `Precision.missing_session_inputs`: the profile answers and session inputs a calculation lacks, sent to a partner key on every tier. `MissingField.required` documents what it marks: the safety core, with every listed field needed for exact numbers.
- Bricks and triathlons: `SessionType`, `LinkedSessionType`, `CalculateLeg` and `ActivityLeg` for `legs` on calculate, batch, activity create, import and update; `LegPrescription` for each leg's share under `legs` on `NutritionCalculateResponse` and `ActivityPrescription`; `Activity.legs`. `reference.activityTypes({ activityType })` filters, and `ActivityTypesResponse.linked_session_types` (`LinkedSessionTypeInfo`) carries the rules for legs.
- `ValidationError.suggestion`: for code `unsupported_field`, the field the request was probably meant to send, read from the API's message. `param` is the field's path in your body (`legs[1].duration_mins`).
- `Precision.message` and `Precision.onboarding` document what a partner key gets: the missing profile answers apart from the session inputs, and the onboarding link only for profile answers.
- `nutrition.extract` (nutrition label reading), `infer.activityType`, `infer.brickTypes`, `reference.activityTypes`, `reference.settingsSchema`.
- `athletes.erase` (`POST /v1/athletes/{id}/delete`), `athletes.listConsent`, `recordConsent`, `revokeConsent`.
- `partner.get`, `usage`, `usageDaily`, `listApiKeys`, `createApiKey`, `revokeApiKey`, `rotateApiKey`.
- `webhooks.listDeliveries` (`WebhookDeliveryList`); `webhooks.test` returns `WebhookTestResponse` (`delivery`, with your endpoint's `status_code`); `organizations.update`, offers and seat subscriptions with licenses; `integrations.sync`, `status`, `disconnect`; `testing.simulateSubscription`; `meta.discovery`, `errors`, `health`.
- `SaturdayError.code`.
- `AlertRulesDoc` gains `channel_config` (`ChannelConfig`: the email address and push devices alerts go to). A read always carries it, and `coach.setNotificationRules()` replaces it with the rest of the set: send back the one you read. Left out at the overall scope, the coach's email and push alerts turn off.
- Request types document `meal_before_min` (over 180 is a fasted start), `is_race`, even effort levels and whole-number per-hour figures.
- A live suite (`test/live.test.ts`) and a type check of its recorded responses. The suite covers bricks and triathlons through calculate, batch, activity create, prep, update and import.

Earlier unreleased changes:

- `import Saturday from '@saturdayinc/sdk'` now gives the client class in a plain Node ES module (an `.mjs` file, or a project with `"type": "module"`). Before, Node handed back the module object there and `new Saturday(...)` threw `Saturday is not a constructor`; TypeScript, bundlers and `require` were unaffected, and `import { Saturday }` worked everywhere. The package gains an `exports` map with an ES module entry, so imports of files inside the package (`@saturdayinc/sdk/dist/...`) no longer resolve.
- Add `athletes.getFuelingProfile(athleteId)` for `GET /v1/athletes/{id}/fueling-profile`: the athlete's Saturday app answers while they share them with you. Returns `FuelingProfile`, a union to narrow on `sharing`: `on` carries `profile` (`FuelingProfileAnswers`, each a `FuelingProfileField` with `value` and `calculations_use`) and `updated_at`; `off` and `not_linked` carry `message`. `Athlete` gains the optional `profile_sharing` (`ProfileSharing`: `on`, `off` or `not_linked`), returned by `athletes.get`.
- Add webhook body types: `WebhookEvent`, and `ProfileSharingChangedEvent` and `FuelingProfileUpdatedEvent` for `athlete.profile_sharing_changed` and `athlete.fueling_profile_updated`, whose data is the athlete record (the second adds `changed_fields`). `WebhookEventType` is exported and lists the names registration accepts: it gains `athlete.profile_completed`, the two sharing events and `webhook.test`, and drops `prescription.updated` and `partner.rate_limit_exceeded`, which registration rejects.
- `Activity`, `RosterEntry` and `AthleteReport` gain the optional `source_attributions`: the credit lines the data's sources require, for example `"Garmin Edge 1040"` on a workout recorded on a Garmin device. Show each line verbatim wherever you show that data or anything built from it. The API sends it only when a source requires credit.
- `AlertRulesDoc` gains `hourly_cap` (`HourlyCap`: `enabled`, `per_hour` 1 to 12), the limit on the emails, and separately the pushes, one athlete's alerts send the coach in any 60 minutes. With no scope setting it, the cap is on at 1 per hour; a `setNotificationRules` call that leaves it out clears it at that scope.
- `CoachConnectCharge` gains the optional `stripe_fee_paid_by` (`coach` or `saturday`) and `platform_fee_returned_cents` the transactions endpoint returns. `CoachChargeBreakdown` gains `stripe_fee_paid_by`, `refunded_cents`, `platform_fee_returned_cents`, `disputes_cents` and `dispute_costs_recovered_cents`, and `CoachEarningsSummary` their `total_` sums, which the earnings endpoint returns. `CoachConnectSummary` gains the fee terms the summary endpoint returns: `platform_fee_minimum_cents`, `coach_pays_stripe_fees_from` and Stripe's rates (`stripe_fee_domestic_bps`, `stripe_fee_international_bps`, `stripe_fee_fixed_cents`).
- `CoachSeatState` gains `pending_coach_paid_count`: coach-paid athletes whose seat starts billing when the time they paid for on their own Monthly plan runs out. They are not in `coach_paid_count` until then.
- `RosterEntry`, `FuelingRollup` and `AthleteReport` gain the optional `withheld` (`CoachWithheldNotice`: `kind`, `message`) the Coach API sends about an athlete who connected an app whose data stays on Saturday. `RosterEntry.top_reasons` is `[]` for an athlete who is not flagged; the API sent `null` there before.
- `MissingField.band_impact` is optional. A request made with an athlete's OAuth access token (`bearerToken`) gets `precision.missing_fields` without `band_impact`, in a fixed order. With a partner API key every entry still carries `band_impact`, sorted most-impactful-first. TypeScript code that reads `band_impact` needs a check or `?.`.

## 0.7.0

- Add the read-only coach billing reads: `coach.seatState`, `coach.ledger`, `coach.tierStatus`, `coach.connectSummary`, `coach.connectEarnings`, `coach.connectTransactions` and `coach.connectArrangements`, with typed responses (`CoachSeatState`, `CoachLedgerPage`, `CoachTierStatus`, `CoachConnectSummary`, `CoachConnectEarnings`, `CoachConnectChargesPage`, `CoachConnectArrangements`). They need a coach API key carrying the new `billing:read` scope; amounts are integer cents and timestamps Unix milliseconds, as the portal shows them.

## 0.6.1

- An AI stream deadline defaults to 60 s, matching the API's request cap, when the client has no `timeout` configured. An explicit client `timeout` or per-call `timeout` still applies.
- AI stream events carry `id` only when that event's block included an SSE `id:` line, instead of repeating the last id seen.

## 0.6.0

- Add `ai.createConversationStream` and `ai.sendMessageStream` async generators for the existing SSE API. Preserve warning, error and unknown events, enforce total deadlines, and support AbortSignal/early-exit cleanup. AI writes are single-attempt regardless of `maxRetries`.
- Compatibility: legacy `ai.createConversation` and `ai.sendMessage` now fail locally with `streaming_required` and send zero requests. Use the stream methods instead; the server does not return their previously promised JSON metadata/message objects. JSON read methods remain unchanged.

- Correct activity calculation and stored-prescription return types, nullable safety warnings, numeric timestamps, trial metadata, and full-tier range fields. Responses stay raw JSON objects.
- Correct batch calculation results and athlete batch `created` arrays with separate indexed errors. Code using the former TypeScript declarations may need field-access changes.
- Add `activities.importActivities`, with calculation opt-in, and type feedback responses as the returned feedback object.
- Align request version headers with the existing package version.
- Accept the backend-supported `intersex` value in the `Sex` type.
- Correct athlete/activity list types to nested `pagination` with `next_cursor`. Request query defaults and raw responses are unchanged.
- Correct athlete settings to flat concern flags, remove invented settings fields, and document full-replacement semantics. Add supported settings/plan/org fields to athlete creation and deprecate ignored list filters.
- `coach.reportPdf` returns the PDF bytes. Previously the response was parsed as JSON and failed.
- The request timeout (30 s by default) now covers reading the response body, not only the connection. A request whose body stalls past the timeout fails with a timeout error where it previously hung. Do not blind-retry a timeout on a create call: the server may have completed the write, and the API has no idempotency keys.
- Rate-limit errors expose the server's `Retry-After` value; the daily ceiling sends none, in which case the value reported is a fallback, not the true wait.

## 0.5.0

Initial public release.
