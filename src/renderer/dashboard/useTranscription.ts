import { useEffect, useState } from 'react';
import type { Settings, StatusMap } from '../../shared/channels';
import { cleanIpcError } from '../../shared/format';
import type { TranscribeLanguage } from '../../shared/transcription';
import { useToast } from './Toast';

const api = window.dashboardApi;

/** Job status per note, whether a server is set up, and the last language used. */
export function useTranscription() {
  const toast = useToast();
  const [status, setStatus] = useState<StatusMap>({});
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    api.getTranscriptionStatus().then(setStatus);
    const offStatus = api.onTranscriptionStatus(setStatus);
    const load = () => api.getSettings().then(setSettings);
    load();
    const offSettings = api.onSettingsChanged(load);
    return () => {
      offStatus();
      offSettings();
    };
  }, []);

  const language = settings?.transcribeLanguage ?? 'auto';

  /** A language picked from the menu becomes the default for next time. */
  const transcribe = (ids: string[], picked?: TranscribeLanguage) => {
    if (picked && picked !== language)
      api
        .setSettings({ transcribeLanguage: picked })
        .catch((e) => toast(cleanIpcError(e)));
    api
      .transcribeNotes(ids, picked ?? language)
      .catch((e) => toast(cleanIpcError(e)));
  };

  return {
    status,
    ready: settings?.transcription.provider != null,
    language,
    transcribe,
  };
}
