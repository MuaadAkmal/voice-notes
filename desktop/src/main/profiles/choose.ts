import fs from 'node:fs';
import { profileDir, UNCLAIMED } from './paths';

export type Start = { mode: 'signin' } | { mode: 'profile'; userId: string; dir: string };

/** Signed out: only the sign-in screen. Signed in: that account's profile, adopting an unclaimed library if it has none. */
export function chooseStart(root: string, userId: string | null): Start {
  if (!userId) return { mode: 'signin' };
  const dir = profileDir(root, userId);
  const unclaimed = profileDir(root, UNCLAIMED);
  if (fs.existsSync(unclaimed) && !fs.existsSync(dir)) fs.renameSync(unclaimed, dir);
  fs.mkdirSync(dir, { recursive: true });
  return { mode: 'profile', userId, dir };
}
