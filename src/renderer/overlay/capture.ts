/** Windows loopback ("what you hear") via main's display-media handler; the video track is dropped at once. */
export async function openSystemAudio(): Promise<MediaStream> {
  const display = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
  display.getVideoTracks().forEach((t) => t.stop());
  const audio = display.getAudioTracks();
  if (audio.length === 0) throw new Error('no loopback audio track');
  return new MediaStream(audio);
}
