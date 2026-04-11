# Saturday TypeScript SDK

[![npm](https://img.shields.io/npm/v/@saturdayinc/sdk)](https://www.npmjs.com/package/@saturdayinc/sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Official TypeScript/Node.js SDK for the [Saturday Nutrition Intelligence API](https://docs.saturday.fit).

Personalized fuel, hydration, and electrolyte prescriptions for endurance athletes.

## Install

```bash
npm install @saturdayinc/sdk
```

## Quick Start

```typescript
import Saturday from '@saturdayinc/sdk';

const saturday = new Saturday({ apiKey: 'sk_live_...' });

// Calculate a nutrition prescription
const prescription = await saturday.nutrition.calculate({
  activity_type: 'bike',
  duration_min: 180,
  athlete_weight_kg: 75,
  thermal_stress_level: 7,
  is_race: true,
});

// Safety metadata is ALWAYS included — athlete safety is never paywalled
console.log(prescription.safety.warnings);
console.log(`Carbs: ${prescription.carb_g_per_hr} g/hr`);
console.log(`Sodium: ${prescription.sodium_mg_per_hr} mg/hr`);
console.log(`Fluid: ${prescription.fluid_ml_per_hr} mL/hr`);
```

## Features

- Full TypeScript types for all API resources
- Automatic retry with exponential backoff (429s and 5xx)
- Typed errors (AuthenticationError, RateLimitError, ValidationError, NotFoundError)
- API key and OAuth2 Bearer token authentication
- Safety types prominently surfaced (`SafetyMetadata`, `not_instructions`)

## Authentication

```typescript
// API key (server-to-server)
const saturday = new Saturday({ apiKey: 'sk_live_...' });

// OAuth2 Bearer token (athlete-delegated access)
const saturday = new Saturday({
  apiKey: 'sk_live_...',
  bearerToken: 'eyJ...',
});
```

## Resources

| Resource | Description |
|----------|-------------|
| `saturday.nutrition` | Calculate prescriptions, batch, compare |
| `saturday.athletes` | Athlete CRUD, settings, batch create, GDPR export |
| `saturday.activities` | Activity CRUD, prescription calculation, feedback |
| `saturday.products` | Product search, barcode lookup, curated list |
| `saturday.ai` | AI coaching conversations (SSE streaming) |
| `saturday.webhooks` | Webhook registration and management |
| `saturday.organizations` | Team/org management with licenses |
| `saturday.gear` | Athlete gear inventory |
| `saturday.knowledge` | Sports nutrition knowledge base search |

## Documentation

Full API documentation: [docs.saturday.fit](https://docs.saturday.fit)

## Requirements

- Node.js 18+ (uses native `fetch`)
- TypeScript 5.0+ (for type inference)

## License

MIT
