import type { Settings } from '../../shared/ipc';

/** Cloud becomes the provider only when none is set up and the user is signed in. Never overwrites a choice. */
export function applyCloudDefault(settings: Settings, signedIn: boolean): Partial<Settings> | null {
  if (!signedIn || settings.transcription.provider !== null) return null;
  return { transcription: { ...settings.transcription, provider: 'cloud' } };
}
