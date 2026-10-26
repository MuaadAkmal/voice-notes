const FREQ = 880;
const DURATION_S = 0.12;
const PEAK = 0.15;

/** A short soft tone: dictation is listening. Its own context, closed when the tone ends. */
export function playPing(): void {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = FREQ;
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(PEAK, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + DURATION_S);
    osc.connect(gain).connect(ctx.destination);
    osc.onended = () => void ctx.close();
    osc.start(t);
    osc.stop(t + DURATION_S);
  } catch (err) {
    console.warn('ping failed', err); // never block the recording over a sound
  }
}
