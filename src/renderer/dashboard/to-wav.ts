import { encodeWav } from '../../shared/wav';

const RATE = 16000; // what Whisper models expect

/** Decode a recorded clip (webm/opus) and resample it to 16 kHz mono WAV. */
export async function toWav(bytes: Uint8Array): Promise<Uint8Array> {
  const ctx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    // decodeAudioData detaches the buffer it gets, so give it a copy.
    decoded = await ctx.decodeAudioData(bytes.slice().buffer);
  } finally {
    void ctx.close();
  }
  const offline = new OfflineAudioContext(
    1,
    Math.max(1, Math.ceil(decoded.duration * RATE)),
    RATE,
  );
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return encodeWav(rendered.getChannelData(0), RATE);
}
