/**
 * Whether an open page should show a body that arrived from another PC. Never while you're working
 * in it (focused or unsaved): your text stays, and its next save goes through the server's
 * keep-both rule instead.
 */
export function shouldTakeRemoteBody(s: { dirty: boolean; focused: boolean; localBody: string; remoteBody: string }): boolean {
  return !s.dirty && !s.focused && s.localBody !== s.remoteBody;
}
