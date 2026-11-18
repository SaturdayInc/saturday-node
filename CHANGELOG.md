# Changelog

## 0.8.0

- **Breaking:** `saturday.products`, `saturday.ai` and `saturday.gear` are removed, with their types (`Product`, `ProductSummary`, `ProductTier`, `ProductCategory`, `ProductLookupResponse`, `ProductSearchResponse`, `CuratedProductsResponse`, `AIConversation`, `AIStreamError`, `AIStreamEvent`, `AIStreamOptions`). No partner key could use them: every call answered `404` (`NotFoundError`).
- Retries follow what the API says. A `429` is retried after its `Retry-After` when that is 30 s or less. A `429` with no `Retry-After` (the daily call limit and the daily budgets) or a longer one (the block after a calculation sweep, up to 15 minutes) now throws `RateLimitError` at once; before, each was retried three times in seven seconds. A `5xx` on a `POST` that creates or changes a record is no longer retried, since the server may have done the write; `POST /v1/nutrition/calculate`, its batch and `/v1/infer/*` still are, with every `GET`, `PUT`, `PATCH` and `DELETE`.
- `import Saturday from '@saturdayinc/sdk'` now gives the client class in a plain Node ES module (an `.mjs` file, or a project with `"type": "module"`). Before, Node handed back the module object there and `new Saturday(...)` threw `Saturday is not a constructor`; TypeScript, bundlers and `require` were unaffected, and `import { Saturday }` worked everywhere. The package gains an `exports` map with an ES module entry, so imports of files inside the package (`@saturdayinc/sdk/dist/...`) no longer resolve.
- **Breaking for TypeScript, a fix at run time:** `webhooks.create()` returns the API's response, `WebhookCreateResponse`: the webhook under `webhook`, with `secret`, beside `message` and `request_id`. It was typed as the webhook itself, so `created.secret` read `undefined` and the signing secret, shown only at creation, was easy to lose. Read `created.webhook.secret`.
- `Webhook` timestamps (`created_at`, `updated_at`, `disabled_at`) are numbers, Unix milliseconds; they were typed as strings. `Webhook` gains `partner_id`. `description` is marked deprecated: the API never stores it, and `webhooks.create()`'s `description` argument is ignored.
- Add `webhooks.listDeliveries(webhookId)` for `GET /v1/webhooks/{id}/deliveries`, the 50 most recent delivery attempts (`WebhookDeliveryList`). `webhooks.test()` returns `WebhookTestResponse` (`delivery`, a `WebhookDelivery` with your endpoint's `status_code`), and `webhooks.list()` returns `WebhookListResponse` with `total`.
- `athletes.list()` takes `externalId`: the athletes you created with that `external_id`, newest first, in one page.
- `ActivityPrescription`'s six numbers (`total_carb_g`, `total_sodium_mg`, `total_fluid_ml`, `carb_g_per_hr`, `sodium_mg_per_hr`, `fluid_ml_per_hr`) are optional. A banded prescription carries the three ranges, and the API leaves the numbers out of it rather than sending zeros. Read the range first, then the number.
- `Organization.created_at` is a number, epoch seconds, as the API sends it; it was typed as a string. `Organization` gains `updated_at`.
- `AlertRulesDoc` gains `channel_config` (`ChannelConfig`: the email address and push devices alerts go to). A read always carries it, and `coach.setNotificationRules()` replaces it with the rest of the set: send back the one you read. Left out at the overall scope, the coach's email and push alerts turn off.
- `OnboardingQuestionsResponse` gains `request_id`.
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
