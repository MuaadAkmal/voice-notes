import { expect, it } from 'vitest';
import { snippet } from '../../src/shared/markdown-snippet';

it('strips headings, emphasis and links', () => {
  expect(snippet('# Title\n\nSome **bold** [link](http://x) text')).toBe(
    'Title',
  );
  expect(snippet('Some **bold** [link](http://x) text')).toBe(
    'Some bold link text',
  );
});

it('strips list bullets, checkboxes and code ticks, skipping blank lines', () => {
  expect(snippet('\n\n  - [ ] buy `milk`')).toBe('buy milk');
  expect(snippet('- [x] done')).toBe('done');
});

it('strips quotes and strikethrough', () => {
  expect(snippet('> quoted ~~old~~ new')).toBe('quoted old new');
});

it('returns an empty string when nothing readable is left', () => {
  expect(snippet('')).toBe('');
  expect(
    snippet('![](vn-image://0b0e9a52-1234-4abc-8def-0123456789ab.png)'),
  ).toBe('');
  expect(snippet('---\n```\n```')).toBe('');
});

it('skips a language-tagged fence line', () => {
  expect(snippet('```ts\nconst x = 1;\n```')).toBe('const x = 1;');
  expect(snippet('~~~python\n~~~')).toBe('');
});

it('truncates to 120 chars ending in an ellipsis', () => {
  const out = snippet('a'.repeat(300));
  expect(out).toHaveLength(120);
  expect(out.endsWith('…')).toBe(true);
  expect(snippet('a'.repeat(120))).toBe('a'.repeat(120));
});
