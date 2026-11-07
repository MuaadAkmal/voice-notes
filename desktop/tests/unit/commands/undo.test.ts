import { expect, it, vi } from 'vitest';
import { ListUndo } from '../../../src/main/commands/undo';
import type { Page } from '../../../src/shared/channels';
import { appendLine } from '../../../src/shared/learn-log';

const page = (id: string, title: string, body: string, updatedAt: number): Page =>
  ({ id, title, body, folderId: null, starred: false, createdAt: 1, updatedAt }) as Page;

function setup() {
  let t = 1_000_000;
  const pages = new Map<string, Page>([
    ['g', page('g', 'Groceries', '- eggs\n- milk\n', 3)],
    ['t', page('t', 'Tamil', '- vanakkam\n', 2)],
    ['n', page('n', '', '', 1)],
  ]);
  const pagesChanged = vi.fn();
  const undo = new ListUndo({
    pages: {
      get: (id) => pages.get(id),
      list: () => [...pages.values()].sort((a, b) => b.updatedAt - a.updatedAt),
      setBody: (id, body) => {
        const p = { ...pages.get(id)!, body };
        pages.set(id, p);
        return p;
      },
      appendLine: (id, text) => {
        const p = { ...pages.get(id)!, body: appendLine(pages.get(id)!.body, text) };
        pages.set(id, p);
        return p;
      },
    },
    pagesChanged,
    now: () => t,
    newLines: { add: (id, n) => counts.set(id, (counts.get(id) ?? 0) + n), remove: (id, n) => counts.set(id, (counts.get(id) ?? 0) - n) },
  });
  return { undo, pages, pagesChanged, counts, later: (ms: number) => (t += ms) };
}

const counts = new Map<string, number>();

it('keeps the pages’ new-line counts in step with add, undo and move', () => {
  counts.clear();
  const { undo, pages } = setup();
  pages.set('g', { ...pages.get('g')!, body: '- eggs\n- milk\n- bread\n- jam\n' });
  const a = undo.remember('g', ['bread', 'jam']);
  expect(counts.get('g')).toBe(2);
  undo.undo(a);
  expect(counts.get('g')).toBe(0);
  pages.set('g', { ...pages.get('g')!, body: '- eggs\n- milk\n- secret\n' });
  const b = undo.remember('g', ['secret']);
  undo.move(b, 't');
  expect(counts.get('g')).toBe(0);
  expect(counts.get('t')).toBe(1);
});

it('undoes once, then says it already changed', () => {
  const { undo, pages, pagesChanged } = setup();
  const id = undo.remember('g', ['milk']);
  expect(undo.undo(id)).toBe('Undone');
  expect(pages.get('g')!.body).toBe('- eggs\n');
  expect(pagesChanged).toHaveBeenCalled();
  expect(undo.undo(id)).toBe('Already changed');
});

it('says it already changed when the user edited the line', () => {
  const { undo, pages } = setup();
  const id = undo.remember('g', ['milk']);
  pages.set('g', { ...pages.get('g')!, body: '- eggs\n- oat milk\n' });
  expect(undo.undo(id)).toBe('Already changed');
  expect(pages.get('g')!.body).toBe('- eggs\n- oat milk\n');
});

it('moves the lines to another page', () => {
  const { undo, pages } = setup();
  const id = undo.remember('g', ['milk']);
  expect(undo.move(id, 't')).toBe('Moved → Tamil');
  expect(pages.get('g')!.body).toBe('- eggs\n');
  expect(pages.get('t')!.body).toBe('- vanakkam\n- milk\n');
});

it('names an untitled page', () => {
  const { undo } = setup();
  expect(undo.move(undo.remember('g', ['milk']), 'n')).toBe('Moved → Untitled');
});

it('offers the other pages, most recently changed first', () => {
  const { undo } = setup();
  const id = undo.remember('g', ['milk']);
  expect(undo.offer(id)).toEqual({ id, pages: [{ id: 't', title: 'Tamil' }, { id: 'n', title: '' }] });
});

it('refuses a page it did not offer', () => {
  const { undo, pages } = setup();
  const id = undo.remember('g', ['milk']);
  expect(undo.move(id, 'g')).toBe('Already changed');
  expect(undo.move(id, 'nope')).toBe('Already changed');
  expect(pages.get('g')!.body).toBe('- eggs\n- milk\n');
});

it('forgets after 2 minutes', () => {
  const { undo, later } = setup();
  const id = undo.remember('g', ['milk']);
  later(120_001);
  expect(undo.offer(id)).toBeNull();
  expect(undo.undo(id)).toBe('Already changed');
});

it('keeps only the last 5', () => {
  const { undo } = setup();
  const first = undo.remember('g', ['milk']);
  for (let i = 0; i < 5; i++) undo.remember('g', ['eggs']);
  expect(undo.offer(first)).toBeNull();
});

it('a deleted page cannot be undone', () => {
  const { undo, pages } = setup();
  const id = undo.remember('g', ['milk']);
  pages.delete('g');
  expect(undo.undo(id)).toBe('Already changed');
});

it('offers at most 50 pages', () => {
  const { undo, pages } = setup();
  for (let i = 0; i < 60; i++) pages.set(`p${i}`, page(`p${i}`, `P${i}`, '', 10 + i));
  expect(undo.offer(undo.remember('g', ['milk']))!.pages).toHaveLength(50);
});

it('latest: the newest live action, null when none or expired', () => {
  const { undo, later } = setup();
  expect(undo.latest()).toBeNull();
  const a = undo.remember('g', ['milk']);
  const b = undo.remember('t', ['vanakkam']);
  expect(undo.latest()).toBe(b);
  undo.undo(b);
  expect(undo.latest()).toBe(a);
  later(2 * 60_000 + 1);
  expect(undo.latest()).toBeNull();
  expect(undo.undo(a)).toBe('Already changed');
});
