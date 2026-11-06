import { describe, expect, it, vi } from 'vitest';
import { PolishedAudio } from '../../../src/main/polished/service';
import { CloudNotSignedIn, QuotaExceeded, StorageFull } from '../../../src/main/transcription/cloud-client';
import { Offline } from '../../../src/main/sync/http-server';
import { STOCK_VOICES, type VoiceState } from '../../../src/shared/asr/protocol';
import type { Note } from '../../../src/shared/channels';
import { silentWav } from '../../../src/shared/wav';

const note = (over: Partial<Note> = {}): Note =>
  ({ id: 'n1', transcript: 'hello there world', source: 'mic', kind: 'note', status: 'ok', pageId: null, durationMs: 10_000, ...over }) as Note;

const VOICE = (clone: VoiceState['clone'] = 'none'): VoiceState => ({ stock: [], clone, canClone: true, plan: 'standard' });

function setup(o: { note?: Note | null; voice?: string; clone?: VoiceState['clone']; notes?: Note[] } = {}) {
  const n = o.note === undefined ? note() : o.note;
  let clock = 1000;
  const d = {
    store: {
      get: vi.fn((id: string) => (n && n.id === id ? n : undefined)),
      list: vi.fn(() => o.notes ?? []),
      setPolished: vi.fn(),
    },
    files: { fetchPolished: vi.fn(async (_: string) => undefined) },
    client: {
      speak: vi.fn(async (_: unknown) => ({ seconds: 3, used: 10, limit: 60, resetsAt: 'r' })),
      voice: vi.fn(async () => VOICE(o.clone)),
      clone: vi.fn(async (_: Uint8Array) => VOICE('ready')),
      removeClone: vi.fn(async () => VOICE('none')),
    },
    polish: vi.fn(async (t: string) => `polished ${t}` as string | null),
    settings: () => ({ ttsVoice: o.voice ?? STOCK_VOICES[2].id }),
    now: () => clock,
    onUsage: vi.fn(),
    notesChanged: vi.fn(),
    toWav: vi.fn(async (_: Note) => silentWav(20)),
    log: vi.fn(),
  };
  return { d, svc: new PolishedAudio(d as never), tick: (ms: number) => void (clock += ms) };
}

