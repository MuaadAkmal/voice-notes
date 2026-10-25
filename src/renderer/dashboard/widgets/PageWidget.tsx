import { useEffect, useRef, useState } from 'react';
import type { Page } from '../../../shared/channels';
import { cleanIpcError } from '../../../shared/format';
import { toggledTask } from '../../../shared/task-lines';
import { MarkdownEditor } from '../editor/MarkdownEditor';
import { useToast } from '../Toast';

const api = window.dashboardApi;

type Props = {
  page: Page;
};

/**
 * A page rendered read-only on Home. Its checkboxes still toggle: each toggle is sent to main as an
 * edit of that one line of the current body, so it never overwrites a newer body (e.g. a quick-add).
 */
export function PageWidget({ page }: Props) {
  const toast = useToast();
  // The text the editor shows now; a new `version` remounts the editor with the page's body.
  const text = useRef(page.body);
  const [version, setVersion] = useState(0);
  const latest = useRef(page);
  latest.current = page;

  const reload = () => {
    text.current = latest.current.body;
    setVersion((v) => v + 1);
  };

  // Changed elsewhere (or our own toggle merged with another edit): show the stored body.
  // Same text: no remount, so the scroll position stays.
  useEffect(() => {
    if (page.body !== text.current) reload();
  }, [page.body]);

  const onChange = (body: string) => {
    const toggle = toggledTask(text.current, body);
    text.current = body;
    if (!toggle) return;
    api.setPageTask(page.id, toggle.line, toggle.checked).catch((e) => {
      toast(cleanIpcError(e));
      reload(); // back to what is stored
    });
  };

  return (
    <div className="max-h-80 overflow-y-auto">
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
