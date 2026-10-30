import { useEffect, useRef, useState } from 'react';
import type { Page } from '../../../shared/channels';
import { cleanIpcError } from '../../../shared/format';
import { newestFirst } from '../../../shared/newest-first';
import { toggledTask } from '../../../shared/task-lines';
import { MarkdownEditor } from '../editor/MarkdownEditor';
import { useToast } from '../Toast';

const api = window.dashboardApi;

type Props = {
  page: Page;
  /** Newest day and entry first (the Review later card); ticks still edit the stored line. */
  newestFirst?: boolean;
};

/**
 * A page rendered read-only on Home. Its checkboxes still toggle: each toggle is sent to main as an
 * edit of that one line of the current body, so it never overwrites a newer body (e.g. a quick-add).
 */
export function PageWidget({ page, newestFirst: reorder = false }: Props) {
  const toast = useToast();
  const shown = (body: string) => (reorder ? newestFirst(body) : null);
  // The text the editor shows now (the body, or its newest-first view and which stored line each
  // shown line is); a new `version` remounts the editor with the page's body.
  const view = useRef(shown(page.body));
  const text = useRef(view.current?.text ?? page.body);
  const stored = useRef(page.body);
  const [version, setVersion] = useState(0);
  const latest = useRef(page);
  latest.current = page;

  const reload = () => {
    stored.current = latest.current.body;
    view.current = shown(stored.current);
    text.current = view.current?.text ?? stored.current;
    setVersion((v) => v + 1);
  };

  // Changed elsewhere (or our own toggle merged with another edit): show the stored body.
  // Same text: no remount, so the scroll position stays.
  useEffect(() => {
    if (page.body !== stored.current) reload();
  }, [page.body]);

  const onChange = (body: string) => {
    const toggle = toggledTask(text.current, body);
    text.current = body;
    if (!toggle) return;
    const line = view.current ? view.current.lines[toggle.line] : toggle.line;
    if (line === undefined || line < 0) return;
    // What main will store, so its answer isn't taken for an edit from elsewhere (which remounts).
    const lines = stored.current.split('\n');
    lines[line] = body.split('\n')[toggle.line];
    stored.current = lines.join('\n');
    api.setPageTask(page.id, line, toggle.checked).catch((e) => {
      toast(cleanIpcError(e));
      reload(); // back to what is stored
    });
  };

  return (
    <div className="compact-md">
      <MarkdownEditor
        key={`${page.id}:${version}`}
        value={text.current}
        readOnly
        onChange={onChange}
        onError={toast}
      />
    </div>
  );
}
