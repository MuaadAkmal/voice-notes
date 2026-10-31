import { useEffect } from 'react';
import { anyAudible } from '../../shared/audio-level';
import { RingBuffer } from '../../shared/ring-buffer';
import { clipOpened, openSystemAudio } from './capture';
import { encodeWebmOpus } from './encode';
import { afterPing } from './ping-gate';
import workletUrl from './ring-worklet.js?url';

const SAMPLE_RATE = 48_000; // Opus's native rate; Chromium resamples the loopback to it
const MAX_SECONDS = 60; // the longest rewind setting: ~11 MB of float samples
const MIME = 'audio/webm;codecs=opus';
const PROBE_MS = 300;
const WINDOW = SAMPLE_RATE / 20; // 50 ms loudness windows

type Film = { stream: MediaStream; ctx: AudioContext; ring: RingBuffer };

/**
 * Film mode: while main says it's on, keep the last MAX_SECONDS of system audio in memory so
 * "save the last N seconds" works after the line was spoken. Also answers "is anything playing?"
 * for auto-pause.
 */
export function useFilmBuffer(): void {
  useEffect(() => {
    const api = window.overlayApi;
    let film: Film | null = null;
    // Mode changes run one after another, so a quick on→off→on can't leave two streams open.
    let queue = Promise.resolve();

    const close = () => {
      film?.stream.getTracks().forEach((t) => t.stop());
      film?.ctx.close();
      film = null;
    };

    const open = async () => {
      const stream = await openSystemAudio();
      const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
      try {
        await ctx.resume();
        await ctx.audioWorklet.addModule(workletUrl);
        const ring = new RingBuffer(SAMPLE_RATE * MAX_SECONDS);
        const tap = new AudioWorkletNode(ctx, 'ring-tap');
        tap.port.onmessage = (e: MessageEvent<Float32Array>) => ring.push(e.data);
        // The graph must reach the destination to be pulled; a zero gain keeps it silent.
        const mute = ctx.createGain();
        mute.gain.value = 0;
        ctx.createMediaStreamSource(stream).connect(tap).connect(mute).connect(ctx.destination);
        const current: Film = { stream, ctx, ring };
        stream.getAudioTracks()[0]?.addEventListener('ended', () => {
          if (film !== current) return;
          close();
          api.sendFilmError('Film mode stopped');
        });
        film = current;
      } catch (err) {
        stream.getTracks().forEach((t) => t.stop());
        ctx.close();
        throw err;
      }
    };

    api.onFilmMode(({ on }) => {
      queue = queue.then(async () => {
        if (!on) return close();
        if (film) return;
        await open().catch((err) => {
          console.error('film mode: capture failed', err);
          api.sendFilmError('System audio unavailable');
        });
      });
    });

    api.onFilmSave(async ({ seconds }) => {
      if (!film || film.ring.size === 0) {
        api.sendRewindError(film ? 'Nothing to rewind yet' : 'Film mode is off');
        return;
      }
      try {
        const samples = film.ring.latest(seconds * SAMPLE_RATE);
        const bytes = await encodeWebmOpus(samples, SAMPLE_RATE);
        api.sendRewindAudio({ bytes, durationMs: (samples.length / SAMPLE_RATE) * 1000, mimeType: MIME, source: 'system' });
      } catch (err) {
        console.error('rewind encode failed', err);
        api.sendRewindError('Rewind failed');
      }
    });

    /** Is sound coming out of the speakers? From the live buffer if film mode is on, else a short loopback sample. */
    const probe = async (): Promise<boolean> => {
      // The dictation start ping would read as playing media: let it finish (and leave the film's look-back window).
      await afterPing(film ? PROBE_MS : 0);
      if (film) return anyAudible(film.ring.latest((SAMPLE_RATE * PROBE_MS) / 1000), WINDOW);
      await clipOpened(); // never compete with the mic that's starting this very note
      const stream = await openSystemAudio();
      const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
      try {
        await ctx.resume();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048; // ≈43 ms per look
        ctx.createMediaStreamSource(stream).connect(analyser);
        const buf = new Float32Array(analyser.fftSize);
        for (let t = 0; t < PROBE_MS; t += 50) {
          await new Promise((r) => setTimeout(r, 50));
          analyser.getFloatTimeDomainData(buf);
          if (anyAudible(buf, buf.length)) return true;
        }
        return false;
      } finally {
        stream.getTracks().forEach((t) => t.stop());
        ctx.close();
      }
    };

    api.onProbe(({ id }) => {
      probe()
        .catch(() => false)
        .then((playing) => api.sendProbeResult(id, playing));
    });
  }, []);
}
