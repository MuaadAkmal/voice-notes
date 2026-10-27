import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

// The Edge Function bundles copies of the shared sync code; they must never drift from the app's.
const ROOT = path.resolve('.');
const OUT = path.join(ROOT, 'supabase/functions/sync/_shared');
const SOURCES = [
  'sync-ops.ts',
  'learn-log.ts',
  'task-lines.ts',
  'folders.ts',
  'channels.ts',
  'transcription.ts',
  'page-images.ts',
  'sync/protocol.ts',
  'sync/server-core.ts',
  'sync/pg-store.ts',
  'sync/handler.ts',
  'sync/postgres-db.ts',
  'sync/file-rules.ts',
  'sync/file-bucket.ts',
];
const stripExt = (code: string) => code.replace(/(from\s+['"]\.{1,2}\/[^'"]+)\.ts(['"])/g, '$1$2');

it('the function carries exact copies of the shared sync code', () => {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/sync-function-files.mjs')], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  for (const f of SOURCES) {
    const source = fs.readFileSync(path.join(ROOT, 'src/shared', f), 'utf8');
    const copy = fs.readFileSync(path.join(OUT, f), 'utf8');
    expect(stripExt(copy), f).toBe(source);
    // Deno needs explicit extensions on relative imports.
    for (const m of copy.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g)) expect(m[1], `${f}: ${m[1]}`).toMatch(/\.ts$/);
  }
});
