import path from 'node:path';

/** A library from before profiles that no account owned yet: the first account to sign in gets it. */
export const UNCLAIMED = '_unclaimed';

export function profilesDir(root: string): string {
  return path.join(root, 'profiles');
}

/** One account's data: its database, recordings, images and synced settings. */
export function profileDir(root: string, id: string): string {
  return path.join(profilesDir(root), id);
}
