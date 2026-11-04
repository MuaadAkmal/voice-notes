import { useEffect } from 'react';
import { isSilent, levelFromRms, rmsOf } from '../../shared/audio-level';

// The onboarding mic check: the pill is the only window allowed the mic, so it listens for a few
// seconds and reports the level (0..1) every 100 ms. Nothing is recorded or kept.

const TEST_MS = 3000;
const EVERY_MS = 100;

export function useMicTest(): void {
  useEffect(
    () =>
      window.overlayApi.onMicTest(async ({ deviceId }) => {
        const api = window.overlayApi;
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId } } : true });
        } catch {
          api.sendMicLevel({ level: 0, heard: false, done: true, error: true });
          return;
        }
        const ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        const started = performance.now();
        const timer = setInterval(() => {
          analyser.getFloatTimeDomainData(samples);
          const rms = rmsOf(samples);
          const done = performance.now() - started >= TEST_MS;
          api.sendMicLevel({ level: levelFromRms(rms), heard: !isSilent(rms), ...(done ? { done: true } : {}) });
          if (!done) return;
          clearInterval(timer);
          stream.getTracks().forEach((t) => t.stop());
          void ctx.close();
        }, EVERY_MS);
      }),
    [],
  );
}
