import fs from 'node:fs';
import { threadsFor } from './catalog';

export type ChildLike = {
  pid?: number;
  kill(): void;
  on(ev: 'exit', cb: (code: number | null) => void): void;
  stderr?: { on(ev: 'data', cb: (b: Buffer) => void): void } | null;
};

export type EngineServerDeps = {
  spawn: (exe: string, args: string[]) => ChildLike;
  freePort: () => Promise<number>;
  /** Body of a GET; rejects when nothing answers. */
  get: (url: string) => Promise<string>;
  cores: number;
  pidFile: string;
  isWhisperPid: (pid: number) => boolean;
  killPid: (pid: number) => void;
  idleMs?: number;
  readyTimeoutMs?: number;
  pollMs?: number;
  log?: (...a: unknown[]) => void;
};

const FAILED = 'Built-in engine failed to start';
// Another program can share a port on Windows, so readiness means "whisper.cpp answered", not "something answered".
const IDENTITY = 'Whisper.cpp Server';

/**
 * whisper-server.exe on 127.0.0.1: started by the first job, shared by concurrent ones,
 * unloaded once idle. Jobs bracket their request with ensure() and release().
 */
export class EngineServer {
  private child: ChildLike | null = null;
  private model: string | null = null;
  private port = 0;
  private starting: Promise<string> | null = null;
  private busy = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly idleMs: number;
  private readonly readyTimeoutMs: number;
  private readonly pollMs: number;
  private readonly log: (...a: unknown[]) => void;

  constructor(private readonly d: EngineServerDeps) {
    this.idleMs = d.idleMs ?? 300_000;
    this.readyTimeoutMs = d.readyTimeoutMs ?? 60_000;
    this.pollMs = d.pollMs ?? 200;
    this.log = d.log ?? (() => undefined);
  }

  running(): boolean {
    return this.child !== null && this.starting === null;
  }

  /** Model file of the running (or starting) engine. */
  loaded(): string | null {
    return this.child ? this.model : null;
  }

  /** A job is holding the engine with this model. */
  inUse(model: string): boolean {
    return this.busy > 0 && this.loaded() === model;
  }

  /** Base URL of the running engine for `model`, starting (or restarting) it as needed. Marks a job busy until release(). */
  async ensure(exe: string, model: string): Promise<string> {
    this.busy++;
    this.clearIdle();
    try {
      return await this.start(exe, model);
    } catch (e) {
      this.release();
      throw e;
    }
  }

  release(): void {
    this.busy = Math.max(0, this.busy - 1);
    if (this.busy === 0 && this.child) {
      this.clearIdle();
      this.idleTimer = setTimeout(() => this.kill('idle'), this.idleMs);
    }
  }

  /** Load the model ahead of a job (dictation starts listening); it idles out if no job follows. */
  prewarm(exe: string, model: string): void {
    this.ensure(exe, model).then(
      () => this.release(),
      (e) => this.log('[local-whisper] prewarm failed', e instanceof Error ? e.message : e),
    );
  }

  stop(): void {
    this.clearIdle();
    this.kill('quit');
  }

  /** An engine from a run that crashed is still holding its RAM: kill it, but only if the pid is still whisper-server. */
  killOrphan(): void {
    let pid: number;
    try {
      pid = Number.parseInt(fs.readFileSync(this.d.pidFile, 'utf8'), 10);
    } catch {
      return;
    }
    try {
      if (Number.isInteger(pid) && pid > 0 && this.d.isWhisperPid(pid)) {
        this.d.killPid(pid);
        this.log('[local-whisper] killed orphan', pid);
      }
    } catch (e) {
      this.log('[local-whisper] orphan check failed', e);
    }
    fs.rmSync(this.d.pidFile, { force: true });
  }

  private url(): string {
    return `http://127.0.0.1:${this.port}/v1`;
  }

  private start(exe: string, model: string): Promise<string> {
    if (this.starting && this.model === model) return this.starting;
    if (this.child && !this.starting && this.model === model) return Promise.resolve(this.url());
    if (this.child) this.kill('model switch');
    this.model = model;
    const starting = this.spawnAndWait(exe, model).finally(() => {
      if (this.starting === starting) this.starting = null;
    });
    this.starting = starting;
    return starting;
  }

  private async spawnAndWait(exe: string, model: string): Promise<string> {
    const port = await this.d.freePort();
    const args = [
      '-m', model,
      '--host', '127.0.0.1',
      '--port', String(port),
      '-t', String(threadsFor(this.d.cores)),
      '-l', 'auto',
      '--inference-path', '/v1/audio/transcriptions',
    ];
    const started = Date.now();
    const child = this.d.spawn(exe, args);
    this.child = child;
    this.port = port;
    let exited = false;
    let onExit: () => void = () => undefined;
    const exitedP = new Promise<string>((r) => (onExit = () => r('')));
    let lastErr = '';
    child.stderr?.on('data', (b) => {
      const line = b.toString().trim().split(/\r?\n/).pop();
      if (line) lastErr = line;
    });
    child.on('exit', (code) => {
      exited = true;
      onExit();
      if (this.child !== child) return; // already replaced or killed on purpose
      this.log('[local-whisper] engine exited', code, lastErr);
      this.child = null;
      this.clearIdle();
      fs.rmSync(this.d.pidFile, { force: true });
    });
    if (child.pid) fs.writeFileSync(this.d.pidFile, String(child.pid));

    while (Date.now() - started < this.readyTimeoutMs) {
      if (exited || this.child !== child) break;
      // A request that never answers must not outlive the engine or the deadline.
      const left = this.readyTimeoutMs - (Date.now() - started);
      let deadline: ReturnType<typeof setTimeout> | undefined;
      const body = await Promise.race([
        this.d.get(`http://127.0.0.1:${port}/`).catch(() => ''),
        exitedP,
        new Promise<string>((r) => (deadline = setTimeout(() => r(''), left))),
      ]);
      clearTimeout(deadline);
      if (exited || this.child !== child) break;
      if (body.includes(IDENTITY)) {
        this.log('[local-whisper] ready in', Date.now() - started, 'ms');
        return this.url();
      }
      await new Promise((r) => setTimeout(r, this.pollMs));
    }
    this.log('[local-whisper] start failed', lastErr);
    if (this.child === child) this.kill('start failed');
    throw new Error(FAILED);
  }

  private kill(reason: string): void {
    const child = this.child;
    if (!child) return;
    this.child = null;
    this.log('[local-whisper] stopping engine:', reason);
    try {
      child.kill();
    } catch {
      // already gone
    }
    fs.rmSync(this.d.pidFile, { force: true });
  }

  private clearIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }
}
