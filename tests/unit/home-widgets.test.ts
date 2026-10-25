import { describe, expect, it } from 'vitest';
import type { HomeWidget } from '../../src/shared/channels';
import {
  MAX_HOME_WIDGETS,
  addWidget,
  canAdd,
  isPinned,
  keepExisting,
  moveWidget,
  pinPage,
  pruneWidgets,
  removeWidget,
  renameWidget,
  resizeWidget,
  spanFor,
  unpinPage,
  widgetSize,
} from '../../src/shared/home-widgets';

const p1 = '11111111-1111-4111-8111-111111111111';
const p2 = '22222222-2222-4222-8222-222222222222';
const quick = (id: string, pageId: string): HomeWidget => ({
  id,
  type: 'quick-add',
  pageId,
  label: 'Words',
});
const page = (id: string, pageId: string): HomeWidget => ({
  id,
  type: 'page',
  pageId,
});
const full = (): HomeWidget[] =>
  Array.from({ length: MAX_HOME_WIDGETS }, (_, i) => page(`w${i}`, `p${i}`));

describe('home widget helpers', () => {
  it('canAdd is true below the cap and false at it', () => {
    expect(MAX_HOME_WIDGETS).toBe(24);
    expect(canAdd([])).toBe(true);
    expect(canAdd(full())).toBe(false);
  });

  it('pinPage appends a page widget and isPinned sees it', () => {
    const ws = pinPage([quick('a', p1)], p2, 'b');
    expect(ws).toEqual([quick('a', p1), page('b', p2)]);
    expect(isPinned(ws, p2)).toBe(true);
    expect(isPinned(ws, p1)).toBe(false); // a quick-add is not a pin
  });

  it('pinPage twice gives one widget', () => {
    const once = pinPage([], p1, 'a');
    expect(pinPage(once, p1, 'b')).toEqual(once);
  });

  it('pinPage and addWidget leave a full list unchanged', () => {
    const ws = full();
    expect(pinPage(ws, p1, 'x')).toEqual(ws);
    expect(addWidget(ws, quick('x', p1))).toEqual(ws);
  });

  it('addWidget appends', () => {
    expect(addWidget([page('a', p1)], quick('b', p2))).toEqual([
      page('a', p1),
      quick('b', p2),
    ]);
  });

  it('unpinPage removes page widgets only, keeping a quick-add for the same page', () => {
    const ws = [quick('a', p1), page('b', p1), page('c', p2)];
    expect(unpinPage(ws, p1)).toEqual([quick('a', p1), page('c', p2)]);
  });

  it('pruneWidgets removes every widget type for deleted pages and keeps others', () => {
    const ws = [quick('a', p1), page('b', p1), page('c', p2), quick('d', p2)];
    expect(pruneWidgets(ws, [p1])).toEqual([page('c', p2), quick('d', p2)]);
    expect(pruneWidgets(ws, [])).toEqual(ws);
  });

  it('keepExisting drops widgets whose page is not in the list (orphans)', () => {
    const ws = [quick('a', p1), page('b', p1), page('c', p2)];
    expect(keepExisting(ws, [p2])).toEqual([page('c', p2)]);
    expect(keepExisting(ws, [p1, p2])).toEqual(ws);
    expect(keepExisting(ws, [])).toEqual([]);
  });

  it('moveWidget moves to the start and to the end', () => {
    const ws = [page('a', p1), page('b', p2), quick('c', p1)];
    expect(moveWidget(ws, 'c', 0).map((w) => w.id)).toEqual(['c', 'a', 'b']);
    expect(moveWidget(ws, 'a', 2).map((w) => w.id)).toEqual(['b', 'c', 'a']);
  });

  it('moveWidget with an unknown id is a no-op', () => {
    const ws = [page('a', p1), page('b', p2)];
    expect(moveWidget(ws, 'zzz', 0)).toEqual(ws);
  });
});

describe('renameWidget / removeWidget', () => {
  it('renames only the matching quick-add widget', () => {
    const ws = [quick('a', p1), quick('b', p2), page('c', p1)];
    expect(renameWidget(ws, 'b', 'Tricks')).toEqual([
      quick('a', p1),
      { ...quick('b', p2), label: 'Tricks' },
      page('c', p1),
    ]);
  });

  it('leaves page widgets and unknown ids alone', () => {
    const ws = [quick('a', p1), page('c', p1)];
    expect(renameWidget(ws, 'c', 'X')).toEqual(ws);
    expect(renameWidget(ws, 'zz', 'X')).toEqual(ws);
  });

  it('removes by widget id', () => {
    const ws = [quick('a', p1), page('c', p1)];
    expect(removeWidget(ws, 'a')).toEqual([page('c', p1)]);
    expect(removeWidget(ws, 'zz')).toEqual(ws);
  });
});

describe('widget sizes', () => {
  it('defaults quick-add to 1x2 and pages to 2x2', () => {
    expect(widgetSize(quick('a', p1))).toEqual({ w: 1, h: 2 });
    expect(widgetSize(page('b', p1))).toEqual({ w: 2, h: 2 });
    expect(widgetSize({ ...quick('a', p1), w: 3, h: 1 })).toEqual({
      w: 3,
      h: 1,
    });
  });

  it('resizes one widget, clamped to 1..4', () => {
    const ws = [quick('a', p1), page('b', p2)];
    expect(resizeWidget(ws, 'b', 3, 1)).toEqual([
      quick('a', p1),
      { ...page('b', p2), w: 3, h: 1 },
    ]);
    expect(widgetSize(resizeWidget(ws, 'a', 9, 0)[0])).toEqual({ w: 4, h: 1 });
    expect(resizeWidget(ws, 'nope', 2, 2)).toEqual(ws);
  });

  it('snaps a dragged size in px to whole cells', () => {
    // 4 cells of 100 px with 12 px gaps: 1 cell = 100, 2 = 212, 3 = 324.
    expect(spanFor(100, 100, 12)).toBe(1);
    expect(spanFor(150, 100, 12)).toBe(1);
    expect(spanFor(160, 100, 12)).toBe(2);
    expect(spanFor(330, 100, 12)).toBe(3);
    expect(spanFor(10, 100, 12)).toBe(1);
    expect(spanFor(2000, 100, 12)).toBe(4);
  });
});
