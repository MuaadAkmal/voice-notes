import type { OverlayState } from '../shared/channels';

/**
 * The typing input opens only on the resting pill: never over a recording, a dictation, a flash, a
 * notice, Add title or the Move to… picker, and not twice.
 */
export function canOpenTyping(s: { typing: boolean; picking: boolean; pill: OverlayState['kind']; recorder: string; dictating: boolean }): boolean {
  return !s.typing && !s.picking && s.pill === 'idle' && s.recorder === 'idle' && !s.dictating;
}
