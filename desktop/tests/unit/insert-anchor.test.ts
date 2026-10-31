import { expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  anchorPos,
  holdAnchor,
  insertAnchors,
  releaseAnchor,
} from '../../src/renderer/dashboard/editor/insert-anchor';

// A detached view: state and dispatch work without a DOM.
const makeView = (doc: string) => {
  let state = EditorState.create({ doc, extensions: [insertAnchors()] });
  const view = {
    get state() {
      return state;
    },
    dom: { isConnected: true },
    dispatch: (spec: Parameters<EditorState['update']>[0]) => {
      state = state.update(spec).state;
    },
  };
  return view as unknown as EditorView;
};

it('an anchor follows edits made before it and stays put for edits after it', () => {
  const view = makeView('hello world');
  const id = holdAnchor(view, 6);
  view.dispatch({ changes: { from: 0, insert: '>> ' } });
  expect(anchorPos(view.state, id)).toBe(9);
  view.dispatch({ changes: { from: view.state.doc.length, insert: '!' } });
  expect(anchorPos(view.state, id)).toBe(9);
});

it('an anchor inside deleted text collapses to the deletion point; release forgets it', () => {
  const view = makeView('hello world');
  const id = holdAnchor(view, 8);
  view.dispatch({ changes: { from: 5, to: 11 } });
  expect(anchorPos(view.state, id)).toBe(5);
  releaseAnchor(view, id);
  expect(anchorPos(view.state, id)).toBeUndefined();
});