describe('make', () => {
  it('refuses a note without a transcript', async () => {
    for (const transcript of [null, '', '   ']) {
      const { d, svc } = setup({ note: note({ transcript }) });
      expect(await svc.make('n1')).toEqual({ ok: false, reason: 'no-transcript' });
      expect(d.client.speak).not.toHaveBeenCalled();
    }
    expect(await setup({ note: null }).svc.make('n1')).toEqual({ ok: false, reason: 'no-transcript' });
  });

  it('polishes, speaks, records, fetches and tells the window', async () => {
    const { d, svc } = setup();
    expect(await svc.make('n1')).toEqual({ ok: true });
    expect(d.client.speak).toHaveBeenCalledWith({ noteId: 'n1', text: 'polished hello there world', voice: STOCK_VOICES[2].id });
    expect(d.store.setPolished).toHaveBeenCalledWith('n1', 1000);
    expect(d.store.setPolished.mock.invocationCallOrder[0]).toBeLessThan(d.files.fetchPolished.mock.invocationCallOrder[0]);
    expect(d.files.fetchPolished).toHaveBeenCalledWith('n1');
    expect(d.onUsage).toHaveBeenCalledWith({ used: 10, limit: 60, resetsAt: 'r' });
    expect(d.notesChanged).toHaveBeenCalled();
  });

  it('speaks the transcript when polishing fails', async () => {
    const { d, svc } = setup();
    d.polish.mockRejectedValue(new Error('x'));
    expect(await svc.make('n1')).toEqual({ ok: true });
    expect((d.client.speak.mock.calls[0][0] as { text: string }).text).toBe('hello there world');
  });

  it('speaks the transcript when polishing returns nothing', async () => {
    const { d, svc } = setup();
    d.polish.mockResolvedValue(null);
    await svc.make('n1');
    expect((d.client.speak.mock.calls[0][0] as { text: string }).text).toBe('hello there world');
  });

  it('cuts a long text at a space within 5000 chars', async () => {
    const { d, svc } = setup({ note: note({ transcript: 'abcd '.repeat(1120) }) });
    d.polish.mockImplementation(async (t: string) => t);
    await svc.make('n1');
    const text = (d.client.speak.mock.calls[0][0] as { text: string }).text;
    expect(text.length).toBeLessThanOrEqual(5000);
    expect(text.length).toBeGreaterThan(4900);
    expect(text.endsWith('abcd')).toBe(true);
  });

  it('hard cuts text with no spaces', async () => {
    const { d, svc } = setup({ note: note({ transcript: 'x'.repeat(6000) }) });
    d.polish.mockImplementation(async (t: string) => t);
    await svc.make('n1');
    expect((d.client.speak.mock.calls[0][0] as { text: string }).text.length).toBe(5000);
  });

  it('uses the clone only while it is ready', async () => {
    const ready = setup({ voice: 'clone', clone: 'ready' });
    await ready.svc.make('n1');
    expect((ready.d.client.speak.mock.calls[0][0] as { voice: string }).voice).toBe('clone');
    const none = setup({ voice: 'clone', clone: 'unusable' });
    await none.svc.make('n1');
    expect((none.d.client.speak.mock.calls[0][0] as { voice: string }).voice).toBe(STOCK_VOICES[0].id);
  });

  it('falls back to Sarah when the voice state cannot be read', async () => {
    const { d, svc } = setup({ voice: 'clone' });
    d.client.voice.mockRejectedValue(new Offline());
    await svc.make('n1');
    expect((d.client.speak.mock.calls[0][0] as { voice: string }).voice).toBe(STOCK_VOICES[0].id);
  });

  it('caches the voice state for 5 minutes, and an account change drops it', async () => {
    const { d, svc, tick } = setup({ voice: 'clone', clone: 'ready' });
    await svc.make('n1');
    await svc.make('n1');
    expect(d.client.voice).toHaveBeenCalledTimes(1);
    tick(5 * 60_000 + 1);
    await svc.make('n1');
    expect(d.client.voice).toHaveBeenCalledTimes(2);
    svc.accountChanged();
    await svc.make('n1');
    expect(d.client.voice).toHaveBeenCalledTimes(3);
  });

  it.each([
    [new CloudNotSignedIn(), { ok: false, reason: 'signed-out' }],
    [new Offline(), { ok: false, reason: 'offline' }],
    [new QuotaExceeded('2026-12-01'), { ok: false, reason: 'quota', resetsAt: '2026-12-01' }],
    [new StorageFull(), { ok: false, reason: 'storage-full' }],
    [new Error('boom'), { ok: false, reason: 'failed' }],
  ])('maps %s', async (err, want) => {
    const { d, svc } = setup();
    d.client.speak.mockRejectedValue(err);
    expect(await svc.make('n1')).toEqual(want);
    expect(d.store.setPolished).not.toHaveBeenCalled();
  });

  it('still succeeds when the download fails', async () => {
    const { d, svc } = setup();
    d.files.fetchPolished.mockRejectedValue(new Error('net'));
    expect(await svc.make('n1')).toEqual({ ok: true });
    expect(d.log).toHaveBeenCalled();
  });

  it('shares one run per note', async () => {
    const { d, svc } = setup();
    const a = svc.make('n1');
    const b = svc.make('n1');
    expect(b).toBe(a);
    await a;
    expect(d.client.speak).toHaveBeenCalledTimes(1);
    await svc.make('n1');
    expect(d.client.speak).toHaveBeenCalledTimes(2);
  });
});

describe('remove', () => {
  it('clears polishedAt and tells the window', () => {
    const { d, svc } = setup();
    svc.remove('n1');
    expect(d.store.setPolished).toHaveBeenCalledWith('n1', null);
    expect(d.notesChanged).toHaveBeenCalled();
  });
});

describe('clone', () => {
  it('says few-notes without calling the server when the samples are short', async () => {
    const { d, svc } = setup({ notes: [note({ id: 'a', durationMs: 10_000 })] });
    d.toWav.mockResolvedValue(silentWav(10));
    expect(await svc.clone()).toEqual({ error: 'few-notes' });
    expect(d.client.clone).not.toHaveBeenCalled();
  });

  it('joins the samples and sends them', async () => {
    const { d, svc } = setup({ notes: [note({ id: 'a', durationMs: 20_000 }), note({ id: 'b', durationMs: 20_000 })] });
    const r = await svc.clone();
    expect(r).toMatchObject({ clone: 'ready' });
    const sent = d.client.clone.mock.calls[0][0];
    expect(sent.length).toBe(44 + 40 * 32000);
  });

  it('forgets the cached state', async () => {
    const { d, svc } = setup({ clone: 'none', notes: [note({ id: 'a', durationMs: 20_000 }), note({ id: 'b', durationMs: 20_000 })] });
    await svc.voiceState();
    await svc.clone();
    await svc.voiceState();
    expect(d.client.voice).toHaveBeenCalledTimes(2);
  });
});

describe('sample', () => {
  it('fetches the preview of a stock voice through main', async () => {
    const { d, svc } = setup();
    d.client.voice.mockResolvedValue({ ...VOICE(), stock: [{ id: 'v1', name: 'A', previewUrl: 'https://p/1.mp3' }] });
    const fetchSample = vi.fn(async (_: string) => 'data:audio/mpeg;base64,AA==');
    (d as unknown as { fetchSample: typeof fetchSample }).fetchSample = fetchSample;
    expect(await svc.sample('v1')).toBe('data:audio/mpeg;base64,AA==');
    expect(fetchSample).toHaveBeenCalledWith('https://p/1.mp3');
    expect(await svc.sample('other')).toBeNull();
  });
});
