import { useEffect } from 'react';
import { cleanIpcError } from '../../shared/format';
import { Button } from '@/components/ui/button';
import { Avatar } from './Avatar';
import { useConfirm } from './ConfirmDialog';
import { SyncCard } from './SyncCard';
import { useToast } from './Toast';
import { useAccount } from './useAccount';

const api = window.dashboardApi;

/** Who is signed in, and Sign out. Leaves (to Home) once signed out. */
export function AccountPage({ onSignedOut }: { onSignedOut: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const info = useAccount();

  useEffect(() => {
    if (info && info.state !== 'signed-in') onSignedOut();
  }, [info, onSignedOut]);

  if (info?.state !== 'signed-in') return null;

  const signOut = async () => {
    if (!(await confirm({ title: 'Sign out? Your notes stay on this PC.', confirmLabel: 'Sign out' }))) return;
    api.signOut().catch((e) => toast(cleanIpcError(e)));
  };

  return (
    <div className="mx-auto max-w-3xl px-10 py-9">
      <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
      <div className="mt-8 flex items-center gap-4 rounded-2xl border bg-card p-5">
        <Avatar name={info.name} src={info.avatar} className="h-14 w-14 text-lg" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-medium">{info.name}</div>
          <div className="truncate text-sm text-muted-foreground">{info.email}</div>
          <div className="mt-1 text-xs text-muted-foreground">Signed in with Google</div>
        </div>
        <Button variant="outline" size="sm" onClick={signOut}>
          Sign out
        </Button>
      </div>
      <SyncCard />
    </div>
  );
}
