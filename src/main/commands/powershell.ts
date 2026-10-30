import { spawn as nodeSpawn } from 'node:child_process';

// Runs one fixed PowerShell script and reads the JSON line it prints. Values (window handle, process
// id, title) go in through environment variables only, never into the script text. Anything wrong
// (no PowerShell, an error, odd output, slower than the timeout) gives null.

type ChildLike = {
  stdout: NodeJS.ReadableStream | null;
  on(event: 'close' | 'error', fn: (arg: unknown) => void): unknown;
  kill(): unknown;
};

export type Spawn = (exe: string, args: string[], opts: { env: NodeJS.ProcessEnv; windowsHide: true }) => ChildLike;

export type RunPowerShell = (script: string, env: Record<string, string>) => Promise<unknown | null>;

// Windows PowerShell writes redirected output in the OEM code page; titles and paths need UTF-8.
const PRELUDE = '[Console]::OutputEncoding = [Text.Encoding]::UTF8\n$ErrorActionPreference = "Stop"\n';

export function runPowerShell(
  script: string,
  env: Record<string, string>,
  spawn: Spawn = nodeSpawn as unknown as Spawn,
  timeoutMs = 3000,
): Promise<unknown | null> {
  return new Promise((resolve) => {
    let child: ChildLike;
    try {
      const encoded = Buffer.from(PRELUDE + script, 'utf16le').toString('base64');
      child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
        env: { ...process.env, ...env },
        windowsHide: true,
      });
    } catch {
      resolve(null);
      return;
    }
    let out = '';
    let done = false;
    const finish = (value: unknown | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // already gone
      }
      finish(null);
    }, timeoutMs);
    child.stdout?.on('data', (chunk: Buffer | string) => (out += chunk.toString()));
    child.on('error', () => finish(null));
    child.on('close', (code) => {
      if (code !== 0) return finish(null);
      const last = out.trim().split(/\r?\n/).at(-1) ?? '';
      try {
        finish(JSON.parse(last));
      } catch {
        finish(null);
      }
    });
  });
}
