import { AudioBufferSource, BufferTarget, Output, Quality, WebMOutputFormat } from 'mediabunny';

const BITRATE = 32_000; // same as MediaRecorder notes

/** Mono PCM → Opus in WebM, via WebCodecs. 15 s encodes in well under a second. */
export async function encodeWebmOpus(samples: Float32Array, sampleRate: number): Promise<Uint8Array> {
  const output = new Output({ format: new WebMOutputFormat(), target: new BufferTarget() });
  const source = new AudioBufferSource({ codec: 'opus', quality: new Quality({ bitrate: BITRATE }) });
  output.addAudioTrack(source);
  await output.start();
  const buffer = new AudioBuffer({ length: samples.length, numberOfChannels: 1, sampleRate });
  buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
  await source.add(buffer);
  await output.finalize();
  return new Uint8Array(output.target.buffer!);
}
