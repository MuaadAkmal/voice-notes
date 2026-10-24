import { expect, it } from 'vitest';
import type { Folder } from '../../src/shared/channels';
import { buildTree, folderPath, isDescendant, selectRange } from '../../src/shared/folders';

const f = (id: string, name: string, parentId: string | null = null): Folder => ({
  id,
  name,
  parentId,
  createdAt: 0,
  updatedAt: 0,
});

it('buildTree nests and sorts case-insensitively', () => {
  const tree = buildTree([f('1', 'b'), f('2', 'A'), f('3', 'zeta', '2'), f('4', 'Alpha', '2')]);
  expect(tree.map((n) => n.name)).toEqual(['A', 'b']);
  expect(tree[0].children.map((n) => n.name)).toEqual(['Alpha', 'zeta']);
  expect(tree[1].children).toEqual([]);
});

it('buildTree treats orphans as top level', () => {
  expect(buildTree([f('1', 'lost', 'gone')]).map((n) => n.name)).toEqual(['lost']);
});

it('folderPath returns root-to-leaf', () => {
  const all = [f('s', 'Spanish'), f('fi', 'Films', 's'), f('n', 'Narcos', 'fi')];
  expect(folderPath('n', all).map((x) => x.name)).toEqual(['Spanish', 'Films', 'Narcos']);
  expect(folderPath(null, all)).toEqual([]);
  expect(folderPath('unknown', all)).toEqual([]);
});

it('isDescendant true for self and below, false for siblings and ancestors', () => {
  const all = [f('s', 'Spanish'), f('fi', 'Films', 's'), f('j', 'Japanese')];
  expect(isDescendant(all, 's', 's')).toBe(true);
  expect(isDescendant(all, 's', 'fi')).toBe(true);
  expect(isDescendant(all, 'fi', 's')).toBe(false);
  expect(isDescendant(all, 's', 'j')).toBe(false);
});

it('selectRange forwards and backwards', () => {
  const order = ['a', 'b', 'c', 'd'];
  expect(selectRange(order, 'a', 'c')).toEqual(['a', 'b', 'c']);
  expect(selectRange(order, 'd', 'b')).toEqual(['b', 'c', 'd']);
});

it('selectRange without anchor selects target', () => {
  expect(selectRange(['a', 'b'], 'zz', 'b')).toEqual(['b']);
});
