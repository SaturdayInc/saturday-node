import { SaturdayError } from './errors';
import type { ReadableStreamDefaultReader } from 'node:stream/web';

/** A wire event, including future event names and unmodified JSON fields. */
export interface AIStreamEvent {
  event: string;
  data: unknown;
  rawData: string;
  id?: string;
}

export interface AIStreamOptions {
  signal?: AbortSignal;
  /** Total request deadline in milliseconds, including the entire response body. */
  timeout?: number;
}

export class AIStreamError extends SaturdayError {
  constructor(code: string, message: string, readonly event?: AIStreamEvent) {
    super(0, { type: 'api_error', code, message });
    this.name = 'AIStreamError';
  }
}

class EventParser {
  private line = '';
  private skipLF = false;
  private name = '';
  private data: string[] = [];
  private id: string | undefined;

  *push(text: string): Generator<AIStreamEvent> {
    for (const char of text) {
      if (this.skipLF) {
        this.skipLF = false;
        if (char === '\n') continue;
      }
      if (char !== '\r' && char !== '\n') {
        this.line += char;
        continue;
      }
      this.skipLF = char === '\r';
      const line = this.line;
      this.line = '';
      if (line === '') {
        if (this.data.length) {
          const rawData = this.data.join('\n');
          const event: AIStreamEvent = { event: this.name || 'message', data: undefined, rawData };
          if (this.id !== undefined) event.id = this.id;
          try { event.data = JSON.parse(rawData); } catch {
            throw new AIStreamError('malformed_stream', 'AI event contains invalid JSON. The request was not replayed.', event);
          }
          this.name = '';
          this.data = [];
          yield event;
        } else {
          this.name = '';
        }
        continue;
      }
      if (line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      let value = colon < 0 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') this.name = value;
      if (field === 'data') this.data.push(value);
      if (field === 'id' && !value.includes('\0')) this.id = value;
      // SSE retry fields do not authorize another inference request.
    }
  }

  finish(): void {
    if (this.data.length || this.name || (this.line && !this.line.startsWith(':'))) {
      throw new AIStreamError('incomplete_stream', 'AI stream ended inside an event. The request was not replayed.');
    }
  }
}

/** @internal Single-attempt POST transport, separate from JSON request retries. */
export async function* streamAI(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  defaultTimeout: number,
  options: AIStreamOptions,
  mapError: (status: number, detail: unknown, headers: Headers) => SaturdayError,
): AsyncGenerator<AIStreamEvent> {
  const timeout = options.timeout ?? defaultTimeout;
  if (!Number.isFinite(timeout) || timeout <= 0) throw new RangeError('AI stream timeout must be a positive finite number.');
  const controller = new AbortController();
  let response: Response | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let closing: Promise<void> | undefined;
  const closeBody = (): Promise<void> | undefined => {
    if (closing) return closing;
    if (reader) {
      const activeReader = reader;
      closing = (async () => {
        try { await activeReader.cancel(); } catch { /* Preserve the original stream error. */ }
        activeReader.releaseLock();
      })();
    } else if (response?.body) {
      closing = response.body.cancel().catch(() => undefined);
    }
    return closing;
  };
  const abort = () => {
    controller.abort();
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
    void closeBody();
  };
  if (options.signal?.aborted) throw new AIStreamError('cancelled', 'AI stream was cancelled before sending.');
  options.signal?.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; abort(); }, timeout);
  const checkAbort = () => {
    if (controller.signal.aborted) throw new AIStreamError('cancelled', 'AI stream stopped.');
  };
  try {
    response = await fetch(url, { method: 'POST', redirect: 'manual', headers: { ...headers, Accept: 'text/event-stream' }, body: JSON.stringify(body), signal: controller.signal });
    if (response.status >= 300 && response.status < 400) {
      throw new AIStreamError('redirect', 'AI request was redirected. It was not forwarded or replayed.');
    }
    if (!response.ok) {
      let detail: any;
      try { detail = await response.json(); } catch (error) {
        if (controller.signal.aborted) throw error;
        detail = { code: 'unknown', message: 'AI request failed with a non-JSON error response.' };
      }
      detail = detail?.error ?? detail;
      if (!detail || typeof detail !== 'object' || typeof detail.message !== 'string') {
        detail = { code: 'unknown', message: 'AI request failed without a structured error message.' };
      }
      throw mapError(response.status, detail, response.headers);
    }
    if (response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'text/event-stream' || !response.body) {
      throw new AIStreamError('invalid_stream_response', 'Expected an AI text/event-stream response. The request was not replayed.');
    }
    reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const parser = new EventParser();
    let ended = false;
    let conversationId: string | undefined;
    let serverError: AIStreamEvent | undefined;
    for (;;) {
      checkAbort();
      const { value, done } = await reader.read();
      let text: string;
      try { text = done ? decoder.decode() : decoder.decode(value, { stream: true }); } catch {
        throw new AIStreamError('malformed_stream', 'AI stream contains invalid or incomplete UTF-8. The request was not replayed.');
      }
      for (const event of parser.push(text)) {
        checkAbort();
        if (event.event === 'message_start' || event.event === 'message_end') {
          const id = (event.data as { conversation_id?: unknown } | null)?.conversation_id;
          if (typeof id !== 'string' || !id || (event.event === 'message_end' && id !== conversationId)) {
            throw new AIStreamError('malformed_stream', 'AI stream has an invalid conversation boundary. The request was not replayed.', event);
          }
          if (event.event === 'message_start') conversationId = id;
        }
        if (event.event === 'error') serverError = event;
        if (event.event === 'message_end') ended = true;
        yield event;
      }
      if (done) break;
    }
    checkAbort();
    if (serverError) throw new AIStreamError('stream_error', 'The AI server reported an error. Inspect the preserved event; the request was not replayed.', serverError);
    parser.finish();
    if (!ended) throw new AIStreamError('incomplete_stream', 'AI stream ended without message_end. The request was not replayed.');
  } catch (error) {
    if (timedOut) throw new AIStreamError('timeout', `AI stream exceeded its ${timeout}ms deadline. The request may have been accepted; it was not replayed.`);
    if (options.signal?.aborted) throw new AIStreamError('cancelled', 'AI stream was cancelled. The request may have been accepted; it was not replayed.');
    if (error instanceof SaturdayError) throw error;
    throw new AIStreamError('connection_error', 'AI stream connection failed. The request may have been accepted; it was not replayed.');
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
    controller.abort();
    await closeBody();
  }
}
