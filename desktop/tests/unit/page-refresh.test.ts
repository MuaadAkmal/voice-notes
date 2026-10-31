import { expect, it } from 'vitest';
import { shouldTakeRemoteBody } from '../../src/shared/sync/page-refresh';

it('an open page takes a body from another PC only when you are not working in it', () => {
  const base = { dirty: false, focused: false, localBody: 'a', remoteBody: 'b' };
  expect(shouldTakeRemoteBody(base)).toBe(true);
  expect(shouldTakeRemoteBody({ ...base, dirty: true })).toBe(false);
  expect(shouldTakeRemoteBody({ ...base, focused: true })).toBe(false);
  expect(shouldTakeRemoteBody({ ...base, remoteBody: 'a' })).toBe(false);
});
