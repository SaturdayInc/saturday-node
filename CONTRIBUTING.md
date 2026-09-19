# Contributing

Thank you for your interest in contributing to the Saturday SDK.

## Bug Reports

Please file an issue on this repository with:
- SDK version
- Language/runtime version
- Minimal reproduction steps
- Expected vs actual behavior

## Development

Install dependencies, build the TypeScript sources, and run the isolated HTTP tests:

```bash
npm ci
npm run build
npm test -- --runInBand
```

Update `src/` against the current [API documentation](https://docs.saturday.fit/introduction). Add regression coverage in `test/` for behavior changes. Tests use mocked responses and do not require an API key.

## Code of Conduct

Be kind. Be constructive. We're building tools that help athletes stay safe.
