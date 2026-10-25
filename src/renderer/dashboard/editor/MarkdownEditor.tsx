import { useEffect, useLayoutEffect, useRef } from 'react';
import {
  EditorSelection,
  EditorState,
  Prec,
  type Extension,
} from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  dropCursor,
  keymap,
  type Command,
} from '@codemirror/view';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { livePreview } from './live-preview';
import { linkAt } from './preview-spans';
import { markdownTheme } from './theme';
import { checkImageFile } from './image-input';
import {
  anchorPos,
  holdAnchor,
  insertAnchors,
  releaseAnchor,
} from './insert-anchor';

const api = window.dashboardApi;

/** Length of the run of `*` ending at `pos` (dir -1) or starting at it (dir 1), capped at 3. */
function starRun(state: EditorState, pos: number, dir: 1 | -1): number {
  let n = 0;
  while (n < 3) {
    const at = dir === 1 ? pos + n : pos - n - 1;
    if (at < 0 || at >= state.doc.length || state.sliceDoc(at, at + 1) !== '*')
      break;
    n++;
  }
  return n;
}

/** Toggles `*` / `**` around each selection (Mod-i / Mod-b); `***x***` counts as both. */
function toggleMarker(marker: '*' | '**'): Command {
  const n = marker.length;
  const wraps = (run: number) => run === n || run === 3;
  return (view) => {
    const { state } = view;
    view.dispatch(
      state.changeByRange((range) => {
        const outside = Math.min(
          starRun(state, range.from, -1),
          starRun(state, range.to, 1),
        );
        if (wraps(outside)) {
          return {
            changes: [
              { from: range.from - n, to: range.from },
              { from: range.to, to: range.to + n },
            ],
            range: EditorSelection.range(range.from - n, range.to - n),
          };
        }
        const inner =
          range.to - range.from >= 2 * n
            ? Math.min(
                starRun(state, range.from, 1),
                starRun(state, range.to, -1),
              )
            : 0;
        if (wraps(inner)) {
          return {
            changes: [
              { from: range.from, to: range.from + n },
              { from: range.to - n, to: range.to },
            ],
            range: EditorSelection.range(range.from, range.to - 2 * n),
          };
        }
        return {
          changes: [
            { from: range.from, insert: marker },
            { from: range.to, insert: marker },
          ],
          range: EditorSelection.range(range.from + n, range.to + n),
        };
      }),
      { scrollIntoView: true, userEvent: 'input' },
    );
    return true;
  };
}

/** Mod-k: wraps the selection as `[sel](url)` and selects `url` for typing over. */
const insertLink: Command = (view) => {
  view.dispatch(
    view.state.changeByRange((range) => {
      const text = view.state.sliceDoc(range.from, range.to);
      const urlFrom = range.from + text.length + 3;
      return {
        changes: { from: range.from, to: range.to, insert: `[${text}](url)` },
        range: EditorSelection.range(urlFrom, urlFrom + 3),
      };
    }),
    { scrollIntoView: true, userEvent: 'input' },
  );
  return true;
};

/** Ctrl+click on a link opens it in the default browser (main allows only http/https/mailto). */
const linkClick = (onError: (message: string) => void) =>
  EditorView.domEventHandlers({
    mousedown(event, view) {
      if (!(event.ctrlKey || event.metaKey) || event.button !== 0) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      const url = pos === null ? null : linkAt(view.state, pos);
      if (!url) return false;
      event.preventDefault();
      api.openExternal(url).catch(() => onError("Couldn't open link"));
      return true;
    },
  });

/** Markdown (GFM + fenced-code highlighting), live preview, theme and keymaps. */
export function markdownExtensions(
  onError: (message: string) => void,
): Extension[] {
  return [
    history(),
    drawSelection(),
    dropCursor(),
    EditorView.lineWrapping,
    // Includes markdownKeymap: Enter continues list/quote markup, Backspace removes it.
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    livePreview(),
    markdownTheme(),
    linkClick(onError),
    keymap.of([
      { key: 'Mod-b', run: toggleMarker('**') },
      { key: 'Mod-i', run: toggleMarker('*') },
      { key: 'Mod-k', run: insertLink },
      indentWithTab,
      ...defaultKeymap,
      ...historyKeymap,
    ]),
  ];
}

