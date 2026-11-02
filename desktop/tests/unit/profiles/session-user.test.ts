import { expect, it } from 'vitest';
import { sessionUserId } from '../../../src/main/profiles/session-user';

const URL_ = 'https://tpadlhyraittxehfvshc.supabase.co';
const KEY = 'sb-tpadlhyraittxehfvshc-auth-token';
const storage = (map: Record<string, string>) => ({ getItem: (k: string) => map[k] ?? null });

it('reads the user id of the stored session', () => {
  expect(sessionUserId(storage({ [KEY]: JSON.stringify({ user: { id: 'u1' }, expires_at: 9e9 }) }), URL_)).toBe('u1');
});

it('expired token still names the user', () => {
  expect(sessionUserId(storage({ [KEY]: JSON.stringify({ user: { id: 'u1' }, expires_at: 1 }) }), URL_)).toBe('u1');
});

it('no session, bad JSON or no user id is null', () => {
  expect(sessionUserId(storage({}), URL_)).toBeNull();
  expect(sessionUserId(storage({ [KEY]: '{not json' }), URL_)).toBeNull();
  expect(sessionUserId(storage({ [KEY]: JSON.stringify({ user: { id: '' } }) }), URL_)).toBeNull();
  expect(sessionUserId(storage({ [KEY]: JSON.stringify({ access_token: 'x' }) }), URL_)).toBeNull();
});

it('a session under another project key does not count', () => {
  expect(sessionUserId(storage({ 'sb-other-auth-token': JSON.stringify({ user: { id: 'u1' } }) }), URL_)).toBeNull();
});
