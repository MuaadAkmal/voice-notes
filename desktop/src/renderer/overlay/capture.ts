/** Windows loopback ("what you hear") via main's display-media handler; the video track is dropped at once. */
export async function openSystemAudio(): Promise<MediaStream> {
  const display = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
  display.getVideoTracks().forEach((t) => t.stop());
  const audio = display.getAudioTracks();
  if (audio.length === 0) throw new Error('no loopback audio track');
  return new MediaStream(audio);
}

let opening: Promise<unknown> = Promise.resolve();

/**
 * Marks the clip being opened right now. Opening loopback capture at the same moment slows the mic
 * down enough to lose the first words, so the auto-pause probe waits for this first.
 */
export function trackOpening<T>(p: Promise<T>): Promise<T> {
  opening = p.catch(() => undefined);
  return p;
}

export const clipOpened = (): Promise<unknown> => opening;
