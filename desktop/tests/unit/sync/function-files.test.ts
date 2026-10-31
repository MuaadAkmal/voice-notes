import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

// The Edge Functions bundle copies of the shared code; they must never drift from the app's.
const ROOT = path.resolve('.');
const FUNCTIONS: Record<string, string[]> = {
  sync: [
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
  ],
  connectors: [
    'connectors/store.ts',
    'connectors/crypto.ts',
    'connectors/pg-store.ts',
    'connectors/protocol.ts',
    'connectors/google-oauth.ts',
    'connectors/core.ts',
    'connectors/handler.ts',
  ],
  commands: [
    'commands/protocol.ts',
    'commands/store.ts',
    'commands/pg-store.ts',
    'commands/groq.ts',
    'commands/core.ts',
    'commands/handler.ts',
  ],
  asr: [
    'asr/protocol.ts',
    'asr/wav-info.ts',
    'asr/store.ts',
    'asr/pg-store.ts',
    'asr/core.ts',
    'asr/elevenlabs.ts',
    'asr/handler.ts',
  ],
};
const stripExt = (code: string) => code.replace(/(from\s+['"]\.{1,2}\/[^'"]+)\.ts(['"])/g, '$1$2');

it('the functions carry exact copies of the shared code', () => {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/sync-function-files.mjs')], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  for (const [name, files] of Object.entries(FUNCTIONS)) {
    const out = path.join(ROOT, '../supabase/functions', name, '_shared');
    for (const f of files) {
      const source = fs.readFileSync(path.join(ROOT, 'src/shared', f), 'utf8');
      const copy = fs.readFileSync(path.join(out, f), 'utf8');
      expect(stripExt(copy), `${name}: ${f}`).toBe(source);
      // Deno needs explicit extensions on relative imports.
      for (const m of copy.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g)) expect(m[1], `${f}: ${m[1]}`).toMatch(/\.ts$/);
    }
  }
});
