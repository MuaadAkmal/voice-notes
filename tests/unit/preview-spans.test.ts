import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import {
  linkAt,
  previewSpans,
  type PreviewSpan,
} from '../../src/renderer/dashboard/editor/preview-spans';

function spans(doc: string, cursor: number | [number, number]): PreviewSpan[] {
  const [anchor, head] = typeof cursor === 'number' ? [cursor, cursor] : cursor;
  const state = EditorState.create({
    doc,
    selection: EditorSelection.single(anchor, head),
    extensions: [markdown({ base: markdownLanguage })],
  });
  ensureSyntaxTree(state, state.doc.length);
  return previewSpans(state);
}

const hides = (list: PreviewSpan[]) =>
  list.filter((s) => s.kind === 'hide').map((s) => [s.from, s.to]);

describe('previewSpans', () => {
  it('hides the heading mark and its space when the cursor is elsewhere', () => {
    expect(hides(spans('# Hi\n\ntext', 8))).toEqual([[0, 2]]);
    expect(spans('# Hi\n\ntext', 3).filter((s) => s.from < 4)).toEqual([]);
  });

  it('renders everything in a read-only state, wherever the selection is', () => {
    const state = EditorState.create({
      doc: '# Hi\n- [ ] **a**',
      selection: EditorSelection.single(0),
      extensions: [
        markdown({ base: markdownLanguage }),
        EditorState.readOnly.of(true),
      ],
    });
    ensureSyntaxTree(state, state.doc.length);
    expect(previewSpans(state).map((s) => [s.kind, s.from, s.to])).toEqual([
      ['hide', 0, 2],
      ['checkbox', 7, 10],
      ['hide', 11, 13],
      ['hide', 14, 16],
    ]);
  });

  it('hides emphasis marks unless the cursor touches the node', () => {
    expect(hides(spans('a **b** c', 0))).toEqual([
      [2, 4],
      [5, 7],
    ]);
    expect(spans('a **b** c', 4)).toEqual([]);
    expect(hides(spans('a *b* ~~c~~ `d`', 0))).toEqual([
      [2, 3],
      [4, 5],
      [6, 8],
      [9, 11],
      [12, 13],
      [14, 15],
    ]);
  });

  it('hides link brackets and the url but keeps the text', () => {
    expect(hides(spans('z\n[x](http://y)', 0))).toEqual([
      [2, 3],
      [4, 15],
    ]);
    expect(spans('z\n[x](http://y)', 3)).toEqual([]);
  });

  it('hides blockquote marks off the cursor line', () => {
    expect(hides(spans('> q\n\nz', 6))).toEqual([[0, 2]]);
    expect(spans('> q\n\nz', 1)).toEqual([]);
  });

  it('renders task markers as checkboxes unless the cursor is inside the brackets', () => {
    const doc = '- [ ] a\n- [x] b';
    expect(spans(doc, doc.length)).toEqual([
      { from: 2, to: 5, kind: 'checkbox', checked: false },
      { from: 10, to: 13, kind: 'checkbox', checked: true },
    ]);
    expect(spans(doc, 11)).toEqual([
      { from: 2, to: 5, kind: 'checkbox', checked: false },
    ]);
    expect(spans(doc, 10)).toHaveLength(2);
  });

  it('replaces a table unless the cursor is inside it', () => {
    const doc = '| a | b |\n|---|---|\n| 1 | 2 |\n\nz';
    const end = doc.indexOf('\n\nz');
    expect(spans(doc, doc.length)).toEqual([
      { from: 0, to: end, kind: 'table' },
    ]);
    expect(spans(doc, 12).filter((s) => s.kind === 'table')).toEqual([]);
  });

  it('replaces images and horizontal rules off the cursor line', () => {
    const src = 'vn-image://0b6c1a52-3f0e-4d39-9a41-8d1f5d0c2a11.png';
    const doc = `![cat](${src})\n\nz`;
    expect(spans(doc, doc.length)).toEqual([
      { from: 0, to: doc.length - 3, kind: 'image', src, alt: 'cat' },
    ]);
    expect(spans(doc, 3)).toEqual([]);
    expect(spans('---\n\nz', 6)).toEqual([{ from: 0, to: 3, kind: 'hr' }]);
    expect(spans('---\n\nz', 1)).toEqual([]);
  });

  it('hides code fences but not the code', () => {
    const doc = '```js\nlet a\n```\n\nz';
    expect(spans(doc, doc.length)).toEqual([
      { from: 0, to: 5, kind: 'hide' },
      { from: 12, to: 15, kind: 'hide' },
    ]);
    expect(spans(doc, 8)).toEqual([]);
  });

  it('copes with partially typed markdown', () => {
    for (const doc of [
      '**b',
      '[x](',
      '![a](',
      '| a |\n|--',
      '```',
      '#',
      '- [',
      '> ',
      '~~',
      '`',
    ]) {
      for (let pos = 0; pos <= doc.length; pos++)
        expect(() => spans(doc, pos)).not.toThrow();
    }
    expect(spans('#\n\nz', 4)).toEqual([{ from: 0, to: 1, kind: 'hide' }]);
  });

  it('finds the openable url of the link under a position', () => {
    const at = (doc: string, pos: number) => {
      const state = EditorState.create({
        doc,
        extensions: [markdown({ base: markdownLanguage })],
      });
      ensureSyntaxTree(state, state.doc.length);
      return linkAt(state, pos);
    };
    expect(at('see [x](https://a.b/c) now', 5)).toBe('https://a.b/c');
    expect(at('see [x](https://a.b/c) now', 12)).toBe('https://a.b/c');
    expect(at('mail <mailto:a@b.c> here', 8)).toBe('mailto:a@b.c');
    expect(at('go https://a.b now', 6)).toBe('https://a.b');
    expect(at('[x](javascript:alert(1))', 1)).toBeNull();
    expect(at('[x](file:///c:/a)', 1)).toBeNull();
    expect(at('plain text', 3)).toBeNull();
    expect(at('[x](', 1)).toBeNull();
  });

  it('returns spans sorted by position', () => {
    const doc = '# A **b**\n\n- [ ] c\n\n---\n\nz';
    const list = spans(doc, doc.length);
    expect(list.map((s) => s.from)).toEqual(
      list.map((s) => s.from).toSorted((a, b) => a - b),
    );
    expect(list.map((s) => s.kind)).toEqual([
      'hide',
      'hide',
      'hide',
      'checkbox',
      'hr',
    ]);
  });
});
