import { useEffect, useState } from 'react';
import type { LocalStatus, Settings, TestResult } from '../../shared/channels';
import { cleanIpcError, formatBytes } from '../../shared/format';
import { MODEL_DISPLAY, MODEL_IDS, type ModelId } from '../../shared/transcription';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useConfirm } from './ConfirmDialog';
import { useToast } from './Toast';

const api = window.dashboardApi;
const ENGINE_MB = '9 MB'; // the x64 engine zip; arm64 is smaller
const VC_RUNTIME_URL = 'https://learn.microsoft.com/cpp/windows/latest-supported-vc-redist';

/** Built-in transcription: pick a model, download it, use it. Everything runs on this PC. */
export function LocalWhisperCard({ settings, onSaved }: { settings: Settings; onSaved: (s: Settings) => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [status, setStatus] = useState<LocalStatus | null>(null);
  const [selected, setSelected] = useState<ModelId | null>(settings.transcription.localModel);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  useEffect(() => {
    api.localStatus().then(setStatus);
    return api.onLocalChanged(setStatus);
  }, []);

  if (!status) return null;
  if (!status.available)
    return <div className="rounded-2xl border bg-card px-5 py-4 text-sm text-muted-foreground">Not available on this PC</div>;

  const choice = selected ?? status.recommended;
  const { provider, localModel } = settings.transcription;
  const inUse = provider === 'local' && localModel === choice;
  const downloadedCount = MODEL_IDS.filter((id) => status.models[id]).length;

  const download = (id: ModelId) => {
    setSelected(id);
    api.installLocal(id).catch((e) => {
      const msg = cleanIpcError(e);
      if (msg !== 'Cancelled') toast(msg);
    });
  };

  const remove = async (id: ModelId) => {
    const last = downloadedCount === 1;
    const ok = await confirm({
      title: `Delete ${MODEL_DISPLAY[id].label}?`,
      description: last
        ? 'The built-in engine is removed too. You can download them again any time.'
        : 'You can download it again any time.',
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    try {
      await api.removeLocal(id, last);
      if (provider === 'local' && (last || localModel === id)) toast('Built-in transcription turned off');
    } catch (e) {
      toast(cleanIpcError(e));
    }
  };

  const use = () =>
    api
      .setSettings({ transcription: { ...settings.transcription, provider: 'local', localModel: choice } })
      .then((s) => {
        onSaved(s);
        if (s.transcription.provider === 'local') toast('Using built-in transcription');
      })
      .catch((e) => toast(cleanIpcError(e)));

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      setResult(await api.testLocal());
    } catch (e) {
      setResult({ ok: false, error: cleanIpcError(e) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="divide-y divide-border rounded-2xl border bg-card">
      <div className="px-5 py-4">
        <div className="text-sm font-medium">Built-in (whisper.cpp)</div>
        <div className="mt-0.5 text-xs text-muted-foreground">Runs on this PC. Nothing is sent anywhere.</div>
        {status.runtimeMissing && (
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            <span>This PC needs the Microsoft Visual C++ runtime (x64 or ARM64) before the engine can run.</span>
            <Button variant="outline" size="sm" onClick={() => api.openExternal(VC_RUNTIME_URL).catch(() => undefined)}>
              Get it from Microsoft
            </Button>
          </div>
        )}
      </div>

      <div role="radiogroup" aria-label="Model" className="divide-y divide-border">
        {MODEL_IDS.map((id) => {
          const m = MODEL_DISPLAY[id];
          const job = status.job?.modelId === id ? status.job : null;
          const pct = job && job.total ? Math.floor((job.received / job.total) * 100) : 0;
          return (
            <div
              key={id}
              role="radio"
              aria-checked={choice === id}
              aria-label={`${m.label}, ${formatBytes(m.bytes)}`}
              tabIndex={0}
              onClick={() => setSelected(id)}
              onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && setSelected(id)}
              className={cn(
                'flex cursor-pointer items-center gap-3 px-5 py-3 outline-none hover:bg-accent/40 focus-visible:bg-accent/40',
                choice === id && 'bg-accent/60',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'size-3.5 shrink-0 rounded-full border border-input',
                  choice === id && 'border-4 border-primary',
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {m.label}
                  {status.recommended === id && (
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                      Recommended
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatBytes(m.bytes)} · {m.note} · ~{m.ramGb} GB RAM
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()}>
                {job ? (
                  <>
                    <div className="w-28">
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {job.phase === 'engine' ? 'Engine' : 'Model'} · {pct}%
                      </div>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => api.cancelLocal()}>
                      Cancel
                    </Button>
                  </>
                ) : status.models[id] ? (
                  <>
                    {status.engine ? (
                      <span className="text-xs text-muted-foreground">Downloaded</span>
                    ) : (
                      // The model is here but the engine went (deleted, or quarantined by a virus scanner).
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={status.job !== null}
                        onClick={() => download(id)}
                      >
                        Download engine ({ENGINE_MB})
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`Delete ${m.label}`}
                      disabled={status.job !== null}
                      onClick={() => remove(id)}
                    >
                      Delete
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Download ${m.label}`}
                    disabled={status.job !== null}
                    onClick={() => download(id)}
                  >
                    Download{!status.engine && <span className="text-muted-foreground"> + {ENGINE_MB} engine</span>}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3 px-5 py-4">
        <Button size="sm" onClick={use} disabled={!status.models[choice] || !status.engine || inUse}>
          {inUse ? 'In use ✓' : 'Use built-in'}
        </Button>
        <Button variant="outline" size="sm" onClick={test} disabled={testing || provider !== 'local'}>
          {testing ? 'Testing…' : 'Test'}
        </Button>
        {result &&
          (result.ok ? (
            <span className="text-sm">Ready ✓ ({(result.ms / 1000).toFixed(1)} s)</span>
          ) : (
            <span className="text-sm text-destructive">{result.error}</span>
          ))}
        <span className="ml-auto text-xs text-muted-foreground">
          {status.diskBytes > 0 && `${formatBytes(status.diskBytes)} used`}
        </span>
      </div>
    </div>
  );
}
