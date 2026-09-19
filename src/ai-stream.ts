import { SaturdayError } from './errors';
import type { ReadableStreamDefaultReader } from 'node:stream/web';
import { performance } from 'node:perf_hooks';

/** A wire event, including future event names and unmodified JSON fields. */
export interface AIStreamEvent {
  event: string;
  data: unknown;
  rawData: string;
  /** Present only when this event's block carried an SSE `id:` line; not a reconnect buffer. The server sends none today. */
  id?: string;
}

export interface AIStreamOptions {
  signal?: AbortSignal;
  /** Total request deadline in milliseconds, including the entire response body. Defaults to the client `timeout` when configured, else 60000. */
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
        // An id line belongs to the event dispatched by its own block, never to later events.
        const { name, data, id } = this;
        this.name = '';
        this.data = [];
        this.id = undefined;
        if (data.length) {
          const rawData = data.join('\n');
          const event: AIStreamEvent = { event: name || 'message', data: undefined, rawData };
          if (id !== undefined) event.id = id;
          try { event.data = JSON.parse(rawData); } catch {
            throw new AIStreamError('malformed_stream', 'AI event contains invalid JSON. The request was not replayed.', event);
          }
          yield event;
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

function* lineBytes(bytes: Uint8Array): Generator<Uint8Array> {
  let start = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 10 || bytes[i] === 13) {
      yield bytes.subarray(start, i + 1);
      start = i + 1;
    }
  }
  if (start < bytes.length) yield bytes.subarray(start);
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
  const deadline = performance.now() + timeout;
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
    if (performance.now() >= deadline) { timedOut = true; abort(); }
    if (controller.signal.aborted) throw new AIStreamError('cancelled', 'AI stream stopped.');
  };
  const transport = async <T>(operation: () => Promise<T>): Promise<T> => {
    try { return await operation(); } catch {
      throw new AIStreamError('connection_error', 'AI stream connection failed. The request may have been accepted; it was not replayed.');
    }
  };
  let callerThrew = false;
  try {
    checkAbort();
    response = await transport(() => fetch(url, { method: 'POST', redirect: 'manual', headers: { ...headers, Accept: 'text/event-stream' }, body: JSON.stringify(body), signal: controller.signal }));
    checkAbort();
    if (response.status >= 300 && response.status < 400) {
      throw new AIStreamError('redirect', 'AI request was redirected. It was not forwarded or replayed.');
    }
    if (!response.ok) {
      let detail: any;
      const errorBody = await transport(() => response!.text());
      checkAbort();
      try { detail = JSON.parse(errorBody); } catch {
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
      const { value, done } = await transport(() => reader!.read());
      // Decode line by line so later corrupt bytes cannot erase prior complete events.
      for (const bytes of done ? [undefined] : lineBytes(value)) {
        let text: string;
        try { text = decoder.decode(bytes, { stream: !done }); } catch {
          throw new AIStreamError('malformed_stream', 'AI stream contains invalid or incomplete UTF-8. The request was not replayed.');
        }
        for (const event of parser.push(text)) {
          checkAbort();
          if (event.event === 'message_start' || event.event === 'message_end') {
            const id = (event.data as { conversation_id?: unknown } | null)?.conversation_id;
            if (typeof id !== 'string' || !id ||
                (event.event === 'message_start' && conversationId !== undefined) ||
                (event.event === 'message_end' && (ended || id !== conversationId))) {
              throw new AIStreamError('malformed_stream', 'AI stream has an invalid conversation boundary. The request was not replayed.', event);
            }
            if (event.event === 'message_start') conversationId = id;
          }
          if (event.event === 'error') serverError = event;
          if (event.event === 'message_end') ended = true;
          try { yield event; } catch (error) { callerThrew = true; throw error; }
        }
      }
      if (done) break;
    }
    checkAbort();
    if (serverError) throw new AIStreamError('stream_error', 'The AI server reported an error. Inspect the preserved event; the request was not replayed.', serverError);
    parser.finish();
    if (!ended) throw new AIStreamError('incomplete_stream', 'AI stream ended without message_end. The request was not replayed.');
  } catch (error) {
    if (callerThrew) throw error;
    if (timedOut) throw new AIStreamError('timeout', `AI stream exceeded its ${timeout}ms deadline. The request may have been accepted; it was not replayed.`);
    if (options.signal?.aborted) throw new AIStreamError('cancelled', 'AI stream was cancelled. The request may have been accepted; it was not replayed.');
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
    controller.abort();
    await closeBody();
  }
}
