import { expect, it } from 'vitest';
import { emailFromIdToken, googleOAuth, InvalidGrant } from '../../../src/shared/connectors/google-oauth';

type Call = { url: string; body: string; method: string };

function fakeFetch(status: number, body: unknown) {
  const calls: Call[] = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: String(init?.body ?? ''), method: init?.method ?? 'GET' });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

it('refresh posts a refresh_token grant with the client credentials', async () => {
  const { fetch, calls } = fakeFetch(200, { access_token: 'at', expires_in: 3599 });
  const g = googleOAuth({ clientId: 'cid', clientSecret: 'sec', fetch });
  expect(await g.refresh('r1')).toEqual({ accessToken: 'at', expiresIn: 3599 });
  expect(calls[0].url).toBe('https://oauth2.googleapis.com/token');
  expect(calls[0].method).toBe('POST');
  expect(Object.fromEntries(new URLSearchParams(calls[0].body))).toEqual({
    grant_type: 'refresh_token',
    refresh_token: 'r1',
    client_id: 'cid',
    client_secret: 'sec',
  });
});

it('refresh answered invalid_grant throws InvalidGrant', async () => {
  const { fetch } = fakeFetch(400, { error: 'invalid_grant' });
  await expect(googleOAuth({ clientId: 'c', clientSecret: 's', fetch }).refresh('r')).rejects.toBeInstanceOf(InvalidGrant);
});

it('any other failure is a plain error', async () => {
  const { fetch } = fakeFetch(500, { error: 'backend' });
  const err = await googleOAuth({ clientId: 'c', clientSecret: 's', fetch }).refresh('r').catch((e) => e);
  expect(err).toBeInstanceOf(Error);
  expect(err).not.toBeInstanceOf(InvalidGrant);
});

it('exchange posts the code and reads refresh token, scope and id token', async () => {
  const { fetch, calls } = fakeFetch(200, { access_token: 'at', refresh_token: 'r1', scope: 'openid email', id_token: 'h.p.s' });
  const res = await googleOAuth({ clientId: 'cid', clientSecret: 'sec', fetch }).exchange('code1', 'https://cb');
  expect(res).toEqual({ refreshToken: 'r1', scope: 'openid email', idToken: 'h.p.s' });
  expect(Object.fromEntries(new URLSearchParams(calls[0].body))).toMatchObject({
    grant_type: 'authorization_code',
    code: 'code1',
    redirect_uri: 'https://cb',
  });
});

it('revoke posts the token', async () => {
  const { fetch, calls } = fakeFetch(200, {});
  await googleOAuth({ clientId: 'c', clientSecret: 's', fetch }).revoke('r1');
  expect(calls[0].url).toBe('https://oauth2.googleapis.com/revoke');
  expect(new URLSearchParams(calls[0].body).get('token')).toBe('r1');
});

it('emailFromIdToken reads the payload, and garbage is null', () => {
  const t = `h.${Buffer.from(JSON.stringify({ email: 'a@b.c' })).toString('base64url')}.s`;
  expect(emailFromIdToken(t)).toBe('a@b.c');
  expect(emailFromIdToken('nope')).toBeNull();
  expect(emailFromIdToken('a.!!!.c')).toBeNull();
});
