import { useEffect, useState } from 'react';
import type { OverlayState } from '../../shared/channels';
import type { TypeCan } from './TypePill';

export type Typing = { can: TypeCan | null; close(): void; draft: string; setDraft(s: string): void };

/**
 * The typing input main let open (can: which buttons work; null = the plain idle bar) and its draft.
 * Kept at the overlay's root so a drop or Save this swapping the pill out loses neither.
 */
export function useTyping(kind: OverlayState['kind']): Typing {
  const [can, setCan] = useState<TypeCan | null>(null);
  const [draft, setDraft] = useState('');
  useEffect(() => window.overlayApi.onTypeShown(setCan), []);
  useEffect(() => {
    if (kind !== 'idle') setCan(null);
  }, [kind]);
  return { can, close: () => setCan(null), draft, setDraft };
}
