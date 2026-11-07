import { useEffect, useRef, useState } from 'react';
import { Loader2, Play, Square } from 'lucide-react';
import type { VoiceState } from '../../shared/asr/protocol';
import { PLAN_PAGE_URL } from '../../shared/cloud-usage';
import { cleanIpcError } from '../../shared/format';
import { Button } from '@/components/ui/button';
import { useConfirm } from './ConfirmDialog';
import { useToast } from './Toast';
import { useVoice } from './useVoice';

const api = window.dashboardApi;

const CLONE_ERRORS = {
  'few-notes': 'Record a few more notes first',
  unavailable: "Voice cloning is full right now. We're adding room, so try again soon.",
  'needs-paid-plan': 'Voice cloning is on Pro',
  failed: "Couldn't clone your voice",
} as const;

/** The voice polished audio is read in: six stock voices, and the user's own copy on Pro. */
export function VoicePage() {
  const toast = useToast();
  const { voice, setVoice } = useVoice();
  const [picked, setPicked] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const sample = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const load = () => api.getSettings().then((s) => setPicked(s.ttsVoice));
    void load();
    const off = api.onSettingsChanged(load);
    return () => {
      off();
      sample.current?.pause();
    };
  }, []);

  if (voice === null) return <Frame />;
  if (voice === 'signed-out' || voice === 'offline')
    return (
      <Frame>
        <p className="rounded-2xl border bg-card px-5 py-4 text-sm text-muted-foreground">
          {voice === 'signed-out' ? 'Sign in to use voices' : "Can't reach Voice Notes Cloud"}
        </p>
      </Frame>
    );

  const cloneReady = voice.clone === 'ready';
  // A chosen copy that is gone (removed, or the plan dropped) is read in the first stock voice.
  const current = picked === 'clone' && !cloneReady ? voice.stock[0]?.id : picked;
  const choose = (id: string) => {
    setPicked(id);
    api.setSettings({ ttsVoice: id }).catch((e) => toast(cleanIpcError(e)));
  };

  const play = async (id: string) => {
    sample.current?.pause();
    if (playing === id) {
      setPlaying(null);
      return;
    }
    setPlaying(id);
    const url = await api.voiceSample(id).catch(() => null);
    if (!url) {
      setPlaying(null);
      toast('No sample available');
      return;
    }
    const el = new Audio(url);
    sample.current = el;
    el.onended = el.onerror = () => setPlaying((p) => (p === id ? null : p));
    el.play().catch(() => setPlaying(null));
  };

  const entries = [
    ...voice.stock.map((v) => ({ id: v.id, name: v.name, hasSample: true })),
    ...(cloneReady ? [{ id: 'clone', name: 'My voice', hasSample: false }] : []),
  ];

  return (
    <Frame>
      <div role="radiogroup" aria-label="Voice" className="divide-y divide-border rounded-2xl border bg-card">
        {entries.map((v) => (
          <div key={v.id} className="flex items-center gap-3 px-5 py-3">
            <button
              role="radio"
              aria-checked={current === v.id}
              onClick={() => choose(v.id)}
              className="flex flex-1 items-center gap-3 text-left text-sm"
            >
              <span className={`grid size-4 place-items-center rounded-full border ${current === v.id ? 'border-primary' : 'border-input'}`}>
                {current === v.id && <span className="size-2 rounded-full bg-primary" />}
              </span>
              <span className="font-medium">{v.name}</span>
            </button>
            {v.hasSample && (
              <button
                aria-label={playing === v.id ? `Stop ${v.name} sample` : `Play ${v.name} sample`}
                onClick={() => void play(v.id)}
                className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                {playing === v.id ? <Square className="size-3.5" fill="currentColor" /> : <Play className="size-3.5" fill="currentColor" />}
              </button>
            )}
          </div>
        ))}
      </div>
      <CloneCard voice={voice} onChange={setVoice} />
    </Frame>
  );
}

function Frame({ children }: { children?: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-10 py-9">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Voice</h1>
        <p className="mt-1 text-sm text-muted-foreground">The voice that reads your notes aloud when you make polished audio.</p>
      </header>
      {children}
    </div>
  );
}

function CloneCard({ voice, onChange }: { voice: VoiceState; onChange: (v: VoiceState) => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const upgrade = () => api.openExternal(PLAN_PAGE_URL).catch((e) => toast(cleanIpcError(e)));

  const clone = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await api.cloneVoice(true);
      if ('error' in r) setMessage(CLONE_ERRORS[r.error]);
      else {
        onChange(r);
        setConsent(false);
      }
    } catch (e) {
      setMessage(cleanIpcError(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!(await confirm({ title: 'Remove your voice?', description: 'The copy is deleted. You can clone it again later.', confirmLabel: 'Remove' }))) return;
    setBusy(true);
    try {
      onChange(await api.removeVoice());
    } catch (e) {
      toast(cleanIpcError(e));
    } finally {
      setBusy(false);
    }
  };

  const form = (
    <div className={voice.clone === 'ready' ? 'mt-5 border-t pt-4' : ''}>
      <p className="text-sm text-muted-foreground">Made from your own voice notes on this PC; it needs about a minute of speech.</p>
      <label className="mt-3 flex items-start gap-2 text-sm">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
        This is my own voice, and I agree to ElevenLabs creating a copy of it.
      </label>
      <div className="mt-3 flex items-center gap-3">
        <Button size="sm" onClick={clone} disabled={!consent || busy}>
          {busy && <Loader2 className="size-3.5 animate-spin" />}
          Clone my voice
        </Button>
        {message && <span className="text-xs text-muted-foreground">{message}</span>}
      </div>
    </div>
  );

  let body: React.ReactNode;
  if (voice.clone === 'unusable') {
    body = (
      <>
        <p className="text-sm text-muted-foreground">Your voice is saved. It's used again when you're back on Pro.</p>
        <Button size="sm" className="mt-3" onClick={upgrade}>
          Upgrade
        </Button>
      </>
    );
  } else if (voice.clone === 'ready') {
    body = (
      <>
        <p className="text-sm text-muted-foreground">Your voice is ready. Pick My voice above to have notes read in it.</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={remove} disabled={busy}>
          Remove my voice
        </Button>
      </>
    );
  } else if (voice.canClone) {
    body = form;
  } else if (voice.plan !== 'pro') {
    body = (
      <>
        <p className="text-sm text-muted-foreground">Clone your voice and every polished note is read back as you. On Pro.</p>
        <Button size="sm" className="mt-3" onClick={upgrade}>
          Upgrade
        </Button>
      </>
    );
  } else {
    body = <p className="text-sm text-muted-foreground">Voice cloning is full right now. We're adding room, so try again soon.</p>;
  }

  return (
    <div className="mt-6 rounded-2xl border bg-card px-5 py-4">
      <h2 className="mb-2 text-sm font-medium">{voice.plan === 'pro' ? 'Your own voice' : 'Hear your notes in your own voice'}</h2>
      {body}
    </div>
  );
}
