import { useEffect } from 'react';
import { Loader2, UserRound } from 'lucide-react';
import { cleanIpcError } from '../../shared/format';
import { cn } from '@/lib/utils';
import { Avatar } from './Avatar';
import { useToast } from './Toast';
import { firstName, useAccount } from './useAccount';

const api = window.dashboardApi;
const row = 'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm';

/** Bottom of the sidebar: Sign in, the wait for the browser, or who is signed in (opens the Account page). */
export function AccountChip({ active, onOpen }: { active: boolean; onOpen: () => void }) {
  const toast = useToast();
  const info = useAccount();
  // Once per account change (each is a new object), not per render: useToast's function is new every render.
  useEffect(() => {
    if (info?.state === 'signed-out' && info.error) toast(info.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info]);

  if (!info) return null;

  if (info.state === 'signing-in') {
    return (
      <div className={cn(row, 'text-muted-foreground')}>
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
        <span className="flex-1 truncate">Waiting for browser…</span>
        <button type="button" className="text-xs underline-offset-2 hover:text-foreground hover:underline" onClick={() => api.cancelSignIn()}>
          Cancel
        </button>
      </div>
    );
  }

  if (info.state === 'signed-out') {
    return (
      <button
        type="button"
        className={cn(row, 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground')}
        onClick={() => api.signIn().catch((e) => toast(cleanIpcError(e)))}
      >
        <UserRound className="h-4 w-4 shrink-0" strokeWidth={1.8} />
        Sign in
      </button>
    );
  }

  return (
    <button
      type="button"
      aria-label={`Account: ${info.name}`}
      className={cn(row, active ? 'bg-sidebar-accent text-foreground' : 'hover:bg-sidebar-accent')}
      onClick={onOpen}
    >
      <Avatar name={info.name} src={info.avatar} className="h-5 w-5 text-[9px]" />
      <span className="truncate">{firstName(info.name)}</span>
    </button>
  );
}
