import { describe, expect, it } from 'vitest';
import type { FolderRow, NoteRow, PageRow, SyncOp } from '../../../src/shared/sync-ops';
import type { TestServer } from './reference-server';

let seq = 0;
const m = (op: SyncOp, baseVersion = 0) => ({ id: `m${++seq}`, op, baseVersion });
const A = { clientId: 'A', deviceName: 'PC-A' };
const B = { clientId: 'B', deviceName: 'PC-B' };
const OTHER = '22222222-2222-4222-8222-222222222222';
const page = (id: string, body = ''): PageRow => ({ id, title: 'Notes', body, folderId: null, starred: false, createdAt: 1, updatedAt: 1 });
const folder = (id: string, name: string, parentId: string | null = null): FolderRow => ({ id, name, parentId, createdAt: 1, updatedAt: 1 });
const note = (id: string, folderId: string | null = null): NoteRow => ({
  id,
  title: 'n',
  durationMs: 1,
  sizeBytes: 1,
  mimeType: 'audio/webm',
  createdAt: 1,
  updatedAt: 1,
  folderId,
  source: 'mic',
  kind: 'note',
  windowTitle: null,
  show: null,
  starred: false,
  transcript: null,
  transcriptLang: null,
  transcribedAt: null,
});


/** The server rules, as tests any store must pass (memory here, Postgres in pg-store.test.ts). */
export function runContract(label: string, make: () => Promise<TestServer>, timeout = 5000): void {
  describe(label, { timeout }, () => {
    it('every change gets the next version, and pull pages through them in order', async () => {
      const s = await make();
      const res = await s.push({ ...A, mutations: [m({ op: 'page.create', id: 'p', row: page('p') }), m({ op: 'page.setBody', id: 'p', body: 'x' })] });
      expect(res.acked.map((a) => a.version)).toEqual([1, 2]);
      for (let i = 0; i < 600; i++) await s.push({ ...A, mutations: [m({ op: 'folder.create', id: `f${i}`, row: folder(`f${i}`, `F${i}`) })] });
      const first = await s.pull({ clientId: 'B', cursor: 0 });
      expect(first.rows).toHaveLength(500);
      expect(first.hasMore).toBe(true);
      const second = await s.pull({ clientId: 'B', cursor: first.cursor });
      expect(second.hasMore).toBe(false);
      expect(new Set([...first.rows, ...second.rows].map((r) => r.id)).size).toBe(601);
    });

    it('a change pushed twice is applied once', async () => {
      const s = await make();
      await s.push({ ...A, mutations: [m({ op: 'page.create', id: 'p', row: page('p') })] });
      const append = m({ op: 'page.append', id: 'p', text: 'milk', day: '2026-10-26' });
      const once = await s.push({ ...A, mutations: [append] });
      const again = await s.push({ ...A, mutations: [append] });
      expect(again.acked).toEqual(once.acked);
      expect((await s.row('page', 'p'))!.data!.body.match(/milk/g)).toHaveLength(1);
    });

    it('two body edits on the same version: the newer wins, the other is kept as a conflict copy', async () => {
      const s = await make();
      const [created] = (await s.push({ ...A, mutations: [m({ op: 'page.create', id: 'p', row: page('p', 'start') })] })).acked;
      await s.push({ ...A, mutations: [m({ op: 'page.setBody', id: 'p', body: 'from A' }, created.version)] });
      await s.push({ ...B, mutations: [m({ op: 'page.setBody', id: 'p', body: 'from B' }, created.version)] });
      expect((await s.row('page', 'p'))!.data!.body).toBe('from B');
      const copies = (await s.rows()).filter((r) => r.entity === 'page' && r.id !== 'p');
      expect(copies.map((r) => (r.data as PageRow).title)).toEqual(['Notes (conflict, PC-A)']);
      expect((copies[0].data as PageRow).body).toBe('from A');
    });

    it('no conflict when the body was not changed by anyone else since', async () => {
      const s = await make();
      await s.push({ ...A, mutations: [m({ op: 'page.create', id: 'p', row: page('p') }), m({ op: 'page.setBody', id: 'p', body: 'a' }), m({ op: 'page.setBody', id: 'p', body: 'ab' })] });
      expect((await s.rows()).filter((r) => r.entity === 'page')).toHaveLength(1);
    });

    it('an append made meanwhile on another PC survives a body edit', async () => {
      const s = await make();
      const [created] = (await s.push({ ...A, mutations: [m({ op: 'page.create', id: 'p', row: page('p', 'intro') })] })).acked;
      await s.push({ ...A, mutations: [m({ op: 'page.append', id: 'p', text: 'milk', day: '2026-10-26' }, created.version)] });
      await s.push({ ...B, mutations: [m({ op: 'page.setBody', id: 'p', body: 'intro edited' }, created.version)] });
      const body = (await s.row('page', 'p'))!.data!.body;
      expect(body).toContain('intro edited');
      expect(body).toContain('milk');
      expect((await s.rows()).filter((r) => r.entity === 'page')).toHaveLength(1);
    });

    it('a folder move that would make a loop is refused, and the folder is re-sent', async () => {
      const s = await make();
      await s.push({ ...A, mutations: [m({ op: 'folder.create', id: 'x', row: folder('x', 'X') }), m({ op: 'folder.create', id: 'y', row: folder('y', 'Y') })] });
      await s.push({ ...A, mutations: [m({ op: 'folder.update', id: 'x', fields: { parentId: 'y' } })] });
      const before = (await s.row('folder', 'y'))!.version;
      const [ack] = (await s.push({ ...B, mutations: [m({ op: 'folder.update', id: 'y', fields: { parentId: 'x' } })] })).acked;
      expect((await s.row('folder', 'y'))!.data!.parentId).toBeNull();
      expect(ack.version).toBeGreaterThan(before);
      expect((await s.row('folder', 'y'))!.version).toBe(ack.version);
    });

    it('a clashing folder name gets a number', async () => {
      const s = await make();
      await s.push({ ...A, mutations: [m({ op: 'folder.create', id: 'a', row: folder('a', 'Work') })] });
      await s.push({ ...B, mutations: [m({ op: 'folder.create', id: 'b', row: folder('b', 'work') })] });
      expect((await s.row('folder', 'b'))!.data!.name).toBe('work (2)');
    });

    it('anything sent into a deleted folder lands in its nearest live parent', async () => {
      const s = await make();
      await s.push({ ...A, mutations: [m({ op: 'folder.create', id: 'top', row: folder('top', 'Top') }), m({ op: 'folder.create', id: 'f', row: folder('f', 'F', 'top') })] });
      await s.push({ ...A, mutations: [m({ op: 'folder.delete', id: 'f' })] });
      await s.push({ ...B, mutations: [m({ op: 'note.create', id: 'n', row: note('n', 'f') })] });
      expect((await s.row('note', 'n'))!.data!.folderId).toBe('top');
      await s.push({ ...B, mutations: [m({ op: 'folder.create', id: 'g', row: folder('g', 'G', 'f') })] });
      expect((await s.row('folder', 'g'))!.data!.parentId).toBe('top');
    });

    it('deleting a folder moves what is still in it up to its parent', async () => {
      const s = await make();
      await s.push({ ...A, mutations: [m({ op: 'folder.create', id: 'top', row: folder('top', 'Top') }), m({ op: 'folder.create', id: 'f', row: folder('f', 'F', 'top') })] });
      await s.push({ ...B, mutations: [m({ op: 'note.create', id: 'n', row: note('n', 'f') }), m({ op: 'folder.create', id: 'sub', row: folder('sub', 'Sub', 'f') })] });
      await s.push({ ...A, mutations: [m({ op: 'folder.delete', id: 'f' })] });
      expect((await s.row('note', 'n'))!.data!.folderId).toBe('top');
      expect((await s.row('folder', 'sub'))!.data!.parentId).toBe('top');
    });

    it('delete wins: a later edit of a deleted row is acked and ignored', async () => {
      const s = await make();
      await s.push({ ...A, mutations: [m({ op: 'note.create', id: 'n', row: note('n') }), m({ op: 'note.delete', id: 'n' })] });
      const res = await s.push({ ...B, mutations: [m({ op: 'note.update', id: 'n', fields: { title: 'x' } })] });
      expect(res.acked).toHaveLength(1);
      expect((await s.row('note', 'n'))).toMatchObject({ deleted: true, data: null });
    });

    it('settings are last write wins and pulled after the cursor', async () => {
      const s = await make();
      await s.push({ ...A, mutations: [m({ op: 'prefs.set', key: 'transcribeLanguage', value: 'es' })] });
      await s.push({ ...B, mutations: [m({ op: 'prefs.set', key: 'transcribeLanguage', value: 'fr' })] });
      const pulled = await s.pull({ clientId: 'C', cursor: 0 });
      expect(pulled.prefs).toEqual([{ key: 'transcribeLanguage', value: 'fr', version: 2 }]);
    });

    it('a lost answer can be simulated: the push applies but the caller sees an error', async () => {
      const s = await make();
      s.dropNextAck();
      const create = m({ op: 'page.create', id: 'p', row: page('p') });
      await expect(s.push({ ...A, mutations: [create] })).rejects.toThrow('connection lost');
      expect((await s.row('page', 'p'))).toBeDefined();
      expect((await s.push({ ...A, mutations: [create] })).acked).toHaveLength(1);
    });

    it('fileOwner: audio follows its note row, an image any live page that references it', async () => {
      const s = await make();
      const N = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      const IMG = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png';
      expect(await s.fileOwner('audio', `${N}.webm`)).toBe('none');
      expect(await s.fileOwner('image', IMG)).toBe('none');
      await s.push({ ...A, mutations: [m({ op: 'note.create', id: N, row: note(N) }), m({ op: 'page.create', id: 'p', row: page('p', `x ![](vn-image://${IMG}) y`) })] });
      expect(await s.fileOwner('audio', `${N}.webm`)).toBe('live');
      expect(await s.fileOwner('image', IMG)).toBe('live');
      expect(await s.fileOwner('audio', `${N}.webm`, OTHER)).toBe('none');
      expect(await s.fileOwner('image', IMG, OTHER)).toBe('none');
      await s.push({ ...A, mutations: [m({ op: 'note.delete', id: N }), m({ op: 'page.delete', id: 'p' })] });
      expect(await s.fileOwner('audio', `${N}.webm`)).toBe('deleted');
      expect(await s.fileOwner('image', IMG)).toBe('none');
    });

    it('liveFiles lists the live notes\' audio and the images live pages reference, for one account', async () => {
      const s = await make();
      const N1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      const N2 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
      const I1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png';
      const I2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd.jpg';
      await s.push({
        ...A,
        mutations: [
          m({ op: 'note.create', id: N1, row: note(N1) }),
          m({ op: 'note.create', id: N2, row: note(N2) }),
          m({ op: 'page.create', id: 'p1', row: page('p1', `vn-image://${I1}`) }),
          m({ op: 'page.create', id: 'p2', row: page('p2', `vn-image://${I2}`) }),
        ],
      });
      await s.push({ ...A, mutations: [m({ op: 'note.delete', id: N2 }), m({ op: 'page.delete', id: 'p2' })] });
      const live = await s.liveFiles();
      expect([...live.audio]).toEqual([`${N1}.webm`]);
      expect([...live.images]).toEqual([I1]);
      const theirs = await s.liveFiles(OTHER);
      expect(theirs.audio.size + theirs.images.size).toBe(0);
    });
  });
}