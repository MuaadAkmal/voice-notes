import {
  EditorSelection,
  Prec,
  StateField,
  type EditorState,
  type Extension,
  type Range,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  keymap,
  type Command,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { blockEntry, blockSpans, previewSpans } from './preview-spans';
import { CheckboxWidget, HrWidget, ImageWidget, TableWidget } from './widgets';

const hidden = Decoration.replace({});
const inlineCode = Decoration.mark({ class: 'cm-md-inline-code' });

/** Tables, rules and lone images: block widgets must come from a state field, not a plugin. */
function blockDecorations(state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  for (const span of blockSpans(state)) {
    const { from, to } = span;
    const widget =
      span.kind === 'table'
        ? new TableWidget(state.doc.sliceString(from, to))
        : span.kind === 'image'
          ? new ImageWidget(span.src, span.alt, true)
          : new HrWidget();
    ranges.push(Decoration.replace({ block: true, widget }).range(from, to));
  }
  return Decoration.set(ranges, true);
}

const blockField = StateField.define<DecorationSet>({
  create: blockDecorations,
  update(deco, tr) {
    if (
      tr.docChanged ||
      tr.selection ||
      syntaxTree(tr.startState) !== syntaxTree(tr.state)
    ) {
      return blockDecorations(tr.state);
    }
    return deco;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * Arrow keys would jump over a block widget; stop on the block's first line (moving forward) or
 * last line (moving back) instead, which reveals its source. Shift extends the selection likewise.
 */
function enterBlock(
  by: 'line' | 'char',
  forward: boolean,
  extend: boolean,
): Command {
  return (view) => {
    const { state } = view;
    const range = state.selection.main;
    if (state.selection.ranges.length > 1 || (!extend && !range.empty))
      return false;
    const moved =
      by === 'line'
        ? view.moveVertically(range, forward)
        : view.moveByChar(range, forward);
    const blocks: { from: number; to: number }[] = [];
    state.field(blockField).between(0, state.doc.length, (from, to) => {
      blocks.push({ from, to });
    });
    const target = blockEntry(blocks, range.head, moved.head);
    if (target === null) return false;
    view.dispatch({
      selection: extend
        ? EditorSelection.range(range.anchor, target)
        : EditorSelection.cursor(target),
      scrollIntoView: true,
      userEvent: 'select',
    });
    return true;
  };
}

const blockKeymap = Prec.high(
  keymap.of([
    {
      key: 'ArrowDown',
      run: enterBlock('line', true, false),
      shift: enterBlock('line', true, true),
    },
    {
      key: 'ArrowUp',
      run: enterBlock('line', false, false),
      shift: enterBlock('line', false, true),
    },
    {
      key: 'ArrowRight',
      run: enterBlock('char', true, false),
      shift: enterBlock('char', true, true),
    },
    {
      key: 'ArrowLeft',
      run: enterBlock('char', false, false),
      shift: enterBlock('char', false, true),
    },
  ]),
);

const LINE_CLASSES: Record<string, string> = {
  ATXHeading1: 'cm-md-h1',
  ATXHeading2: 'cm-md-h2',
  ATXHeading3: 'cm-md-h3',
  ATXHeading4: 'cm-md-h4',
  ATXHeading5: 'cm-md-h5',
  ATXHeading6: 'cm-md-h6',
  Blockquote: 'cm-md-quote',
  FencedCode: 'cm-md-code',
};

/** Hidden markup, checkboxes and inline images in the viewport, plus heading/quote/code line classes. */
function inlineDecorations(view: EditorView): DecorationSet {
  const { state } = view;
  const ranges: Range<Decoration>[] = [];
  const seen = new Set<string>();
  const blocks = state.field(blockField);
  const inBlock = (pos: number) => {
    let found = false;
    blocks.between(pos, pos, (from, to) => {
      if (pos >= from && pos <= to) found = true;
    });
    return found;
  };

  for (const { from, to } of view.visibleRanges) {
    for (const span of previewSpans(state, from, to)) {
      const key = `${span.kind}:${span.from}:${span.to}`;
      if (seen.has(key) || inBlock(span.from)) continue;
      seen.add(key);
      // Plugins may not replace line breaks; skip spans that cross a line rather than throw.
      if (
        state.doc.lineAt(span.from).number !== state.doc.lineAt(span.to).number
      )
        continue;
      if (span.kind === 'hide') ranges.push(hidden.range(span.from, span.to));
      else if (span.kind === 'checkbox') {
        ranges.push(
          Decoration.replace({
            widget: new CheckboxWidget(span.checked),
          }).range(span.from, span.to),
        );
      } else if (span.kind === 'image') {
        ranges.push(
          Decoration.replace({
            widget: new ImageWidget(span.src, span.alt, false),
          }).range(span.from, span.to),
        );
      }
    }

    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name === 'InlineCode') {
          const key = `code:${node.from}`;
          if (!seen.has(key) && node.to > node.from)
            ranges.push(inlineCode.range(node.from, node.to));
          seen.add(key);
          return false;
        }
        const cls = LINE_CLASSES[node.name];
        if (!cls) return;
        const first = state.doc.lineAt(node.from).number;
        const last = state.doc.lineAt(Math.max(node.from, node.to - 1)).number;
        for (let n = first; n <= last; n++) {
          const line = state.doc.line(n);
          const key = `line:${line.from}:${cls}`;
          if (seen.has(key)) continue;
          seen.add(key);
          let lineClass = cls;
          if (cls === 'cm-md-code' && n === first)
            lineClass += ' cm-md-code-first';
          if (cls === 'cm-md-code' && n === last)
            lineClass += ' cm-md-code-last';
          ranges.push(Decoration.line({ class: lineClass }).range(line.from));
        }
        return node.name === 'FencedCode' ? false : undefined;
      },
    });
  }
  return Decoration.set(ranges, true);
}

const inlinePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = inlineDecorations(view);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = inlineDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/** Obsidian-style live preview: markdown renders in place, and the markup near the cursor shows. */
export function livePreview(): Extension {
  return [blockField, inlinePlugin, blockKeymap];
}
