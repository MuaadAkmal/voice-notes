import path from 'node:path';

/** Squirrel's stable launcher, one folder above the versioned app-x.y.z folder of an installed copy. */
export function updateExePath(execPath: string): string {
  return path.win32.join(path.win32.dirname(execPath), '..', 'Update.exe');
}

/**
 * The Windows login item. An installed copy starts through Update.exe, which always runs the newest
 * version: the exe's own path is in a versioned folder that an update leaves behind.
 */
export function loginItem(execPath: string, installed: boolean, hiddenArg: string): { path?: string; args: string[] } {
  if (!installed) return { args: [hiddenArg] };
  return {
    path: updateExePath(execPath),
    args: ['--processStart', `"${path.win32.basename(execPath)}"`, '--process-start-args', `"${hiddenArg}"`],
  };
}
