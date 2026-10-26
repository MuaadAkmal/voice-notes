import { useEffect, useState } from 'react';
import type { AccountInfo } from '../../shared/channels';

const api = window.dashboardApi;

/** Who is signed in, kept current by main's account:changed. */
export function useAccount(): AccountInfo | null {
  const [info, setInfo] = useState<AccountInfo | null>(null);
  useEffect(() => {
    api.getAccount().then(setInfo);
    return api.onAccountChanged(setInfo);
  }, []);
  return info;
}

/** "Muaad Akmal" → "MA"; one word → its first letter. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}
