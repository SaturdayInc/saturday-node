import { createServer, Server, ServerResponse } from 'node:http';
import { AddressInfo, Socket } from 'node:net';
import { Saturday } from '../src/client';
import { NotFoundError, SaturdayError } from '../src/errors';

const originalFetch = global.fetch;

describe('response-body timeouts with native fetch', () => {
  let server: Server;
  let baseUrl: string;
  let requests: number;
  const sockets = new Set<Socket>();
  const pending = new Set<ServerResponse>();

  beforeAll(async () => {
    server = createServer((request, response) => {
      requests++;
      pending.add(response);
      response.once('close', () => pending.delete(response));
      const fixture = request.url!.split('/')[1];
      response.setHeader('Connection', 'close');
      if (fixture.startsWith('stall-')) {
        response.statusCode = fixture === 'stall-404' ? 404 : fixture === 'stall-503' ? 503 : 200;
        response.setHeader('Content-Type', fixture === 'stall-pdf' ? 'application/pdf' : 'application/json');
        response.write(fixture === 'stall-pdf' ? '%PDF-1.7\n' : '{"partial":');
        return;
      }
      response.statusCode = fixture === 'missing' ? 404 : 200;
      response.setHeader('Content-Type', fixture === 'pdf' ? 'application/pdf' : 'application/json');
      response.end(fixture === 'pdf' ? '%PDF-1.7\ncomplete' : JSON.stringify(
        fixture === 'missing' ? { error: { code: 'not_found', message: 'Not found' } } : { questions: [] },
      ));
    });
    server.on('connection', socket => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(() => {
    requests = 0;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    for (const response of pending) response.destroy();
  });

  afterAll(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it.each(['stall-json', 'stall-pdf', 'stall-404', 'stall-503'])(
    'aborts %s after headers and maps the result to the SDK timeout',
    async fixture => {
      let headersReceived = false;
      let signal: AbortSignal | undefined;
      global.fetch = async (input, init) => {
        signal = init?.signal ?? undefined;
        const response = await originalFetch(input, init);
        headersReceived = true;
        return response;
      };
      const client = new Saturday({
        apiKey: 'sk_test_placeholder', baseUrl: `${baseUrl}/${fixture}`, timeout: 100, maxRetries: 0,
      });
      const result = fixture === 'stall-pdf'
        ? client.coach.reportPdf('athlete_123')
        : client.onboarding.questions();
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      try {
        const outcome = await Promise.race([
          result.catch((error: unknown) => error),
          new Promise(resolve => {
            watchdog = setTimeout(() => resolve('body remained pending after the deadline'), 1000);
          }),
        ]);
        expect(headersReceived).toBe(true);
        expect(outcome).toBeInstanceOf(SaturdayError);
        expect(outcome).toMatchObject({ status: 0, error: { code: 'timeout' } });
        expect(signal?.aborted).toBe(true);
        expect(requests).toBe(1);
      } finally {
        clearTimeout(watchdog);
        for (const response of pending) response.destroy();
        await result.catch(() => undefined);
      }
    },
  );

  it.each(['json', 'pdf', 'missing'])('preserves a complete %s response', async fixture => {
    const client = new Saturday({
      apiKey: 'sk_test_placeholder', baseUrl: `${baseUrl}/${fixture}`, timeout: 1000, maxRetries: 0,
    });
    if (fixture === 'pdf') {
      expect(Buffer.from(await client.coach.reportPdf('athlete_123')).toString()).toBe('%PDF-1.7\ncomplete');
    } else if (fixture === 'missing') {
      await expect(client.onboarding.questions()).rejects.toBeInstanceOf(NotFoundError);
    } else {
      await expect(client.onboarding.questions()).resolves.toEqual({ questions: [] });
    }
    expect(requests).toBe(1);
  });
});

describe('request timer cleanup', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it.each(['json', 'pdf', 'empty', 'missing', 'malformed-error', 'malformed-success', 'network-error'])(
    'clears the timer after %s completes',
    async fixture => {
      let signal: AbortSignal | undefined;
      global.fetch = jest.fn().mockImplementation(async (_input, init) => {
        signal = init.signal;
        if (fixture === 'network-error') throw new TypeError('Connection failed');
        if (fixture === 'pdf') return new Response('%PDF-1.7');
        if (fixture === 'empty') return new Response(null, { status: 204 });
        if (fixture.startsWith('malformed-')) {
          return new Response('not JSON', { status: fixture === 'malformed-error' ? 404 : 200 });
        }
        return Response.json({ error: { message: 'Not found' } }, { status: fixture === 'missing' ? 404 : 200 });
      });
      const client = new Saturday({ apiKey: 'sk_test_placeholder', timeout: 100, maxRetries: 0 });
      const result = fixture === 'pdf' ? client.coach.reportPdf('athlete_123') : client.onboarding.questions();
      const outcome = await result.catch((error: unknown) => error);
      if (fixture === 'missing' || fixture === 'malformed-error') expect(outcome).toBeInstanceOf(NotFoundError);
      if (fixture === 'malformed-success') expect(outcome).toMatchObject({ name: 'SyntaxError' });
      if (fixture === 'network-error') expect(outcome).toBeInstanceOf(TypeError);
      expect(jest.getTimerCount()).toBe(0);
      await jest.advanceTimersByTimeAsync(200);
      expect(signal?.aborted).toBe(false);
    },
  );

  it('clears the previous timer before retry backoff and gives the next attempt its own deadline', async () => {
    const signals: AbortSignal[] = [];
    global.fetch = jest.fn().mockImplementation(async (_input, init) => {
      signals.push(init.signal);
      return signals.length === 1
        ? Response.json({ error: { message: 'Try again' } }, { status: 503 })
        : Response.json({ questions: [] });
    });
    const client = new Saturday({ apiKey: 'sk_test_placeholder', timeout: 100, maxRetries: 1 });
    const result = client.onboarding.questions();
    await jest.advanceTimersByTimeAsync(200);
    expect(signals).toHaveLength(1);
    expect(signals[0].aborted).toBe(false);
    expect(jest.getTimerCount()).toBe(1);
    await jest.advanceTimersByTimeAsync(800);
    await expect(result).resolves.toEqual({ questions: [] });
    expect(signals).toHaveLength(2);
    expect(signals[1]).not.toBe(signals[0]);
    expect(signals[1].aborted).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('keeps the existing timeout behavior while waiting for headers', async () => {
    global.fetch = jest.fn().mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    }));
    const client = new Saturday({ apiKey: 'sk_test_placeholder', timeout: 100, maxRetries: 1 });
    const outcome = client.onboarding.questions().catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(100);
    expect(await outcome).toMatchObject({ status: 0, error: { code: 'timeout' } });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});
