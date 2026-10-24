import { toast } from 'sonner';
import { Toaster } from '@/components/ui/sonner';

const TOAST_MS = 4000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Toaster position="bottom-center" duration={TOAST_MS} />
    </>
  );
}

/** Same signature as before the Sonner switch, so call sites are unchanged. */
export const useToast = () => (message: string) => {
  toast(message);
};
