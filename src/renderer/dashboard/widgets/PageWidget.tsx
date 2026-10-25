import { useEffect, useRef, useState } from 'react';
import type { Page } from '../../../shared/channels';
import { DebouncedSaver } from '../../../shared/debounced-saver';
import { MarkdownEditor } from '../editor/MarkdownEditor';
import { useToast } from '../Toast';

const api = window.dashboardApi;
const SAVE_DELAY_MS = 500;

type Props = {
  page: Page;
};

/** A page rendered read-only on Home; its checkboxes still toggle, and the body is saved. */
export function PageWidget({ page }: Props) {
  const toast = useToast();
  const onSaveError = () => toast("Couldn't save");
  // The text the editor shows now, and the page version it was mounted from.
  const text = useRef(page.body);
  const [shown, setShown] = useState(page);
  const saving = useRef(false);

  const [saver] = useState(
    () =>
      new DebouncedSaver<string>(
        async (body) => {
          saving.current = true;
          try {
            await api.setPageBody(page.id, body);
          } finally {
            saving.current = false;
          }
        },
        SAVE_DELAY_MS,
        onSaveError,
      ),
  );

  useEffect(() => {
    const flush = () => saver.flush().catch(onSaveError);
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      flush();
    };
  }, [saver]);

  // Edited elsewhere: remount with the new text, unless our own toggle is still on its way
  // (the save's change event comes back after it). Same text: no remount, so the scroll stays.
  useEffect(() => {
    if (saver.pending || saving.current || page.body === text.current) return;
    text.current = page.body;
    setShown(page);
  }, [page, saver]);

  return (
    <div className="max-h-80 overflow-y-auto">
      <MarkdownEditor
        key={`${shown.id}:${shown.updatedAt}`}
        value={shown.body}
        readOnly
        onChange={(body) => {
          text.current = body;
          saver.push(body);
        }}
        onError={toast}
      />
    </div>
  );
}
