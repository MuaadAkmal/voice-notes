import { useEffect, useState } from 'react';

const api = window.dashboardApi;

/** Page id → lines voice commands added since it was last opened (the `newLines` setting), kept current. */
export function useNewLines(): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    const load = () => api.getSettings().then((s) => setCounts(s.newLines ?? {})); // ?? {}: a main from before this setting
    load();
    return api.onSettingsChanged(load);
  }, []);
  return counts;
}

/** The small "● 2" on a page's sidebar row or Home card; nothing when there is nothing new. */
export function NewDot({ count }: { count: number | undefined }) {
  if (!count) return null;
  return (
    <span
      title={`${count} new ${count === 1 ? 'line' : 'lines'} from voice`}
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-1.5 py-px text-[11px] font-medium text-primary"
    >
      <span className="size-1.5 rounded-full bg-primary" aria-hidden />
      {count}
    </span>
  );
}
