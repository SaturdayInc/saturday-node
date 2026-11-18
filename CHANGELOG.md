# Changelog

## 0.8.0 (unreleased)

Breaking changes:

- `products`, `gear` and `ai` are removed, with their types and `AIStreamError`. Those routes are not open to partner keys.
- `webhooks.create(url, events)` returns `CreateWebhookResponse`: the webhook, with its signing secret, is under `webhook`. The `description` argument is gone; the API does not take one.
- `organizations.create` takes an object (`{ display_name, description?, sport? }`) and `organizations.addMember` takes `{ email, role?, athlete_id? }`.
- `knowledge.search` takes `{ query, limit?, category? }`.
- Timestamps are numbers: `Webhook`, `Organization` and the new types say which are Unix seconds and which milliseconds.
- `athletes.list` drops the `search` option and `activities.list` the `type` option, which the API ignored. `athletes.list` gains `external_id` and `profile_complete` filters.
- A 429 without `Retry-After` is a daily ceiling: it is no longer retried, and `RateLimitError.dailyLimit` is true. `retryAfter` is `undefined` there. A `Retry-After` over 60 seconds is returned to you, not waited out. 5xx retries wait 1 s, 2 s and 4 s as before.
- 403 responses raise the new `PermissionError`.

Added:

- `nutrition.productFit`, `nutrition.compareProducts` and `activities.prep`, with `PlanBasis` for plans made from the middle of an incomplete profile's ranges.
- `nutrition.extract` (nutrition label reading), `infer.activityType`, `infer.brickTypes`, `reference.activityTypes`, `reference.settingsSchema`.
- `athletes.erase` (`POST /v1/athletes/{id}/delete`), `athletes.listConsent`, `recordConsent`, `revokeConsent`.
- `partner.get`, `usage`, `usageDaily`, `listApiKeys`, `createApiKey`, `revokeApiKey`, `rotateApiKey`.
- `webhooks.deliveries`; `organizations.update`, offers and seat subscriptions with licenses; `integrations.sync`, `status`, `disconnect`; `testing.simulateSubscription`; `meta.discovery`, `errors`, `health`.
- `SaturdayError.code`.
- Request types document `meal_before_min` (over 180 is a fasted start), `is_race`, even effort levels and whole-number per-hour figures.
- A live suite (`test/live.test.ts`) and a type check of its recorded responses.

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
