import { useEffect, useState } from 'react';
import { Cloud, Cpu, Server } from 'lucide-react';
import type { KeyInfo, Settings, TestResult } from '../../shared/channels';
import { cleanIpcError } from '../../shared/format';
import {
  normaliseBaseUrl,
  sendsKeyInsecurely,
  TRANSCRIBE_LANGUAGES,
  type TranscribeLanguage,
} from '../../shared/transcription';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CloudCard } from './CloudCard';
import { LocalWhisperCard } from './LocalWhisperCard';
import { useToast } from './Toast';

const api = window.dashboardApi;
const input =
  'w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:border-ring';

export function TranscriptionPage() {
  const toast = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [keyInfo, setKeyInfo] = useState<KeyInfo | null>(null);
  const [keyDraft, setKeyDraft] = useState('');
  const [replacingKey, setReplacingKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [mode, setMode] = useState<'server' | 'local' | 'cloud'>('server');

  useEffect(() => {
    // The fields start from what's saved; later setting changes don't overwrite what's being typed.
    api.getSettings().then((s) => {
      setSettings(s);
      if (s.transcription.provider === 'local') setMode('local');
      setBaseUrl(s.transcription.baseUrl);
      setModel(s.transcription.model);
    });
    api.getKeyInfo().then(setKeyInfo);
    return api.onSettingsChanged(() => api.getSettings().then(setSettings));
  }, []);

  if (!settings || !keyInfo) return null;

  const save = () => {
    const url = normaliseBaseUrl(baseUrl);
    if (!url) return setFormError('Enter a valid http(s) URL');
    if (!model.trim()) return setFormError('Enter a model name');
    setFormError(null);
    setBaseUrl(url);
    setModel(model.trim());
    api
      .setSettings({
        transcription: {
          provider: 'server',
          baseUrl: url,
          model: model.trim(),
          localModel: settings.transcription.localModel,
        },
      })
      .then(setSettings)
      .then(() => toast('Saved'))
      .catch((e) => toast(cleanIpcError(e)));
  };

  const saveKey = () => {
    if (!keyDraft.trim()) return;
    api
      .setKey(keyDraft)
      .then((info) => {
        setKeyInfo(info);
        setKeyDraft('');
        setReplacingKey(false);
      })
      .catch((e) => toast(cleanIpcError(e)));
  };

  const removeKey = () =>
    api
      .removeKey()
      .then(setKeyInfo)
      .catch((e) => toast(cleanIpcError(e)));

  const test = async () => {
    const url = normaliseBaseUrl(baseUrl);
    if (!url) return setFormError('Enter a valid http(s) URL');
    if (!model.trim()) return setFormError('Enter a model name');
    setFormError(null);
    setTesting(true);
    setResult(null);
    try {
      setResult(await api.testTranscription(url, model.trim()));
    } catch (e) {
      setResult({ ok: false, error: cleanIpcError(e) });
    } finally {
      setTesting(false);
    }
  };

  const insecure =
    keyInfo.saved && sendsKeyInsecurely(normaliseBaseUrl(baseUrl) ?? '');

  return (
    <div className="mx-auto max-w-3xl px-10 py-9">
      <h1 className="text-2xl font-semibold tracking-tight">Transcription</h1>
      <p className="mt-1 mb-8 text-sm text-muted-foreground">
        Turn voice notes and dictation into text. Pick where it runs.
      </p>

      <div role="tablist" aria-label="Provider" className="mb-6 flex gap-1 rounded-xl border bg-muted/50 p-1">
        {(
          [
            { id: 'server', icon: Server, name: 'My server' },
            { id: 'local', icon: Cpu, name: 'Built-in' },
            { id: 'cloud', icon: Cloud, name: 'Voice Notes Cloud' },
          ] as const
        ).map(({ id, icon: Icon, name }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mode === id}
            onClick={() => setMode(id)}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              mode === id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-4 shrink-0" />
            {name}
            {settings.transcription.provider === id && (
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">In use</span>
            )}
          </button>
        ))}
      </div>

      {mode === 'cloud' && <CloudCard settings={settings} onSaved={setSettings} />}
      {mode === 'local' && <LocalWhisperCard settings={settings} onSaved={setSettings} />}
      <div className={cn('divide-y divide-border rounded-2xl border bg-card', mode !== 'server' && 'hidden')}>
        <div className="space-y-4 px-5 py-4">
          <label className="block">
            <span className="text-sm font-medium">Base URL</span>
            <input
              className={`${input} mt-1.5`}
              value={baseUrl}
              placeholder="https://your-server.example.com/v1"
              spellCheck={false}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Model</span>
            <input
              className={`${input} mt-1.5`}
              value={model}
              spellCheck={false}
              onChange={(e) => setModel(e.target.value)}
            />
          </label>
          <div className="flex items-center gap-3">
            <Button size="sm" onClick={save}>
              Save
            </Button>
            {formError && (
              <span className="text-sm text-destructive">{formError}</span>
            )}
          </div>
        </div>

        <div className="space-y-2 px-5 py-4">
          <div className="text-sm font-medium">API key</div>
          {keyInfo.saved && !replacingKey ? (
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">
                Key saved ••••{keyInfo.last4}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setReplacingKey(true)}
              >
                Replace
              </Button>
              <Button variant="outline" size="sm" onClick={removeKey}>
                Remove
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <input
                type="password"
                aria-label="API key"
                className={input}
                value={keyDraft}
                autoComplete="off"
                onChange={(e) => setKeyDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveKey()}
              />
              <Button size="sm" onClick={saveKey} disabled={!keyDraft.trim()}>
                Save key
              </Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Optional. Stored encrypted on this PC; never shown again.
          </p>
          {insecure && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Your API key will be sent unencrypted
            </p>
          )}
        </div>

        <div className="flex items-center gap-3 px-5 py-4">
          <Button variant="outline" size="sm" onClick={test} disabled={testing}>
            {testing ? 'Testing…' : 'Test connection'}
          </Button>
          {result &&
            (result.ok ? (
              <span className="text-sm">
                Connected ✓ ({(result.ms / 1000).toFixed(1)} s)
                {result.language && ` · language: ${result.language}`}
              </span>
            ) : (
              <span className="text-sm text-destructive">{result.error}</span>
            ))}
        </div>

      </div>

      <div className="mt-4 rounded-2xl border bg-card">
        <div className="flex items-center justify-between gap-6 px-5 py-4">
          <div>
            <div className="text-sm font-medium">Default language</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              Auto-detect can mistake short clips for English; pick the language
              if it does.
            </div>
          </div>
          <Select
            value={settings.transcribeLanguage}
            onValueChange={(v) =>
              api
                .setSettings({ transcribeLanguage: v as TranscribeLanguage })
                .then(setSettings)
                .catch((e) => toast(cleanIpcError(e)))
            }
          >
            <SelectTrigger className="w-48" aria-label="Default language">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto-detect</SelectItem>
              {TRANSCRIBE_LANGUAGES.map((l) => (
                <SelectItem key={l.code} value={l.code}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
