import { createServer, Server, ServerResponse } from 'node:http';
import { AddressInfo, Socket } from 'node:net';
import { ReadableStream } from 'node:stream/web';
import { Saturday } from '../src/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import * as sdk from '../src';

const originalFetch = global.fetch;
const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const start = frame('message_start', { conversation_id: 'conv-1' });
const end = frame('message_end', { conversation_id: 'conv-1' });
const client = (config: object = {}) => new Saturday({ apiKey: 'test-key', maxRetries: 3, ...config });
async function collect(stream: AsyncIterable<unknown>) {
  const events = [];
  for await (const event of stream) events.push(event);
  return events;
}
function mockStream(bytes: Uint8Array, split = bytes.length) {
  const cancel = jest.fn();
  const body = new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += split) controller.enqueue(bytes.slice(i, i + split));
      controller.close();
    }, cancel,
  });
  global.fetch = jest.fn().mockResolvedValue(new Response(body as any, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } }));
  return body;
}
afterEach(() => { global.fetch = originalFetch; jest.useRealTimers(); });

test.each(['createConversation', 'sendMessage'])('legacy %s rejects before sending a request', async method => {
  mockStream(Buffer.from(start + end));
  await expect((client().ai as any)[method]('athlete', 'hello')).rejects.toMatchObject({ error: { code: 'streaming_required' } });
  expect(global.fetch).not.toHaveBeenCalled();
});

