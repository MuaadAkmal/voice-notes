import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { cleanIpcError } from '../../shared/format';
import { Button } from '@/components/ui/button';
import { Logo } from './Logo';
import { useAccount } from './useAccount';

const api = window.dashboardApi;

/** Signed out, the whole window is this: signing in restarts the app into that account's notes. */
export function SignInScreen() {
  const info = useAccount();
  const [error, setError] = useState<string | null>(null);
  const waiting = info?.state === 'signing-in';
  const shown = error ?? (info?.state === 'signed-out' ? info.error : undefined);

  const signIn = () => {
    setError(null);
    api.signIn().catch((e) => setError(cleanIpcError(e)));
  };

  return (
    <div className="flex h-screen flex-col bg-background text-foreground antialiased">
      {/* Draggable strip replacing the native title bar; caption buttons are drawn over its right end. */}
      <div className="app-drag h-10 shrink-0" />
      <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 pb-10 text-center">
        <div className="flex items-center gap-2">
          <Logo className="h-6 w-auto" />
          <span className="font-display text-xl font-semibold tracking-tight">Voice Notes</span>
        </div>
        <div className="max-w-sm">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in to Voice Notes</h1>
          <p className="mt-2 text-sm text-muted-foreground">Your notes, pages and recordings sync to your Google account.</p>
        </div>
        {waiting ? (
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Waiting for browser…
            <Button variant="ghost" size="sm" onClick={() => api.cancelSignIn()}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button onClick={signIn} disabled={!info}>
            Sign in with Google
          </Button>
        )}
        {shown && !waiting && <p className="text-sm text-destructive">{shown}</p>}
      </main>
    </div>
  );
}
