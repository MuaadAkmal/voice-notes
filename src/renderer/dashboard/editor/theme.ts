import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

// Every colour is a shadcn token from dashboard.css, so the editor follows the app's light/dark theme.
const baseTheme = EditorView.theme({
  '&': {
    color: 'var(--foreground)',
    backgroundColor: 'transparent',
    fontSize: '15px',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-sans)', lineHeight: '1.7' },
  '.cm-content': { padding: '8px 0 40vh', caretColor: 'var(--foreground)' },
  '.cm-line': { padding: '0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--foreground)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection':
    { backgroundColor: 'color-mix(in oklch, var(--primary) 18%, transparent)' },

  '.cm-md-h1, .cm-md-h2, .cm-md-h3, .cm-md-h4, .cm-md-h5, .cm-md-h6': {
    fontFamily: 'var(--font-display)',
    fontWeight: '650',
    letterSpacing: '-0.02em',
    lineHeight: '1.3',
  },
  '.cm-md-h1': { fontSize: '1.9em', paddingTop: '0.5em' },
  '.cm-md-h2': { fontSize: '1.5em', paddingTop: '0.4em' },
  '.cm-md-h3': { fontSize: '1.25em', paddingTop: '0.3em' },
  '.cm-md-h4': { fontSize: '1.1em' },
  '.cm-md-quote': {
    borderLeft: '3px solid var(--border)',
    paddingLeft: '14px !important',
    color: 'var(--muted-foreground)',
  },
  '.cm-md-code': {
    backgroundColor: 'var(--muted)',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.9em',
    padding: '0 12px !important',
  },
  '.cm-md-code-first': {
    borderTopLeftRadius: '6px',
    borderTopRightRadius: '6px',
    paddingTop: '4px !important',
  },
  '.cm-md-code-last': {
    borderBottomLeftRadius: '6px',
    borderBottomRightRadius: '6px',
    paddingBottom: '4px !important',
  },

  '.cm-md-inline-code': {
    backgroundColor: 'var(--muted)',
    borderRadius: '4px',
    padding: '1px 3px',
    fontSize: '0.9em',
  },
  '.cm-md-checkbox': {
    width: '15px',
    height: '15px',
    margin: '0 2px',
    verticalAlign: '-2px',
    cursor: 'pointer',
    accentColor: 'var(--primary)',
  },
  '.cm-md-hr': { padding: '10px 0', cursor: 'text' },
  '.cm-md-hr hr': {
    border: 'none',
    borderTop: '1px solid var(--border)',
    margin: '0',
  },
  '.cm-md-table': { overflowX: 'auto', padding: '6px 0', cursor: 'text' },
  '.cm-md-table table': { borderCollapse: 'collapse', fontSize: '0.95em' },
  '.cm-md-table th, .cm-md-table td': {
    border: '1px solid var(--border)',
    padding: '4px 10px',
    textAlign: 'left',
  },
  '.cm-md-table th': { backgroundColor: 'var(--muted)', fontWeight: '600' },
  '.cm-md-image img': {
    maxWidth: '100%',
    borderRadius: '6px',
    verticalAlign: 'middle',
  },
  'div.cm-md-image': { padding: '6px 0' },
  '.cm-md-image-missing': {
    display: 'inline-block',
    padding: '4px 10px',
    border: '1px dashed var(--border)',
    borderRadius: '6px',
    color: 'var(--muted-foreground)',
    fontSize: '0.9em',
  },
});

const highlightStyle = HighlightStyle.define([
  { tag: t.heading, fontFamily: 'var(--font-display)', fontWeight: '650' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  {
    tag: t.strikethrough,
    textDecoration: 'line-through',
    color: 'var(--muted-foreground)',
  },
  {
    tag: t.link,
    color: 'var(--primary)',
    textDecoration: 'underline',
    textUnderlineOffset: '3px',
  },
  { tag: t.url, color: 'var(--muted-foreground)' },
  { tag: t.processingInstruction, color: 'var(--muted-foreground)' },
  { tag: t.quote, color: 'var(--muted-foreground)' },
  { tag: t.monospace, fontFamily: 'var(--font-mono)' },
  // Code inside fenced blocks, via the nested language parsers.
  {
    tag: [t.keyword, t.operatorKeyword, t.modifier, t.controlKeyword],
    color: 'var(--primary)',
    fontWeight: '600',
  },
  {
    tag: [t.comment, t.meta],
    color: 'var(--muted-foreground)',
    fontStyle: 'italic',
  },
  {
    tag: [t.string, t.regexp, t.special(t.string)],
    color: 'color-mix(in oklch, var(--primary) 65%, var(--muted-foreground))',
  },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--primary)' },
  {
    tag: [
      t.definition(t.variableName),
      t.function(t.variableName),
      t.typeName,
      t.className,
    ],
    fontWeight: '600',
  },
  { tag: t.invalid, color: 'var(--destructive)' },
]);

/** Editor chrome, live-preview widgets and markdown/code highlighting. */
export function markdownTheme(): Extension {
  return [baseTheme, syntaxHighlighting(highlightStyle)];
}
