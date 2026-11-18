# Live suite

`test/live.test.ts` calls every partner method against a running Saturday API and checks what comes back. `npm test` skips it unless both variables below are set.

```bash
SATURDAY_LIVE_BASE_URL=https://... \
SATURDAY_LIVE_API_KEY=sk_test_... \
npx jest --runInBand test/live.test.ts
```

- The key must be a test key (`sk_test_`); the suite refuses a live key.
- One run makes about 70 calls, of which about 20 are calculations, and creates 4 athletes, 2 activities, an organization, an API key and a webhook pointed at `https://example.com`. It erases the athletes and deletes the activity, key and webhook it created; the organization stays.
- The catalog products it sizes are Maurten Gel 100 and Tailwind Endurance Fuel.
- `athletes.erase` and `testing.simulateSubscription` need the test environment.

Set `SATURDAY_LIVE_CAPTURE=test/fixtures/live.json` to record every response. Keys, secrets, signed links and account details are replaced with placeholders before they are written. `test/live-types.test.ts`, part of `npm test`, type-checks every recorded response against the SDK type its method returns, so a field the API adds, drops or renames fails the suite until the types match.
