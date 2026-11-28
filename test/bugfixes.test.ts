// One failing-then-passing test per bug fixed alongside the coverage work.
// Each describe names the wrong behavior it caught; every test here failed
// against the code it was written against, before its fix.
import { Saturday } from '../src/client';

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  jest.useRealTimers();
});

async function captureError(fn: () => unknown): Promise<unknown> {
  try {
    const result = fn();
    if (result instanceof Promise) await result;
    return undefined;
  } catch (e) {
    return e;
  }
}

describe('empty and non-string path ids are rejected before any request', () => {
  // Before the fix, seg('') produced an empty segment, so athletes.get('')
  // called GET /v1/athletes/ (the list route) and returned a page of athletes
  // typed as one Athlete. A non-string id was silently coerced by
  // encodeURIComponent: undefined became the literal segment "undefined".
  it.each([[''], [undefined], [null], [123]])('rejects athlete id %j without calling fetch', async bad => {
    const fetchMock = jest.fn().mockImplementation(async () => Response.json({ ok: true }));
    global.fetch = fetchMock;
    const client = new Saturday({ apiKey: 'sk_test_fake', maxRetries: 0 });
    const error = await captureError(() => client.athletes.get(bad as never));
    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toMatch(/Invalid path segment/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an empty activity id, org id, and coach webhook id', async () => {
    const fetchMock = jest.fn().mockImplementation(async () => Response.json({ ok: true }));
    global.fetch = fetchMock;
    const client = new Saturday({ apiKey: 'sk_test_fake', maxRetries: 0 });
    expect(await captureError(() => client.activities.get('ath_1', ''))).toBeInstanceOf(TypeError);
    expect(await captureError(() => client.organizations.get(''))).toBeInstanceOf(TypeError);
    expect(await captureError(() => client.coach.deleteWebhook(''))).toBeInstanceOf(TypeError);
    expect(await captureError(() => client.webhooks.get(undefined as never))).toBeInstanceOf(TypeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still allows the id "0" and dotted ids', async () => {
    const fetchMock = jest.fn().mockImplementation(async () => Response.json({ ok: true }));
    global.fetch = fetchMock;
    const client = new Saturday({ apiKey: 'sk_test_fake', maxRetries: 0 });
    await client.athletes.get('0');
    await client.athletes.get('a.b');
    expect(fetchMock.mock.calls.map(c => c[0])).toEqual([
      'https://api.saturday.fit/v1/athletes/0',
      'https://api.saturday.fit/v1/athletes/a.b',
    ]);
  });
});

describe('coach roster windows are query-encoded', () => {
  // roster and rosterDigest interpolated the window into the URL raw, unlike
  // every other query in the client (URLSearchParams or encodeURIComponent).
  // A JS caller passing '7&admin=1' injected a second query parameter.
  it('form-encodes a window carrying query syntax, for the API to judge as one value', async () => {
    const fetchMock = jest.fn().mockImplementation(async () => Response.json({ ok: true }));
    global.fetch = fetchMock;
    const client = new Saturday({ apiKey: 'cp_test_fake', maxRetries: 0 });
    await client.coach.roster({ window: '7&admin=1' as never });
    await client.coach.rosterDigest({ window: '7#x' as never });
    expect(fetchMock.mock.calls.map(c => c[0])).toEqual([
      'https://api.saturday.fit/v1/coach/roster?window=7%26admin%3D1',
      'https://api.saturday.fit/v1/coach/roster/digest?window=7%23x',
    ]);
  });

  it('keeps a valid window and a bare roster read unchanged', async () => {
    const fetchMock = jest.fn().mockImplementation(async () => Response.json({ ok: true }));
    global.fetch = fetchMock;
    const client = new Saturday({ apiKey: 'cp_test_fake', maxRetries: 0 });
    await client.coach.roster({ window: 14 });
    await client.coach.rosterDigest();
    expect(fetchMock.mock.calls.map(c => c[0])).toEqual([
      'https://api.saturday.fit/v1/coach/roster?window=14',
      'https://api.saturday.fit/v1/coach/roster/digest',
    ]);
  });
});

describe('request() requires a path starting with a slash', () => {
  // Before the fix, request('GET', 'v1/health') concatenated baseUrl and
  // path into https://api.saturday.fitv1/health (a different host) and sent
  // the Authorization header there. An empty path requested the bare base URL.
  it.each([['v1/health'], ['']])('refuses path %j without calling fetch', async path => {
    const fetchMock = jest.fn().mockImplementation(async () => Response.json({ ok: true }));
    global.fetch = fetchMock;
    const client = new Saturday({ apiKey: 'sk_test_fake', maxRetries: 0 });
    const error = await captureError(() => client.request('GET', path));
    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toMatch(/Invalid path/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still allows a normal absolute path', async () => {
    const fetchMock = jest.fn().mockImplementation(async () => Response.json({ ok: true }));
    global.fetch = fetchMock;
    const client = new Saturday({ apiKey: 'sk_test_fake', maxRetries: 0 });
    await expect(client.request('GET', '/v1/health')).resolves.toEqual({ ok: true });
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.saturday.fit/v1/health');
  });
});
