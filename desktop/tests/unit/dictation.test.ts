import { expect, it } from 'vitest';
import type { Dictation } from '../../src/shared/channels';
import { filterDictations, sameCombo } from '../../src/shared/dictation';

const d = (text: string, app: string | null): Dictation => ({ id: text, text, app, createdAt: 0 });

it('filters dictations by text and app, ignoring accents and case', () => {
  const list = [d('Café latte', null), d('hello', 'Cafe app'), d('other', 'Slack')];
  expect(filterDictations(list, 'cafe').map((x) => x.text)).toEqual(['Café latte', 'hello']);
  expect(filterDictations(list, '  ')).toBe(list);
});

it('compares combos regardless of order', () => {
  expect(sameCombo([29, 3675], [3675, 29])).toBe(true);
  expect(sameCombo([29], [29, 3675])).toBe(false);
});
