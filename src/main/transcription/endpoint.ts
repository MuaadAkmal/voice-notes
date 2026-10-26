import type { Settings } from '../../shared/channels';
import type { ModelId } from '../../shared/transcription';
import type { Secrets } from './secrets';

/** Where one request goes. `release()` ends the request's hold on the built-in engine (no-op for a server). */
export type Endpoint = { baseUrl: string; model: string; apiKey: string | null; release(): void };

export type LocalEngine = { ensure(id: ModelId): Promise<string>; release(): void };

/** The user's server, or the built-in engine (started if needed), as the provider setting says. */
export async function resolveEndpoint(d: {
  settings: () => Settings;
  secrets: Pick<Secrets, 'get'>;
  local: LocalEngine;
}): Promise<Endpoint> {
  const t = d.settings().transcription;
  if (t.provider === 'server') {
    return { baseUrl: t.baseUrl, model: t.model, apiKey: d.secrets.get('server'), release: () => undefined };
  }
  if (t.provider === 'local' && t.localModel) {
    const baseUrl = await d.local.ensure(t.localModel);
    let held = true;
    return {
      baseUrl,
      model: t.localModel, // whisper-server ignores it; kept for the request shape
      apiKey: null,
      release: () => {
        if (!held) return;
        held = false;
        d.local.release();
      },
    };
  }
  throw new Error('Set up transcription first');
}
