# Contributing

## Bug reports

File an issue on this repository with:
- SDK version
- Node.js and TypeScript versions
- Minimal reproduction steps
- Expected and actual behavior

## Development

Install dependencies, build the TypeScript sources, and run the tests:

```bash
npm ci
npm run build
npm test -- --runInBand
```

Update `src/` against the current [API documentation](https://docs.saturday.fit/introduction) and add coverage in `test/` for behavior changes. `npm test` uses mocked responses and recorded API responses and needs no API key. The live suite runs every method against a real API with a test key: see [test/LIVE.md](test/LIVE.md). After a change to the API, run it with `SATURDAY_LIVE_CAPTURE=test/fixtures/live.json` and commit the new recording with the type changes.

## Code of conduct

Be kind and constructive.
