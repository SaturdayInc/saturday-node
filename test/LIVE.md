# Live suite

`test/live.test.ts` calls every partner method against a running Saturday API and checks what comes back. `npm test` skips it unless both variables below are set.

```bash
SATURDAY_LIVE_BASE_URL=https://... \
SATURDAY_LIVE_API_KEY=sk_test_... \
npx jest --runInBand test/live.test.ts
```

- The key must be a test key (`sk_test_`); the suite refuses a live key.
- One run makes about 135 calls, of which about 50 are calculations, prep, product fit and compare, and creates 5 athletes (one of them with a simulated subscription, for the brick and triathlon block), 4 activities, an organization, an API key and a webhook pointed at `https://example.com`. The webhook receives two deliveries, a `webhook.test` and a `prescription.calculated`; example.com answers 405, and the suite reads each event body from its delivery record. It erases the athletes, with their activities, and deletes the key and webhook it created; the organization stays.
- The catalog products it sizes are Maurten Gel 100 and Tailwind Endurance Fuel.
- `athletes.erase` and `testing.simulateSubscription` need the test environment. The run marks 2 athletes with `testing.simulateSubscription`, inside the 10 a key may mark per UTC day.
- It also checks what the API refuses: a second athlete with a taken `external_id` (create, batch item and update), a Strava or TrainingPeaks token on `integrations.sync`, prep with both `products` and `legs`, and the stored prescription after an update that changes the session.

Set `SATURDAY_LIVE_CAPTURE=test/fixtures/live.json` to record every response. Keys, secrets, signed links and account details are replaced with placeholders before they are written. `test/live-types.test.ts`, part of `npm test`, type-checks every recorded response against the SDK type its method returns, so a field the API adds, drops or renames fails the suite until the types match.
