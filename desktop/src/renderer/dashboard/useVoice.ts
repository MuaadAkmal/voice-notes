import { useCallback, useEffect, useState } from 'react';
import type { VoiceState } from '../../shared/asr/protocol';

const api = window.dashboardApi;

/** `null` while loading; `signed-out` and `offline` (the Cloud couldn't be reached) are quiet states, not errors. */
export type VoiceView = VoiceState | 'signed-out' | 'offline' | null;

/** The voices the account can use and its clone, read again whenever the window gets focus back. */
export function useVoice() {
  const [voice, setVoice] = useState<VoiceView>(null);

  const reload = useCallback(
    () =>
      api
        .getVoiceState()
        .then((s) => setVoice('signedOut' in s ? 'signed-out' : s))
        .catch(() => setVoice((prev) => (prev && typeof prev === 'object' ? prev : 'offline'))), // keep what we had
    [],
  );

  useEffect(() => {
    void reload();
    window.addEventListener('focus', reload);
    return () => window.removeEventListener('focus', reload);
  }, [reload]);

  return { voice, setVoice, reload };
}
