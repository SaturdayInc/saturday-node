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

Update `src/` against the current [API documentation](https://docs.saturday.fit/introduction). Add regression coverage in `test/` for behavior changes. Tests use mocked responses and need no API key.

## Code of conduct

Be kind and constructive.
