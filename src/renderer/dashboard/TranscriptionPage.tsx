import { useEffect, useState } from 'react';
import { Cloud, Cpu, Server } from 'lucide-react';
import type { KeyInfo, Settings, TestResult } from '../../shared/channels';
import { cleanIpcError } from '../../shared/format';
import {
  CLOUD_TIERS,
  normaliseBaseUrl,
  sendsKeyInsecurely,
  TRANSCRIBE_LANGUAGES,
  type TranscribeLanguage,
} from '../../shared/transcription';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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

  useEffect(() => {
    // The fields start from what's saved; later setting changes don't overwrite what's being typed.
    api.getSettings().then((s) => {
      setSettings(s);
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
        Turn voice notes into text with your own Whisper server.
      </p>

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div
          aria-current="true"
          className="col-span-2 flex items-start gap-3 rounded-xl border-2 border-primary bg-card p-3"
        >
          <Server className="mt-0.5 size-4 shrink-0" />
          <div>
            <div className="text-sm font-medium">My server</div>
            <div className="text-xs text-muted-foreground">
              OpenAI-compatible endpoint, e.g. vLLM
            </div>
          </div>
        </div>
        <div
          aria-disabled="true"
          className="col-span-2 flex items-start gap-3 rounded-xl border bg-card p-3 opacity-60"
        >
          <Cpu className="mt-0.5 size-4 shrink-0" />
          <div>
            <div className="text-sm font-medium">Built-in (whisper.cpp)</div>
            <div className="text-xs text-muted-foreground">Runs on this PC, no server</div>
            <ComingSoon />
          </div>
        </div>
        <div
          aria-disabled="true"
          className="col-span-2 rounded-xl border bg-card p-3 opacity-60 sm:col-span-4"
        >
          <div className="flex items-start gap-3">
            <Cloud className="mt-0.5 size-4 shrink-0" />
            <div>
              <div className="text-sm font-medium">Voice Notes Cloud</div>
              <div className="text-xs text-muted-foreground">
                No GPU needed. Free includes 15 min a month, Pro 120 min.
              </div>
              <ComingSoon />
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
            {CLOUD_TIERS.map((tier) => (
              <div key={tier.name} className="rounded-lg bg-muted px-2.5 py-2">
                <div className="text-xs font-medium">{tier.name}</div>
                <div className="text-[11px] text-muted-foreground">{tier.detail}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="divide-y divide-border rounded-2xl border bg-card">
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

function ComingSoon() {
  return (
    <span className="mt-1 inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
      Coming soon
    </span>
  );
}
