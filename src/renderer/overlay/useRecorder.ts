import { useEffect, useRef, useState } from 'react';
import type { RecordingSource } from '../../shared/channels';

const MIME = 'audio/webm;codecs=opus';
const BITRATE = 32_000;
const TIMESLICE_MS = 250;
const MIC_WARM_MS = 30_000;
// In "both", lift the voice a little so a comment isn't buried under the film.
const MIC_GAIN = 1.4;
const SYSTEM_GAIN = 1.0;

type Pending = 'stop' | 'cancel' | null;
type Mic = { media: MediaStream; deviceId: string | null; ctx: AudioContext; analyser: AnalyserNode };
/** What one clip records, plus how to tear down anything opened just for it. */
type Clip = { stream: MediaStream; source: RecordingSource; analyser: AnalyserNode; dispose: () => void };

function makeAnalyser(ctx: AudioContext): AnalyserNode {
  const node = ctx.createAnalyser();
  node.fftSize = 64;
  return node;
}

/** Windows loopback ("what you hear") via main's display-media handler; the video track is dropped at once. */
async function openSystemAudio(): Promise<MediaStream> {
  const display = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
  display.getVideoTracks().forEach((t) => t.stop());
  const audio = display.getAudioTracks();
  if (audio.length === 0) throw new Error('no loopback audio track');
  return new MediaStream(audio);
}

/**
 * Captures audio on main's start/stop/cancel commands and ships the clip back.
 * The mic stream stays warm for MIC_WARM_MS after a clip so back-to-back phrases start instantly;
 * system audio is opened per clip.
 */
export function useRecorder(): AnalyserNode | null {
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const mic = useRef<Mic | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const starting = useRef(false);
  const pending = useRef<Pending>(null);
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const api = window.overlayApi;

    const releaseMic = () => {
      mic.current?.media.getTracks().forEach((t) => t.stop());
      mic.current?.ctx.close();
      mic.current = null;
    };

    const scheduleMicRelease = () => {
      if (releaseTimer.current) clearTimeout(releaseTimer.current);
      releaseTimer.current = setTimeout(releaseMic, MIC_WARM_MS);
    };

    const getMic = async (deviceId: string | null): Promise<Mic> => {
      const live = mic.current?.media.getAudioTracks().some((t) => t.readyState === 'live');
      if (mic.current && live && mic.current.deviceId === deviceId) return mic.current;
      releaseMic();
      const open = (id: string | null) =>
        navigator.mediaDevices.getUserMedia({ audio: { deviceId: id ? { exact: id } : undefined, channelCount: 1 } });
      // The chosen mic may have been unplugged since it was picked: fall back to the system default.
      const media = await open(deviceId).catch((err) => {
        if (deviceId && err instanceof DOMException && err.name === 'OverconstrainedError') return open(null);
        throw err;
      });
      const ctx = new AudioContext();
      const node = makeAnalyser(ctx);
      ctx.createMediaStreamSource(media).connect(node);
      mic.current = { media, deviceId, ctx, analyser: node };
      return mic.current;
    };

    const micClip = (m: Mic): Clip => ({ stream: m.media, source: 'mic', analyser: m.analyser, dispose: () => undefined });

    const systemClip = async (): Promise<Clip> => {
      // The user chose not to record the mic: don't leave a warm one open during this clip.
      releaseMic();
      const sys = await openSystemAudio();
      const ctx = new AudioContext();
      await ctx.resume();
      const node = makeAnalyser(ctx);
      ctx.createMediaStreamSource(sys).connect(node);
      return {
        stream: sys,
        source: 'system',
        analyser: node,
        dispose: () => {
          sys.getTracks().forEach((t) => t.stop());
          ctx.close();
        },
      };
    };

    /** Mic + loopback mixed into one track; if loopback fails, the clip is plain mic and says so. */
    const bothClip = async (m: Mic): Promise<Clip> => {
      const sys = await openSystemAudio().catch((err) => {
        console.warn('system audio unavailable, recording mic only', err);
        return null;
      });
      if (!sys) return micClip(m);
      const ctx = new AudioContext();
      // A suspended context would mix silence into the recording.
      await ctx.resume();
      const dest = ctx.createMediaStreamDestination();
      const node = makeAnalyser(ctx);
      for (const [stream, gain] of [
        [m.media, MIC_GAIN],
        [sys, SYSTEM_GAIN],
      ] as const) {
        const g = ctx.createGain();
        g.gain.value = gain;
        ctx.createMediaStreamSource(stream).connect(g);
        g.connect(dest);
        g.connect(node);
      }
      return {
        stream: dest.stream,
        source: 'both',
        analyser: node,
        dispose: () => {
          sys.getTracks().forEach((t) => t.stop());
          ctx.close();
        },
      };
    };

    const openClip = async (deviceId: string | null, source: RecordingSource): Promise<Clip> => {
      if (source === 'system') return systemClip();
      const m = await getMic(deviceId);
      return source === 'both' ? bothClip(m) : micClip(m);
    };

    const finish = (mode: 'stop' | 'cancel') => {
      const rec = recorder.current;
      recorder.current = null;
      if (!rec || rec.state === 'inactive') return;
      if (mode === 'cancel') rec.onstop = null;
      rec.stop();
      scheduleMicRelease();
    };

    api.onStart(async ({ deviceId, source }) => {
      if (releaseTimer.current) clearTimeout(releaseTimer.current);
      // The latest command wins: a start while capture is still opening voids a queued stop/cancel.
      pending.current = null;
      if (starting.current || recorder.current) return;
      starting.current = true;
      let clip: Clip | null = null;
      try {
        clip = await openClip(deviceId, source);
        const opened = clip;
        const rec = new MediaRecorder(clip.stream, { mimeType: MIME, audioBitsPerSecond: BITRATE });
        const chunks: Blob[] = [];
        const t0 = performance.now();
        rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
        rec.onstop = async () => {
          const durationMs = performance.now() - t0;
          const bytes = new Uint8Array(await new Blob(chunks, { type: MIME }).arrayBuffer());
          api.sendAudio({ bytes, durationMs, mimeType: MIME, source: opened.source });
        };
        // Runs on stop and on cancel (onstop is nulled for cancel; listeners are not).
        rec.addEventListener('stop', () => {
          opened.dispose();
          setAnalyser(null);
        });
        rec.start(TIMESLICE_MS);
        recorder.current = rec;
        setAnalyser(opened.analyser);
      } catch (err) {
        console.error('capture failed', err);
        // Nothing is recording: free anything this attempt opened, and let a warm mic time out.
        clip?.dispose();
        scheduleMicRelease();
        api.sendError(source === 'system' ? 'System audio unavailable' : 'No microphone');
      } finally {
        starting.current = false;
      }
      // A stop/cancel that arrived while capture was still opening.
      if (pending.current) finish(pending.current);
    });

    const request = (mode: 'stop' | 'cancel') => {
      if (starting.current) pending.current = mode;
      else finish(mode);
    };
    api.onStop(() => request('stop'));
    api.onCancel(() => request('cancel'));
  }, []);

  return analyser;
}
