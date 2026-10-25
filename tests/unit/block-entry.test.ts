import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import {
  blockEntry,
  blockSpans,
} from '../../src/renderer/dashboard/editor/preview-spans';

// The rendered blocks as they stand with the cursor at `head`, and where a motion to `dest` lands.
function entry(doc: string, head: number, dest: number) {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.single(head),
    extensions: [markdown({ base: markdownLanguage })],
  });
  ensureSyntaxTree(state, state.doc.length);
  return blockEntry(blockSpans(state), head, dest);
}

const BLOCKS = {
  table: '| a | b |\n|---|---|\n| 1 | 2 |',
  hr: '---',
  image: '![cat](vn-image://0b6c1a52-3f0e-4d39-9a41-8d1f5d0c2a11.png)',
};

describe('blockSpans', () => {
  it('lists rendered tables, rules and lone images widened to whole lines', () => {
    const state = EditorState.create({
      doc: 'a\n\n  ---\n\nx ![i](b) y\n\nz',
      selection: EditorSelection.single(0),
      extensions: [markdown({ base: markdownLanguage })],
    });
    ensureSyntaxTree(state, state.doc.length);
    expect(blockSpans(state).map((s) => [s.kind, s.from, s.to])).toEqual([
      ['hr', 3, 8],
    ]);
  });
});

describe('blockEntry', () => {
  for (const [name, block] of Object.entries(BLOCKS)) {
    const doc = `a\n\n${block}\n\nz`;
    const start = 3;
    const end = 3 + block.length;
    const z = doc.length - 1;

    it(`moving down or right into a ${name} lands on its first line`, () => {
      expect(entry(doc, 0, z)).toBe(start);
      expect(entry(doc, 2, start)).toBe(start);
    });

    it(`moving up or left into a ${name} lands on its last line`, () => {
      expect(entry(doc, z, 0)).toBe(end);
      expect(entry(doc, end + 1, end)).toBe(end);
    });
  }

  it('does nothing when no rendered block is crossed', () => {
    expect(entry('a\nb\nc', 0, 2)).toBeNull();
    expect(entry('a\nb\nc', 4, 2)).toBeNull();
    expect(entry(`a\n\n${BLOCKS.table}\n\nz`, 0, 1)).toBeNull();
    // Cursor on the table: it is source text, not a widget, so motion is untouched.
    expect(entry(`a\n\n${BLOCKS.table}\n\nz`, 4, 14)).toBeNull();
  });

  it('enters the nearest block when a motion would cross several', () => {
    const doc = `a\n\n---\n\n---\n\nz`;
    expect(entry(doc, 0, doc.length - 1)).toBe(3);
    expect(entry(doc, doc.length - 1, 0)).toBe(11);
  });
});
