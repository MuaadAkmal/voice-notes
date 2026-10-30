import type { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';

/** A source range the live preview replaces: hidden markup, or a widget standing in for it. */
export type PreviewSpan = { from: number; to: number } & (
  | { kind: 'hide' }
  | { kind: 'checkbox'; checked: boolean }
  | { kind: 'hr' }
  | { kind: 'table' }
  | { kind: 'image'; src: string; alt: string }
);

const INLINE = new Set([
  'Emphasis',
  'StrongEmphasis',
  'Strikethrough',
  'InlineCode',
  'Link',
  'Autolink',
]);
const INLINE_MARKS = new Set([
  'EmphasisMark',
  'StrikethroughMark',
  'CodeMark',
  'LinkMark',
]);

/**
 * What the live preview replaces for `state`: markup of every node the selection doesn't touch
 * (block nodes by line, inline nodes by range), plus widgets for task markers, tables, images and
 * rules. Only nodes overlapping `from`–`to` are visited. Sorted by `from`; adjacent hides are merged.
 * A read-only state has no cursor to edit at, so everything renders.
 */
export function previewSpans(
  state: EditorState,
  from = 0,
  to = state.doc.length,
): PreviewSpan[] {
  const { doc } = state;
  const ranges = state.readOnly ? [] : state.selection.ranges;
  const out: PreviewSpan[] = [];
  const hide = (a: number, b: number) => {
    if (b > a) out.push({ from: a, to: b, kind: 'hide' });
  };

  const touchesLines = (a: number, b: number) => {
    const start = doc.lineAt(a).from;
    const end = doc.lineAt(b).to;
    return ranges.some((r) => r.from <= end && r.to >= start);
  };
  const touches = (a: number, b: number) =>
    ranges.some((r) => r.from <= b && r.to >= a);
  const inside = (a: number, b: number) =>
    ranges.some((r) => r.from < b && r.to > a);
  // Block nodes can end after their trailing newline; widgets must stop at the last line's end.
  const trimEnd = (a: number, b: number) => {
    while (b > a && doc.sliceString(b - 1, b) === '\n') b--;
    return b;
  };

  const children = (node: SyntaxNode, name: string) => node.getChildren(name);

  syntaxTree(state).iterate({
    from,
    to,
    enter: (ref) => {
      const node = ref.node;
      const name = node.name;

      // "\[" shows as "[" (titles added by voice commands escape their brackets).
      if (name === 'Escape') {
        if (!touches(node.from, node.to)) hide(node.from, node.from + 1);
        return false;
      }

      if (name === 'TaskMarker') {
        if (!inside(node.from, node.to)) {
          const checked = /x/i.test(doc.sliceString(node.from, node.to));
          out.push({ from: node.from, to: node.to, kind: 'checkbox', checked });
        }
        return false;
      }

      if (name.startsWith('ATXHeading')) {
        if (touchesLines(node.from, node.to)) return;
        const marks = children(node, 'HeaderMark');
        marks.forEach((m, i) => {
          if (i === 0)
            hide(
              m.from,
              doc.sliceString(m.to, m.to + 1) === ' ' ? m.to + 1 : m.to,
            );
          else
            hide(
              doc.sliceString(m.from - 1, m.from) === ' ' ? m.from - 1 : m.from,
              m.to,
            );
        });
        return;
      }

      if (name === 'Blockquote') {
        if (touchesLines(node.from, node.to)) return;
        for (const m of children(node, 'QuoteMark')) {
          hide(
            m.from,
            doc.sliceString(m.to, m.to + 1) === ' ' ? m.to + 1 : m.to,
          );
        }
        return;
      }

      if (name === 'FencedCode') {
        if (touchesLines(node.from, node.to)) return false;
        const marks = children(node, 'CodeMark');
        if (marks.length > 0) hide(marks[0].from, doc.lineAt(marks[0].from).to);
        if (marks.length > 1)
          hide(marks[marks.length - 1].from, marks[marks.length - 1].to);
        return false;
      }

      if (name === 'Table') {
        const end = trimEnd(node.from, node.to);
        if (touchesLines(node.from, end)) return;
        out.push({ from: node.from, to: end, kind: 'table' });
        return false;
      }

      if (name === 'HorizontalRule') {
        const end = trimEnd(node.from, node.to);
        if (!touchesLines(node.from, end))
          out.push({ from: node.from, to: end, kind: 'hr' });
        return false;
      }

      if (name === 'Image') {
        if (touchesLines(node.from, node.to)) return false;
        const url = node.getChild('URL');
        const marks = children(node, 'LinkMark');
        if (!url || marks.length < 2) return false;
        const src = doc.sliceString(url.from, url.to).replace(/^<|>$/g, '');
        const alt = doc.sliceString(marks[0].to, marks[1].from);
        out.push({ from: node.from, to: node.to, kind: 'image', src, alt });
        return false;
      }

      if (INLINE.has(name)) {
        if (touches(node.from, node.to)) return;
        let child = node.firstChild;
        for (; child; child = child.nextSibling) {
          const hidden =
            INLINE_MARKS.has(child.name) ||
            (name === 'Link' &&
              (child.name === 'URL' ||
                child.name === 'LinkTitle' ||
                child.name === 'LinkLabel'));
          if (hidden) hide(child.from, child.to);
        }
        return;
      }
    },
  });

  out.sort((a, b) => a.from - b.from || a.to - b.to);
  return mergeHides(out);
}

function mergeHides(out: PreviewSpan[]): PreviewSpan[] {
  const merged: PreviewSpan[] = [];
  for (const span of out) {
    const last = merged[merged.length - 1];
    if (
      last &&
      last.kind === 'hide' &&
      span.kind === 'hide' &&
      span.from <= last.to
    ) {
      last.to = Math.max(last.to, span.to);
    } else {
      merged.push(span);
    }
  }
  return merged;
}

const OPENABLE = /^(https?:|mailto:)/i;

/** The http(s)/mailto url of the link (inline, autolink or bare url) at `pos`, if any. */
export function linkAt(state: EditorState, pos: number): string | null {
  const tree = syntaxTree(state);
  for (const side of [1, -1] as const) {
    for (
      let node: SyntaxNode | null = tree.resolveInner(pos, side);
      node;
      node = node.parent
    ) {
      if (
        node.name !== 'URL' &&
        node.name !== 'Link' &&
        node.name !== 'Autolink'
      )
        continue;
      const url = node.name === 'URL' ? node : node.getChild('URL');
      if (!url) return null;
      const text = state.doc
        .sliceString(url.from, url.to)
        .replace(/^<|>$/g, '');
      return OPENABLE.test(text) ? text : null;
    }
  }
  return null;
}

/** An image alone on its line renders as a block; one inside text stays inline. */
function isBlockImage(state: EditorState, span: PreviewSpan) {
  const line = state.doc.lineAt(span.from);
  return line.text.trim() === state.doc.sliceString(span.from, span.to);
}

/**
 * The spans rendered as block widgets (tables, rules, lone images), widened to whole lines,
 * because a block widget must replace entire lines.
 */
export function blockSpans(state: EditorState): PreviewSpan[] {
  return previewSpans(state)
    .filter(
      (span) =>
        span.kind === 'table' ||
        span.kind === 'hr' ||
        (span.kind === 'image' && isBlockImage(state, span)),
    )
    .map((span) => ({
      ...span,
      from: state.doc.lineAt(span.from).from,
      to: state.doc.lineAt(span.to).to,
    }));
}

/**
 * Where a cursor motion from `head` to `dest` should stop instead, when it would jump over a
 * rendered block: on the nearest block's first line moving forward, its last line moving back.
 * Landing there reveals the block's source. Null when no block lies in the way.
 */
export function blockEntry(
  blocks: readonly { from: number; to: number }[],
  head: number,
  dest: number,
): number | null {
  let target: number | null = null;
  for (const block of blocks) {
    if (dest > head && block.from > head && block.from <= dest) {
      if (target === null || block.from < target) target = block.from;
    } else if (dest < head && block.to < head && block.to >= dest) {
      if (target === null || block.to > target) target = block.to;
    }
  }
  return target;
}
