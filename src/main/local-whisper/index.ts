import { execFileSync, spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import type { LocalStatus } from '../../shared/channels';
import type { ModelId } from '../../shared/transcription';
import { recommendedModel } from './catalog';
import { type Catalog, Installer } from './installer';
import { type ChildLike, EngineServer } from './server';

type Server = Pick<EngineServer, 'ensure' | 'release' | 'prewarm' | 'stop' | 'killOrphan' | 'inUse' | 'loaded'>;

export type LocalWhisperDeps = {
  root: string; // %APPDATA%/Voice Notes/whisper
  arch: string;
  cores: number;
  totalMem: number;
  fetch: typeof fetch; // downloads
  onChange: () => void;
  log?: (...a: unknown[]) => void;
  server?: Server; // tests
};

const MISSING = 'Built-in model missing — download it again';

/** The built-in provider: what's installed, downloads, and the engine process, behind one object. */
export class LocalWhisper {
  private readonly installer: Installer;
  private readonly server: Server;
  /** e2e: run this Node script instead of whisper-server.exe. */
  private fakeScript: string | null = null;

  constructor(private readonly d: LocalWhisperDeps) {
    this.installer = new Installer({ root: d.root, arch: d.arch, fetch: d.fetch, onChange: d.onChange });
    this.server =
      d.server ??
      new EngineServer({
        spawn: (exe, args) => this.spawn(exe, args),
        freePort,
        get: async (url) => (await fetch(url, { signal: AbortSignal.timeout(2000) })).text(),
        cores: d.cores,
        pidFile: path.join(d.root, 'server.pid'),
        isWhisperPid,
        killPid: (pid) => process.kill(pid),
        log: d.log,
      });
  }

  status(): LocalStatus {
    const { engine, models } = this.installer.installed();
    return {
      available: this.installer.available(),
      engine,
      models,
      recommended: recommendedModel(this.d.totalMem, this.d.cores),
      diskBytes: this.installer.diskBytes(),
      job: this.installer.job(),
    };
  }

  install(id: ModelId): Promise<void> {
    return this.installer.install(id);
  }

  cancel(): void {
    this.installer.cancel();
  }

  remove(id: ModelId, engineToo = false): void {
    const model = this.installer.modelPath(id);
    if (model && this.server.inUse(model)) throw new Error('That model is in use — try again in a moment');
    // The engine keeps its model open: unload it before the file goes.
    if ((model && this.server.loaded() === model) || engineToo) this.server.stop();
    this.installer.remove(id, engineToo);
  }

  async ensure(id: ModelId): Promise<string> {
    const { exe, model } = this.paths(id);
    return this.server.ensure(exe, model);
  }

  release(): void {
    this.server.release();
  }

  prewarm(id: ModelId): void {
    try {
      const { exe, model } = this.paths(id);
      this.server.prewarm(exe, model);
    } catch {
      // not downloaded: the job itself will say so
    }
  }

  stop(): void {
    this.server.stop();
  }

  /** At start-up: half-finished downloads and an engine left running by a crash. */
  boot(): void {
    this.installer.cleanup();
    this.server.killOrphan();
  }

  setTestOverrides(o: { catalog?: Catalog; spawn?: { script: string } }): void {
    if (o.catalog) this.installer.setCatalog(o.catalog);
    if (o.spawn) this.fakeScript = o.spawn.script;
  }

  private paths(id: ModelId): { exe: string; model: string } {
    const exe = this.installer.enginePath();
    const model = this.installer.modelPath(id);
    if (!exe || !model) throw new Error(MISSING);
    return { exe, model };
  }

  private spawn(exe: string, args: string[]): ChildLike {
    const opts = { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] as ('ignore' | 'pipe')[] };
    if (this.fakeScript) {
      return spawn(process.execPath, [this.fakeScript, ...args], {
        ...opts,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      });
    }
    return spawn(exe, args, opts);
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      srv.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject(new Error('No port'))));
    });
  });
}

function isWhisperPid(pid: number): boolean {
  const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { windowsHide: true }).toString();
  return out.toLowerCase().includes('whisper-server.exe');
}
