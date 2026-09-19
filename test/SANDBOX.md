# Optional deployed-sandbox contract test

The normal suite skips the live test. Local gating tests and full/teaser rehearsals use fake keys and mocked HTTP only.

An authorized operator can run the live test after securely providing all three process environment variables:

- `SATURDAY_SANDBOX_ALLOW_MUTATIONS=1`
- `SATURDAY_SANDBOX_BASE_URL=https://partner-api-5vozuebg2a-uc.a.run.app`
- `SATURDAY_SANDBOX_API_KEY`, an independently verified fuel-app-test partner key beginning with `sk_test_`

No URL fallback, production key or trailing-slash variant is accepted. Do not put the key in shell history, source, logs or test reports. Confirm the test partner has no active webhooks before running. Each fresh run creates two synthetic athletes and four activities, with UUID markers and no email/account-matching input. A failed run can leave fewer records or an uncertain timed-out create. Never blindly replay it.

```bash
npm test -- --runInBand test/sandbox.test.ts -t 'checks live sandbox contracts'
```

The harness makes 13 calls for a natural teaser response, or 14 when a stored full-tier prescription is available. It enforces a 20-call maximum, stops starting requests after five minutes, disables SDK retries and rejects redirects. It never reads the partner-wide athlete roster, accesses existing athlete IDs, calls AI/inference/Stripe, changes entitlement/flags or forces a subscription tier.

Coverage: flat settings GET/replacement, activity calculation and stored wrapper when naturally available, flat nutrition, default/global/per-item import calculation flags, partial nutrition/athlete batches, scoped activity pagination and feedback. The ledger records the actual returned tiers/bands, not a claim that every live variant was exercised.

`SATURDAY_SANDBOX_LEDGER` output records the run marker, created IDs, stages and result variants. It excludes the key, headers and response/error bodies. Capture this output in restricted task storage. Fixtures are intentionally retained: the API's athlete DELETE is non-cascading, so this test does not perform misleading or broad cleanup. Any later cleanup must use the recorded IDs, first confirm their exact run markers, and account for children and related test metadata. Unknown create outcomes require investigation, not a retry.
