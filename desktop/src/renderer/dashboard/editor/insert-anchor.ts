import { StateEffect, StateField, type EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

type Anchor = { id: number; pos: number };

const setAnchor = StateEffect.define<Anchor>();
const dropAnchor = StateEffect.define<number>();

/** Positions that follow the text as it is edited (images wait on a file save before landing). */
const anchors = StateField.define<Anchor[]>({
  create: () => [],
  update(value, tr) {
    let next = value;
    if (tr.docChanged)
      next = next.map((a) => ({ id: a.id, pos: tr.changes.mapPos(a.pos, 1) }));
    for (const e of tr.effects) {
      if (e.is(setAnchor))
        next = [...next.filter((a) => a.id !== e.value.id), e.value];
      if (e.is(dropAnchor)) next = next.filter((a) => a.id !== e.value);
    }
    return next;
  },
});

export const insertAnchors = () => anchors;

let nextId = 1;

/** Tracks `pos` through later edits; returns an id for `anchorPos` / `releaseAnchor`. */
export function holdAnchor(view: EditorView, pos: number): number {
  const id = nextId++;
  view.dispatch({ effects: setAnchor.of({ id, pos }) });
  return id;
}

export function anchorPos(state: EditorState, id: number): number | undefined {
  return state.field(anchors).find((a) => a.id === id)?.pos;
}

export function releaseAnchor(view: EditorView, id: number): void {
  if (view.dom.isConnected) view.dispatch({ effects: dropAnchor.of(id) });
}