test.each([1, 2, 7, 4096])('preserves all events through UTF8 chunk size %s', async split => {
  const kinds = ['text_delta', 'safety_warning', 'tool_call', 'tool_result', 'action', 'replay', 'future_event'];
  mockStream(Buffer.from('\uFEFF: heartbeat\r\n\r\n' + start + kinds.map(event => frame(event, { value: 'é🚲日本語' })).join('') + end), split);
  const events: any[] = await collect((client().ai as any).createConversationStream('athlete', 'hello'));
  expect(events.map(e => e.event)).toEqual(['message_start', ...kinds, 'message_end']);
  expect(events[1].data).toEqual({ value: 'é🚲日本語' });
  expect(events[1].rawData).toBe('{"value":"é🚲日本語"}');
  const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
  expect(url).toBe('https://api.saturday.fit/v1/ai/conversations');
  expect(JSON.parse(init.body)).toEqual({ athlete_id: 'athlete', message: 'hello' });
  expect(init.headers.Accept).toBe('text/event-stream');
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test.each(['\n', '\r', '\r\n'])('handles framing and multiline data with %j', async newline => {
  const sse = ['id: abc', 'retry: 500', 'event: future', 'data: {"one":1,', 'data: "two":2}', '', ''].join(newline);
  mockStream(Buffer.from(start + sse + end), 1);
  const events: any[] = await collect((client().ai as any).sendMessageStream('a/b', 'hello'));
  expect(events[1]).toMatchObject({ event: 'future', data: { one: 1, two: 2 }, id: 'abc', rawData: '{"one":1,\n"two":2}' });
  expect((global.fetch as jest.Mock).mock.calls[0][0]).toContain('/a%2Fb/messages');
});

test.each([
  ['invalid JSON', start + 'event: text_delta\ndata: {bad}\n\n', 'malformed_stream'],
  ['EOF before end', start + frame('text_delta', { delta: 'partial' }), 'incomplete_stream'],
  ['unterminated end', start + end.slice(0, -1), 'incomplete_stream'],
  ['empty response', '', 'incomplete_stream'],
  ['non-JSON number', start + 'event: text_delta\ndata: {"delta":NaN}\n\n', 'malformed_stream'],
  ['end without start', end, 'malformed_stream'],
  ['wrong conversation end', start + frame('message_end', { conversation_id: 'other' }), 'malformed_stream'],
  ['duplicate start', start + start + end, 'malformed_stream'],
  ['duplicate end', start + end + end, 'malformed_stream'],
  ['reopened conversation', start + end + frame('message_start', { conversation_id: 'two' }) + frame('text_delta', { delta: 'partial' }), 'malformed_stream'],
])('rejects %s without replay', async (_name, body, code) => {
  mockStream(Buffer.from(body));
  await expect(collect((client().ai as any).sendMessageStream('conv', 'hello'))).rejects.toMatchObject({ error: { code } });
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('id is per event: present only when that block carried an id line', async () => {
  mockStream(Buffer.from(start + 'id: 7\n' + frame('text_delta', { delta: 'a' }) + frame('text_delta', { delta: 'b' }) + end));
  const events: any[] = await collect(client().ai.sendMessageStream('conv', 'hello'));
  expect(events.map(e => e.id ?? null)).toEqual([null, '7', null, null]);
  expect(events.filter(e => 'id' in e)).toHaveLength(1);
});

test('the stream deadline defaults to 60 s; a client timeout or a per-call timeout still wins', async () => {
  jest.useFakeTimers();
  global.fetch = jest.fn((_url: any, init: any) => new Promise<never>((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')));
  })) as unknown as typeof fetch;
  const expectDeadline = async (stream: AsyncIterable<unknown>, expectedMs: number) => {
    let outcome: unknown = 'pending';
    const done = collect(stream).then(() => { outcome = 'resolved'; }, error => { outcome = error; });
    await jest.advanceTimersByTimeAsync(expectedMs - 1);
    expect(outcome).toBe('pending');
    await jest.advanceTimersByTimeAsync(1);
    await done;
    expect(outcome).toMatchObject({ error: { code: 'timeout', message: expect.stringContaining(`${expectedMs}ms`) } });
  };
  await expectDeadline(client().ai.sendMessageStream('conv', 'hello'), 60_000);
  await expectDeadline(client({ timeout: 5000 }).ai.sendMessageStream('conv', 'hello'), 5000);
  await expectDeadline(client({ timeout: 5000 }).ai.sendMessageStream('conv', 'hello', { timeout: 1234 }), 1234);
  expect(global.fetch).toHaveBeenCalledTimes(3);
});

test('rejects incomplete UTF8 without losing its error', async () => {
  mockStream(Buffer.concat([Buffer.from(start), Buffer.from([0xf0, 0x9f])]));
  await expect(collect((client().ai as any).sendMessageStream('conv', 'hello'))).rejects.toMatchObject({ error: { code: 'malformed_stream' } });
});

test.each([true, false])('exposes error events and never reports success, with message_end=%s', async finish => {
  mockStream(Buffer.from(start + frame('error', { message: 'generation failed', future: 1 }) + frame('safety_warning', { message: 'warning' }) + (finish ? end : '')));
  const seen: any[] = [];
  const read = async () => {
    for await (const event of (client().ai as any).sendMessageStream('conv', 'hello')) seen.push(event);
  };
  await expect(read()).rejects.toMatchObject({ error: { code: 'stream_error' }, event: { data: { message: 'generation failed', future: 1 } } });
  expect(seen.map(e => e.event)).toContain('safety_warning');
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('still preserves warnings, unknown events and errors after message_end', async () => {
  mockStream(Buffer.from(start + end + frame('safety_warning', { message: 'Keep visible' }) + frame('future_event', { flag: true }) + frame('error', { message: 'late failure' })));
  const seen: string[] = [];
  const read = async () => { for await (const event of client().ai.sendMessageStream('conv', 'hello')) seen.push(event.event); };
  await expect(read()).rejects.toMatchObject({ error: { code: 'stream_error' } });
  expect(seen).toEqual(['message_start', 'message_end', 'safety_warning', 'future_event', 'error']);
});

test.each([400, 401, 429, 503])('keeps HTTP %s details and never retries a write', async status => {
  global.fetch = jest.fn().mockResolvedValue(Response.json({ error: { code: 'denied', message: 'No' } }, { status, headers: { 'Retry-After': '17' } }));
  await expect(collect((client().ai as any).sendMessageStream('conv', 'hello'))).rejects.toMatchObject({ status, error: { code: 'denied' } });
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('rejects JSON success instead of pretending it is a stream', async () => {
  global.fetch = jest.fn().mockResolvedValue(Response.json({ text: 'wrong format' }));
  await expect(collect((client().ai as any).sendMessageStream('conv', 'hello'))).rejects.toMatchObject({ error: { code: 'invalid_stream_response' } });
});

test('JSON read methods retain their transport', async () => {
  global.fetch = jest.fn().mockResolvedValue(Response.json({ messages: [] }));
  await expect(client().ai.getMessages('conv')).resolves.toEqual({ messages: [] });
});

test('network exceptions use the public AI error without replay', async () => {
  global.fetch = jest.fn().mockRejectedValue(new TypeError('fetch failed'));
  await expect(collect(client().ai.sendMessageStream('conv', 'hello'))).rejects.toMatchObject({ error: { code: 'connection_error' } });
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test.each(['null', '"failure"', '{not JSON}'])('handles malformed HTTP error body %s without replay', async body => {
  global.fetch = jest.fn().mockResolvedValue(new Response(body, { status: 503 }));
  await expect(collect(client().ai.sendMessageStream('conv', 'hello'))).rejects.toMatchObject({ status: 503, error: { code: 'unknown' } });
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('delivers a warning before a later malformed event in the same chunk', async () => {
  mockStream(Buffer.from(start + frame('safety_warning', { message: 'Keep visible' }) + 'data: invalid\n\n'));
  const seen: string[] = [];
  const read = async () => { for await (const event of client().ai.sendMessageStream('conv', 'hello')) seen.push(event.event); };
  await expect(read()).rejects.toMatchObject({ error: { code: 'malformed_stream' } });
  expect(seen).toEqual(['message_start', 'safety_warning']);
});

test('delivers complete warnings before invalid UTF8 in the same chunk', async () => {
  mockStream(Buffer.concat([Buffer.from(start + frame('safety_warning', { message: 'Keep visible' })), Buffer.from([0xff])]));
  const seen: string[] = [];
  const read = async () => { for await (const event of client().ai.sendMessageStream('conv', 'hello')) seen.push(event.event); };
  await expect(read()).rejects.toMatchObject({ error: { code: 'malformed_stream' } });
  expect(seen).toEqual(['message_start', 'safety_warning']);
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('deadline still applies while the consumer pauses with buffered events', async () => {
  const body = mockStream(Buffer.from(start + end));
  const stream = client().ai.sendMessageStream('conv', 'hello', { timeout: 10 });
  await stream.next();
  await new Promise(resolve => setTimeout(resolve, 25));
  expect(body.locked).toBe(false);
  await expect(stream.next()).rejects.toMatchObject({ error: { code: 'timeout' } });
});

test('a synchronous consumer pause cannot bypass the absolute deadline', async () => {
  mockStream(Buffer.from(start + end));
  const stream = client().ai.sendMessageStream('conv', 'hello', { timeout: 20 });
  await stream.next();
  const until = Date.now() + 60;
  while (Date.now() < until) { /* Deliberately prevent timer callbacks. */ }
  await expect(stream.next()).rejects.toMatchObject({ error: { code: 'timeout' } });
});

test.each([true, false])('clears the deadline after stream completion or failure, success=%s', async success => {
  jest.useFakeTimers();
  mockStream(Buffer.from(start + (success ? end : 'data: invalid\n\n')));
  await collect(client().ai.sendMessageStream('conv', 'hello')).catch(() => undefined);
  expect(jest.getTimerCount()).toBe(0);
});

test('an already aborted call sends no request', async () => {
  mockStream(Buffer.from(start + end));
  const abort = new AbortController(); abort.abort();
  await expect(collect((client().ai as any).sendMessageStream('conv', 'hello', { signal: abort.signal }))).rejects.toMatchObject({ error: { code: 'cancelled' } });
  expect(global.fetch).not.toHaveBeenCalled();
});

test('an explicit iterator throw preserves the caller error and closes the body', async () => {
  const body = mockStream(Buffer.from(start + end));
  const stream = client().ai.sendMessageStream('conv', 'hello');
  await stream.next();
  const error = new Error('caller failure');
  await expect(stream.throw(error)).rejects.toBe(error);
  expect(body.locked).toBe(false);
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('the exact AI README example consumes warning and unknown events', async () => {
  mockStream(Buffer.from(start + frame('safety_warning', { message: 'Keep visible' }) + frame('future_event', { nested: 1 }) + end));
  const section = readFileSync(join(__dirname, '..', 'README.md'), 'utf8').split('## AI writes')[1];
  const source = section.match(/```typescript\n([\s\S]*?)```/)![1];
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const log = jest.fn();
  await new AsyncFunction('require', 'exports', 'console', javascript)(
    (name: string) => { if (name !== '@saturdayinc/sdk') throw new Error(name); return sdk; }, {}, { log, error: jest.fn() },
  );
  expect(log.mock.calls.map(call => call[0])).toEqual(['message_start', 'safety_warning', 'future_event', 'message_end']);
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

describe('native stream deadlines and cancellation', () => {
  let server: Server;
  let baseUrl: string;
  let requests: number;
  let mode: 'stall' | 'error' | 'trickle' | 'headers' | 'disconnect' | 'redirect307' | 'redirect308';
  let targetRequests = 0;
  const sockets = new Set<Socket>();
  const responses = new Set<ServerResponse>();
  beforeAll(async () => {
    server = createServer((_request, response) => {
      requests++;
      if (_request.url === '/target') targetRequests++;
      responses.add(response);
      response.once('close', () => responses.delete(response));
      response.setHeader('Connection', 'close');
      if (mode.startsWith('redirect')) {
        response.writeHead(Number(mode.slice(8)), { Location: '/target' });
        response.end();
        return;
      }
      if (mode === 'headers') return;
      response.statusCode = mode === 'error' ? 503 : 200;
      response.setHeader('Content-Type', mode === 'error' ? 'application/json' : 'text/event-stream');
      response.write(mode === 'error' ? '{"error":' : start);
      if (mode === 'disconnect') {
        setImmediate(() => response.destroy());
      }
      if (mode === 'trickle') {
        const timer = setInterval(() => response.write(': still here\n\n'), 5);
        response.once('close', () => clearInterval(timer));
      }
    });
    server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  beforeEach(() => { mode = 'stall'; requests = 0; targetRequests = 0; });
  afterEach(() => { for (const response of responses) response.destroy(); });
  afterAll(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  test.each(['stall', 'error', 'trickle', 'headers'] as const)('total deadline closes %s, including error body', async fixture => {
    mode = fixture;
    await expect(collect((client({ baseUrl, timeout: 100 }).ai as any).sendMessageStream('conv', 'hello'))).rejects.toMatchObject({ error: { code: 'timeout' } });
    expect(requests).toBe(1);
  });
  test.each(['redirect307', 'redirect308'] as const)('does not forward an AI POST on %s', async fixture => {
    mode = fixture;
    await expect(collect(client({ baseUrl }).ai.sendMessageStream('conv', 'hello'))).rejects.toMatchObject({ error: { code: 'redirect' } });
    expect(requests).toBe(1);
    expect(targetRequests).toBe(0);
  });
  test('maps interrupted sockets without replay', async () => {
    mode = 'disconnect';
    const error = await collect(client({ baseUrl }).ai.sendMessageStream('conv', 'hello')).catch(error => error);
    // A peer can surface as transport failure or an orderly EOF without message_end.
    expect(error).toBeInstanceOf(sdk.AIStreamError);
    expect(['connection_error', 'incomplete_stream']).toContain(error.error.code);
    expect(requests).toBe(1);
  });
  test('abort during a blocked read closes the stream', async () => {
    const abort = new AbortController();
    const stream = (client({ baseUrl }).ai as any).sendMessageStream('conv', 'hello', { signal: abort.signal });
    expect((await stream.next()).value.event).toBe('message_start');
    const pending = stream.next(); abort.abort();
    await expect(pending).rejects.toMatchObject({ error: { code: 'cancelled' } });
    expect(requests).toBe(1);
  });
  test('early consumer break aborts and releases the reader', async () => {
    let response: Response | undefined;
    let signal: AbortSignal | undefined;
    global.fetch = async (url, init) => { signal = init?.signal ?? undefined; response = await originalFetch(url, init); return response; };
    for await (const event of (client({ baseUrl }).ai as any).sendMessageStream('conv', 'hello')) {
      expect(event.event).toBe('message_start'); break;
    }
    expect(signal?.aborted).toBe(true);
    expect(response!.body!.locked).toBe(false);
  });
});
