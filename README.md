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

// Safety metadata is included on every tier.
console.log(prescription.safety.warnings);
const carbs = prescription.carb_range_g_per_hr ?? prescription.carb_g_per_hr ?? 0;
const sodium = prescription.sodium_range_mg_per_hr ?? prescription.sodium_mg_per_hr ?? 0;
const fluid = prescription.fluid_range_ml_per_hr ?? prescription.fluid_ml_per_hr ?? 0;
console.log(`Carbs: ${carbs} g/hr`);
console.log(`Sodium: ${sodium} mg/hr`);
console.log(`Fluid: ${fluid} mL/hr`);
```

Teaser responses and incomplete profiles return ranges. A `full` tier alone does not guarantee exact numbers. Exact zero values may be omitted from the response, so the example displays them as `0`. See [Athlete Onboarding](https://docs.saturday.fit/guides/onboarding).

## Features

- TypeScript resource types, with [known activity-prescription alignment gaps](https://github.com/SaturdayInc/saturday-node/issues/6)
- Automatic retry with exponential backoff for JSON operations; AI stream writes are never replayed
- Typed errors (AuthenticationError, RateLimitError, ValidationError, NotFoundError)
- API key and OAuth2 Bearer token authentication
- Safety types prominently surfaced (`SafetyMetadata`, `not_instructions`)

## Authentication

```typescript
// API key (server-to-server)
const serverClient = new Saturday({ apiKey: 'sk_live_...' });

// OAuth2 Bearer token (athlete-delegated access)
const delegatedClient = new Saturday({
  apiKey: 'sk_live_...',
  bearerToken: 'eyJ...',
});
```

## Resources

| Resource | Description |
|----------|-------------|
| `saturday.nutrition` | Calculate prescriptions, batch calculate |
| `saturday.athletes` | Athlete CRUD, settings, batch create, GDPR export |
| `saturday.activities` | Activity CRUD, prescription calculation, feedback |
| `saturday.products` | Product search, barcode lookup, curated list |
| `saturday.ai` | AI event streams plus JSON conversation metadata and history |
| `saturday.webhooks` | Webhook registration and management |
| `saturday.organizations` | Team/org management and member directories |
| `saturday.gear` | Athlete gear inventory |
| `saturday.knowledge` | Sports nutrition knowledge base search |

## AI writes

Use `ai.createConversationStream(athleteId, message)` and `ai.sendMessageStream(conversationId, message)`. They return async generators of `{ event, data, rawData, id? }`, preserving unknown event names and JSON fields. The metadata/history read methods still return JSON.

Compatibility change: the legacy `ai.createConversation()` and `ai.sendMessage()` signatures are retained but now reject locally with `AIStreamError` code `streaming_required`, before any HTTP request. They cannot return their old metadata/message promises from the actual SSE wire response. Migrate to the explicit stream methods; no timestamps or metadata are invented.

```typescript
import Saturday, { AIStreamError } from '@saturdayinc/sdk';

const client = new Saturday({ apiKey: 'sk_live_...' });
const controller = new AbortController();
try {
  for await (const event of client.ai.createConversationStream(
    'YOUR_ATHLETE_ID', 'Help me review my fueling plan',
    { signal: controller.signal, timeout: 30000 },
  )) {
    // Keep safety_warning, error, tool/action and unknown events, not only text.
    console.log(event.event, event.data);
  }
} catch (error) {
  if (error instanceof AIStreamError) console.error(error.error.code, error.event);
  throw error; // No automatic retry: the server may already have accepted the write.
}
```

The `message_start` event supplies `data.conversation_id`. Current names include `text_delta`, `safety_warning`, `error`, `tool_call`, `tool_result`, `action`, `replay` and `message_end`. `data` is `unknown`: narrow it before accessing fields. `rawData` retains the original SSE data text. `message_end` is not a success verdict: server error events are yielded, then iteration raises `stream_error` after the response finishes. Warnings, including generation-halted safety warnings, must remain visible even if no exception is raised.

Each stream POST is attempted exactly once, including HTTP 429/5xx, connection errors, parse failures, cancellation and premature EOF. `maxRetries` does not apply. Malformed JSON/UTF-8 raises `malformed_stream`; missing final framing or `message_end` raises `incomplete_stream`. Preserve already received events as partial output, not a complete answer. These writes have no idempotency key; inspect conversation state before deciding whether to submit another message.

Redirects are refused with `AIStreamError` code `redirect`, so the SDK never forwards the POST to another URL. Connection failures use `connection_error`; HTTP failures retain the usual typed Saturday errors and parsed server details.

Persist the received events if you need an exact record. Stored conversation history is not a guaranteed replay of streamed assistant output.

The timeout is a total deadline in milliseconds, covering headers and the entire body; it defaults to the client's timeout. An `AbortSignal` cancels a pending read. Breaking a `for await` loop closes the response and releases its reader. Always finish or close an iterator; abandoning it without either leaves cleanup to the deadline. Cancellation cannot undo inference already accepted by the server. No reconnect is triggered by an SSE `retry` or `replay` field/event.

## Documentation

Full API documentation: [docs.saturday.fit](https://docs.saturday.fit)

## Requirements

- Node.js 18+ (uses native `fetch`)
- TypeScript 5.0+ (for type inference)

## License

MIT
