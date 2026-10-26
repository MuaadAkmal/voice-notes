import { expect, it } from 'vitest';
import { waitForRedirect } from '../../src/main/account/loopback';

const get = async (url: string) => {
  const res = await fetch(url);
  return { status: res.status, text: await res.text() };
};

it('listens on 127.0.0.1 and resolves the code, then stops listening', async () => {
  const { url, result } = await waitForRedirect();
  expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
  const page = await get(`${url}?code=abc`);
  await expect(result).resolves.toEqual({ code: 'abc' });
  expect(page.text).toContain("You're signed in to Voice Notes");
  expect(page.text).not.toContain('abc'); // the code is never echoed
  await expect(fetch(`${url}?code=again`)).rejects.toThrow();
});

it('a refusal on Google\'s page means cancelled', async () => {
  const { url, result } = await waitForRedirect();
  const done = expect(result).rejects.toThrow('Sign-in cancelled');
  const page = await get(`${url}?error=access_denied&error_description=The+user+denied`);
  await done;
  expect(page.text).toContain('Sign-in was cancelled');
});

it('another error carries its description', async () => {
  const { url, result } = await waitForRedirect();
  const done = expect(result).rejects.toThrow('Boom');
  await get(`${url}?error=server_error&error_description=Boom`);
  await done;
});

it('anything but the redirect gets a 404 and the listener keeps waiting', async () => {
  const { url, result } = await waitForRedirect();
  const origin = url.replace('/callback', '');
  expect((await get(`${origin}/favicon.ico`)).status).toBe(404);
  expect((await get(url)).status).toBe(404); // no code, no error: not the redirect
  await get(`${url}?code=late`);
  await expect(result).resolves.toEqual({ code: 'late' });
});

it('gives up after the timeout and stops listening', async () => {
  const { url, result } = await waitForRedirect({ timeoutMs: 50 });
  await expect(result).rejects.toThrow('Sign-in timed out');
  await expect(fetch(url)).rejects.toThrow();
});

it('cancel stops it', async () => {
  const abort = new AbortController();
  const { url, result } = await waitForRedirect({ signal: abort.signal });
  abort.abort();
  await expect(result).rejects.toThrow('Cancelled');
  await expect(fetch(url)).rejects.toThrow();
});
