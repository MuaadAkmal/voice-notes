import { useEffect, useRef, useState } from 'react';

const MIME = 'audio/webm;codecs=opus';
const BITRATE = 32_000;
const TIMESLICE_MS = 250;
const MIC_WARM_MS = 30_000;

type Pending = 'stop' | 'cancel' | null;

/**
 * Captures the mic on main's start/stop/cancel commands and ships the clip back.
 * The stream stays warm for MIC_WARM_MS after a clip so back-to-back phrases start instantly.
 */
export function useRecorder(): AnalyserNode | null {
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const stream = useRef<{ media: MediaStream; deviceId: string | null; ctx: AudioContext } | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const starting = useRef(false);
  const pending = useRef<Pending>(null);
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const api = window.overlayApi;

    const release = () => {
      stream.current?.media.getTracks().forEach((t) => t.stop());
      stream.current?.ctx.close();
      stream.current = null;
      setAnalyser(null);
    };

    const scheduleRelease = () => {
      if (releaseTimer.current) clearTimeout(releaseTimer.current);
      releaseTimer.current = setTimeout(release, MIC_WARM_MS);
    };

    const getStream = async (deviceId: string | null) => {
      const live = stream.current?.media.getAudioTracks().some((t) => t.readyState === 'live');
      if (stream.current && live && stream.current.deviceId === deviceId) return stream.current.media;
      release();
      const media = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: deviceId ? { exact: deviceId } : undefined, channelCount: 1 },
      });
      const ctx = new AudioContext();
      const node = ctx.createAnalyser();
      node.fftSize = 64;
      ctx.createMediaStreamSource(media).connect(node);
      stream.current = { media, deviceId, ctx };
      setAnalyser(node);
      return media;
    };

    const finish = (mode: 'stop' | 'cancel') => {
      const rec = recorder.current;
      recorder.current = null;
      if (!rec || rec.state === 'inactive') return;
      if (mode === 'cancel') rec.onstop = null;
      rec.stop();
      scheduleRelease();
    };

    api.onStart(async ({ deviceId }) => {
      if (releaseTimer.current) clearTimeout(releaseTimer.current);
      if (starting.current || recorder.current) return;
      starting.current = true;
      pending.current = null;
      try {
        const media = await getStream(deviceId);
        const rec = new MediaRecorder(media, { mimeType: MIME, audioBitsPerSecond: BITRATE });
        const chunks: Blob[] = [];
        const t0 = performance.now();
        rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
        rec.onstop = async () => {
          const durationMs = performance.now() - t0;
          const bytes = new Uint8Array(await new Blob(chunks, { type: MIME }).arrayBuffer());
          api.sendAudio({ bytes, durationMs, mimeType: MIME });
        };
        rec.start(TIMESLICE_MS);
        recorder.current = rec;
      } catch (err) {
        console.error('mic capture failed', err);
        api.sendError('No microphone');
      } finally {
        starting.current = false;
      }
      // A stop/cancel that arrived while the mic was still opening.
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
