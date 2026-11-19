# Contract fixtures

`contracts.json` holds sample API responses that fuel-backend builds (`pkg/sdkcontracts`) from its Go response types and its real stored-prescription, list and settings handlers, with synthetic data and in-memory services. It makes no API, Firestore, inference, auth, or trial calls. `_meta.backend_sha` is the backend commit that last changed the samples.

The backend fails a test when its copy of the samples no longer matches what its types and handlers produce. Once the regenerated samples are on the backend's main, `scripts/sdk-contracts-sync.sh --pr` in fuel-backend opens a pull request here carrying them, and the test run on that pull request shows whether the SDK types still match. Fix the types on that branch when it fails.

`test/contracts.test.ts` checks these payloads against public TypeScript declarations and exercises resource methods with mocked HTTP. This is local source-contract evidence, not a live deployed-API smoke test.
