import { expect, it } from 'vitest';
import { listenForReturn } from '../../../src/main/connectors/return-page';
import type { CallbackResult } from '../../../src/shared/connectors/protocol';

const HEADINGS: Record<CallbackResult, string> = {
  connected: 'Google Calendar connected',
  denied: 'Not connected',
  'no-calendar': "Calendar access wasn't granted",
  expired: 'This link has expired',
  failed: 'Something went wrong',
};

async function open(timeoutMs = 5_000) {
  const abort = new AbortController();
  const ret = await listenForReturn({ timeoutMs, signal: abort.signal });
  const get = (path: string, init?: RequestInit) => fetch(`http://127.0.0.1:${ret.port}${path}`, init);
  return { ...ret, abort, get };
}

it("serves each result's page", async () => {
  const r = await open();
  for (const [result, heading] of Object.entries(HEADINGS)) {
    const res = await r.get(`/connectors/done?result=${result}`);
    expect(res.status, result).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/html/);
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; style-src 'unsafe-inline'");
    expect(await res.text(), result).toContain(heading);
  }
  r.abort.abort();
});

it('an unknown word is failed, and never echoed', async () => {
  const r = await open();
  const html = await (await r.get('/connectors/done?result=%3Cscript%3Ex')).text();
  expect(html).toContain('Something went wrong');
  expect(html).not.toContain('<script>x');
  r.abort.abort();
});

it('404 for other paths and methods', async () => {
  const r = await open();
  expect((await r.get('/callback?result=connected')).status).toBe(404);
  expect((await r.get('/connectors/done?result=connected', { method: 'POST' })).status).toBe(404);
  r.abort.abort();
});

it('arrived resolves on the first page', async () => {
  const r = await open();
  let arrived = false;
  void r.arrived.then(() => (arrived = true));
  await new Promise((res) => setTimeout(res, 10));
  expect(arrived).toBe(false);
  await r.get('/connectors/done?result=connected');
  await new Promise((res) => setTimeout(res, 10));
  expect(arrived).toBe(true);
  r.abort.abort();
});

it('serves the page after the waiter has gone', async () => {
  const r = await open();
  await r.get('/connectors/done?result=connected');
  // A second tab, or a reload: still the page.
  expect((await r.get('/connectors/done?result=connected')).status).toBe(200);
  r.abort.abort();
});

it('closes on abort and on timeout', async () => {
  const r = await open();
  r.abort.abort();
  await new Promise((res) => setTimeout(res, 20));
  await expect(r.get('/connectors/done?result=connected')).rejects.toThrow();
  const t = await open(30);
  await new Promise((res) => setTimeout(res, 80));
  await expect(t.get('/connectors/done?result=connected')).rejects.toThrow();
});
