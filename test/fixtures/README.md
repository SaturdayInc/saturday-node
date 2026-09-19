# Contract fixtures

`contracts.json` is generated from fuel-backend's Go JSON types and its real stored-prescription handler, using synthetic data and an in-memory service. It makes no API, Firestore, inference, auth, or trial calls. The backend commit is recorded in `_meta`.

Regenerate from a checked-out backend module, with Go 1.26+:

```bash
cd /path/to/fuel-backend
go run /path/to/saturday-node/test/fixtures/generate.go \
  -backend-sha "$(git rev-parse HEAD)" \
  -out /path/to/saturday-node/test/fixtures/contracts.json
```

Review generated differences before accepting them. `test/contracts.test.ts` checks these payloads against public TypeScript declarations and exercises resource methods with mocked HTTP. This is local source-contract evidence, not a live deployed-API smoke test.
