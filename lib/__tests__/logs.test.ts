import { afterEach, describe, expect, it, mock } from 'bun:test';
import { fetchLogInspection, fetchLogPage } from '../logs';

const realFetch = globalThis.fetch;

function stubFetch(respond: (url: string) => Response | Promise<Response>) {
  const calls: string[] = [];
  globalThis.fetch = mock(async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return respond(String(input));
  }) as unknown as typeof fetch;
  return calls;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('fetchLogPage', () => {
  it('requests the first page without a cursor', async () => {
    const calls = stubFetch(() => json({ data: [], nextCursor: null }));

    await expect(fetchLogPage(null)).resolves.toEqual({ data: [], nextCursor: null });
    expect(calls).toEqual(['/api/kiosk/logs?limit=20']);
  });

  it('passes the cursor for later pages', async () => {
    const calls = stubFetch(() => json({ data: [], nextCursor: null }));

    await fetchLogPage('log-42');

    expect(calls).toEqual(['/api/kiosk/logs?limit=20&cursor=log-42']);
  });
});

describe('fetchLogInspection', () => {
  it('requests the inspect endpoint with an encoded log ID', async () => {
    const calls = stubFetch(() => json({ log: {}, verification: {} }));

    await fetchLogInspection('a/b c');

    expect(calls).toEqual(['/api/kiosk/logs/a%2Fb%20c/inspect']);
  });

  it("surfaces the server's error message", async () => {
    stubFetch(() => json({ statusCode: 404, message: 'Log "x" not found.' }, 404));

    await expect(fetchLogInspection('x')).rejects.toThrow('Log "x" not found.');
  });

  it('falls back to the status code when the error has no text message', async () => {
    stubFetch(() => json({ statusCode: 400, message: ['limit must be an integer'] }, 400));

    await expect(fetchLogInspection('x')).rejects.toThrow('The server answered 400.');
  });

  it('explains a network failure', async () => {
    stubFetch(() => {
      throw new TypeError('Failed to fetch');
    });

    await expect(fetchLogInspection('x')).rejects.toThrow("Couldn't reach the server.");
  });

  it('rethrows the abort error when the caller cancels', async () => {
    const controller = new AbortController();
    stubFetch(() => {
      controller.abort();
      throw new DOMException('Aborted', 'AbortError');
    });

    await expect(fetchLogInspection('x', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
