import { expect, it } from 'vitest';
import Database from 'better-sqlite3';

it('loads better-sqlite3 under the Electron ABI', () => {
  expect(new Database(':memory:').prepare('select 1 as x').get()).toEqual({ x: 1 });
});