/** Saves image files and inserts `![](vn-image://…)` for each at `pos`; rejected files go to `onError`. */
async function insertImages(
  view: EditorView,
  files: File[],
  pos: number,
  onError: (message: string) => void,
) {
  // The anchor follows the text if the user keeps typing while files are saved.
  const anchor = holdAnchor(view, pos);
  try {
    for (const file of files) {
      const checked = checkImageFile(file);
      if ('error' in checked) {
        onError(checked.error);
        continue;
      }
      let url: string;
      try {
        url = await api.savePageImage(
          new Uint8Array(await file.arrayBuffer()),
          checked.ext,
        );
      } catch {
        onError("Couldn't save image");
        continue;
      }
      if (!view.dom.isConnected) return; // the editor was closed while saving
      const at = anchorPos(view.state, anchor);
      if (at === undefined) return;
      const insert = `![](${url})`;
      view.dispatch({
        changes: { from: at, insert },
        selection: { anchor: at + insert.length },
        scrollIntoView: true,
        userEvent: 'input.paste',
      });
    }
  } finally {
    releaseAnchor(view, anchor);
  }
}

type Props = {
  value: string;
  onChange: (body: string) => void;
  onBlur?: () => void;
  onError: (message: string) => void;
  autoFocus?: boolean;
  /** Not editable and no cursor, so everything renders as preview; checkboxes still toggle (onChange). */
  readOnly?: boolean;
};

/** CodeMirror markdown editor. Uncontrolled: `value` is read on mount; remount (change `key`) to load other text. */
export function MarkdownEditor({
  value,
  onChange,
  onBlur,
  onError,
  autoFocus,
  readOnly,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onChange, onBlur, onError });
  useLayoutEffect(() => {
    callbacks.current = { onChange, onBlur, onError };
  });

  useEffect(() => {
    const onError = (message: string) => callbacks.current.onError(message);
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          markdownExtensions(onError),
          insertAnchors(),
          EditorView.updateListener.of((update) => {
            if (update.docChanged)
              callbacks.current.onChange(update.state.doc.toString());
            if (update.focusChanged && !update.view.hasFocus)
              callbacks.current.onBlur?.();
          }),
          // Built-in paste, drop and typing honour readOnly; the checkbox's own dispatch is not blocked by either.
          readOnly
            ? [
                EditorView.editable.of(false),
                EditorState.readOnly.of(true),
                // No room left below the text for typing into.
                Prec.highest(
                  EditorView.theme({ '.cm-content': { padding: '0' } }),
                ),
              ]
            : [],
          EditorView.domEventHandlers({
            paste(event, view) {
              const data = event.clipboardData;
              // Apps like Word put a picture of copied text on the clipboard too; text wins.
              if (
                view.state.readOnly ||
                !data ||
                data.files.length === 0 ||
                data.getData('text/plain') !== ''
              )
                return false;
              event.preventDefault();
              void insertImages(
                view,
                Array.from(data.files),
                view.state.selection.main.head,
                onError,
              );
              return true;
            },
            drop(event, view) {
              const files = event.dataTransfer?.files;
              if (view.state.readOnly || !files || files.length === 0)
                return false;
              event.preventDefault();
              const pos =
                view.posAtCoords({ x: event.clientX, y: event.clientY }) ??
                view.state.selection.main.head;
              void insertImages(view, Array.from(files), pos, onError);
              return true;
            },
          }),
        ],
      }),
    });
    if (autoFocus) view.focus();
    return () => view.destroy();
    // Uncontrolled: the initial value, autoFocus and readOnly are read once; a new page remounts via `key`.
  }, []);

  return <div ref={host} className="markdown-editor" />;
}
