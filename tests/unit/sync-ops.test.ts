import { expect, it } from 'vitest';
import { appendEntry } from '../../src/shared/learn-log';
import {
  appendOnDay,
  applyOp,
  localDay,
  type NoteRow,
  type PageRow,
  setTaskByText,
  taskText,
} from '../../src/shared/sync-ops';

const note: NoteRow = {
  id: 'n1',
  title: 'Old',
  durationMs: 1000,
  sizeBytes: 3,
  mimeType: 'audio/webm',
  createdAt: 1,
  updatedAt: 1,
  folderId: null,
  source: 'mic',
  kind: 'note',
  windowTitle: null,
  show: null,
  starred: false,
  transcript: null,
  transcriptLang: null,
  transcribedAt: null,
};
const page: PageRow = { id: 'p1', title: 'P', body: 'a', folderId: null, starred: false, createdAt: 1, updatedAt: 1 };

it('an update changes only the fields it carries', () => {
  expect(applyOp(note, { op: 'note.update', id: 'n1', fields: { starred: true } })).toEqual({ ...note, starred: true });
});

it('setBody replaces the body', () => {
  expect(applyOp(page, { op: 'page.setBody', id: 'p1', body: 'b' })).toEqual({ ...page, body: 'b' });
});

it('a body change carries when it was made, for sorting', () => {
  expect(applyOp(page, { op: 'page.setBody', id: 'p1', body: 'b', at: 50 })).toEqual({ ...page, body: 'b', updatedAt: 50 });
  expect(applyOp(page, { op: 'page.append', id: 'p1', text: 'x', day: '2026-10-26', at: 60 })?.updatedAt).toBe(60);
  expect(applyOp(page, { op: 'page.setTask', id: 'p1', line: 0, lineText: 'x', checked: true, at: 70 })?.updatedAt).toBe(70);
});

it('a create gives the row and a delete gives nothing', () => {
  expect(applyOp(undefined, { op: 'page.create', id: 'p1', row: page })).toEqual(page);
  expect(applyOp(page, { op: 'page.delete', id: 'p1' })).toBeUndefined();
});

it('an append lands under the heading of the day it was made', () => {
  const body = 'intro';
  expect(appendOnDay(body, 'x', '2026-10-26')).toBe(appendEntry(body, 'x', new Date(2026, 9, 26)));
  expect(applyOp(page, { op: 'page.append', id: 'p1', text: 'x', day: '2026-10-26' })).toEqual({
    ...page,
    body: appendEntry('a', 'x', new Date(2026, 9, 26)),
  });
});

it('a tick finds its line by text when lines shifted', () => {
  const body = '- [ ] milk\n- [ ] eggs';
  expect(setTaskByText(body, 1, taskText('- [ ] eggs'), true)).toBe('- [ ] milk\n- [x] eggs');
  const shifted = '- [ ] bread\n- [ ] milk\n- [ ] eggs';
  expect(setTaskByText(shifted, 1, taskText('- [ ] eggs'), true)).toBe('- [ ] bread\n- [ ] milk\n- [x] eggs');
});

it('an ambiguous or missing tick changes nothing', () => {
  const twice = '- [ ] milk\n- [ ] x\n- [ ] milk';
  expect(setTaskByText(twice, 1, taskText('- [ ] milk'), true)).toBe(twice);
  expect(setTaskByText('- [ ] milk', 0, taskText('- [ ] tea'), true)).toBe('- [ ] milk');
});

it('the tick text ignores the box state', () => {
  expect(taskText('- [x] milk')).toBe(taskText('- [ ] milk'));
});

it('localDay is the local calendar day', () => {
  expect(localDay(new Date(2026, 9, 26, 23, 59).getTime())).toBe('2026-10-26');
  expect(localDay(new Date(2026, 0, 5, 0, 1).getTime())).toBe('2026-01-05');
});
