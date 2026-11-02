import { app } from 'electron';

/** Test hook: where the app would have restarted into (a profile's user id, or null for the sign-in screen). */
export const relaunches: (string | null)[] = [];

/**
 * Restarts into whatever the stored session now says: another profile, or the sign-in screen. Quits (not exits)
 * so will-quit still closes the database and stops whisper-server. Never hidden: someone just signed in or out.
 */
export function relaunch(target: string | null): void {
  if (process.env.VOICE_NOTES_TEST === '1') {
    relaunches.push(target);
    return;
  }
  app.relaunch({ args: process.argv.slice(1).filter((a) => a !== '--hidden') });
  app.quit();
}
