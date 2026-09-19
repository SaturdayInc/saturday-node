# Changelog

## Unreleased

- Add `ai.createConversationStream` and `ai.sendMessageStream` async generators for the existing SSE API. Preserve warning, error and unknown events, enforce total deadlines, and support AbortSignal/early-exit cleanup. AI writes are single-attempt regardless of `maxRetries`.
- Compatibility: legacy `ai.createConversation` and `ai.sendMessage` now fail locally with `streaming_required` and send zero requests. Use the stream methods instead; the server does not return their previously promised JSON metadata/message objects. JSON read methods remain unchanged. Source change only, not a package publication.

## 0.6.0

- `reports.pdf` returns the PDF bytes. Previously the response was parsed as JSON and failed.
- The request timeout (30 s by default) now covers reading the response body, not only the connection. A request whose body stalls past the timeout fails with a timeout error where it previously hung. Do not blind-retry a timeout on a create call: the server may have completed the write, and the API has no idempotency keys.
- Rate-limit errors expose the server's `Retry-After` value; the daily ceiling sends none, in which case the value reported is a fallback, not the true wait.

## 0.5.0

Initial public release.
