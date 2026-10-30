import { useEffect, useState } from 'react';

const api = window.dashboardApi;

/** The built-in pages (Review later, Quick notes): they can't be deleted. */
export function useBuiltInPages(): Set<string> {
  const [ids, setIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    const load = () =>
      api.getSettings().then((s) => setIds(new Set([s.laterPageId, s.notesPageId].filter((id): id is string => !!id))));
    load();
    return api.onSettingsChanged(load);
  }, []);
  return ids;
}
