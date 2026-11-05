import { expect, it } from 'vitest';
import { NewLines } from '../../../src/main/commands/new-lines';

const setup = (pages = ['a', 'b']) => {
  let saved: Record<string, number> = {};
  const live = new Set(pages);
  const lines = new NewLines({ get: () => saved, set: (next) => (saved = next), exists: (id) => live.has(id) });
  return { lines, live, saved: () => saved };
};

it('counts lines added per page until it is opened', () => {
  const { lines, saved } = setup();
  lines.add('a', 1);
  lines.add('a', 2);
  lines.add('b', 1);
  expect(saved()).toEqual({ a: 3, b: 1 });
  lines.seen('a');
  expect(saved()).toEqual({ b: 1 });
});

it('undo and move take lines back, never below zero', () => {
  const { lines, saved } = setup();
  lines.add('a', 2);
  lines.remove('a', 1);
  expect(saved()).toEqual({ a: 1 });
  lines.remove('a', 5);
  expect(saved()).toEqual({});
});

it('drops counts for deleted pages on the next change', () => {
  const { lines, live, saved } = setup();
  lines.add('a', 1);
  live.delete('a');
  lines.add('b', 1);
  expect(saved()).toEqual({ b: 1 });
});

it('opening a page with nothing new writes nothing', () => {
  let writes = 0;
  const lines = new NewLines({ get: () => ({}), set: () => writes++, exists: () => true });
  lines.seen('a');
  expect(writes).toBe(0);
});
