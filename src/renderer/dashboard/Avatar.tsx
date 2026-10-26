import { cn } from '@/lib/utils';
import { initials } from './useAccount';

/** The Google photo (a data: URL from main), or the name's initials on a tinted circle. */
export function Avatar({ name, src, className }: { name: string; src: string | null; className?: string }) {
  return src ? (
    <img src={src} alt="" className={cn('shrink-0 rounded-full object-cover', className)} />
  ) : (
    <span
      aria-hidden
      className={cn('grid shrink-0 place-items-center rounded-full bg-primary/10 font-medium text-primary', className)}
    >
      {initials(name)}
    </span>
  );
}
