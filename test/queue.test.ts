import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { FakeDsh } from '../src/dsh.js';
import type { OrganizerDeps } from '../src/organizer.js';
import { Queue } from '../src/queue.js';
import { FakeSearch } from '../src/search.js';
import { Store } from '../src/store.js';

const good = JSON.stringify({ title: 'T', summary: 'S', keyPoints: ['k'], tags: ['t'], questions: [] });
let store: Store;
const body = { text: 'abc'.repeat(200), urls: [] as string[], images: [] as { name: string; data: Buffer }[] };
const mkDeps = (dsh: FakeDsh): OrganizerDeps => ({ store, dsh, search: new FakeSearch(), ocr: async () => '' });
beforeEach(() => { store = new Store(mkdtempSync(join(tmpdir(), 'q-'))); });

describe('Queue', () => {
  it('moves saved → drafted and stores a pending draft', async () => {
    const raw = await store.createRaw({ clientId: 'a', ...body });
    const q = new Queue(mkDeps(new FakeDsh(good)));
    q.enqueue(raw.id);
    await q.onIdle();
    expect((await store.getRaw(raw.id))!.status).toBe('drafted');
    const d = (await store.getDraft(raw.id))!;
    expect(d.status).toBe('pending');
    expect(d.version).toBe(1);
  });
  it('marks failed but keeps the raw material when DSH returns garbage', async () => {
    const raw = await store.createRaw({ clientId: 'a', ...body });
    const q = new Queue(mkDeps(new FakeDsh('不是JSON')));
    q.enqueue(raw.id);
    await q.onIdle();
    expect((await store.getRaw(raw.id))!.status).toBe('failed');
    expect((await store.getRaw(raw.id))!.text).toBe(body.text);
    expect((await store.getDraft(raw.id))!.status).toBe('failed');
  });
  it('processes jobs strictly one at a time', async () => {
    const a = await store.createRaw({ clientId: 'a', ...body });
    const b = await store.createRaw({ clientId: 'b', ...body });
    const dsh = new FakeDsh(async () => { await new Promise((r) => setTimeout(r, 50)); return good; });
    const q = new Queue(mkDeps(dsh));
    q.enqueue(a.id); q.enqueue(b.id);
    await q.onIdle();
    expect(dsh.starts.length).toBe(2);
    expect(dsh.starts[1]).toBeGreaterThanOrEqual(dsh.ends[0]);
  });
  it('redo bumps the version and passes the note', async () => {
    const raw = await store.createRaw({ clientId: 'a', ...body });
    const dsh = new FakeDsh(good);
    const q = new Queue(mkDeps(dsh));
    q.enqueue(raw.id);
    await q.onIdle();
    q.redo(raw.id, '多讲一点原理');
    await q.onIdle();
    expect((await store.getDraft(raw.id))!.version).toBe(2);
    expect(dsh.prompts[1]).toContain('多讲一点原理');
  });
  it('recover re-queues material stuck in organizing or saved', async () => {
    const a = await store.createRaw({ clientId: 'a', ...body });
    await store.updateRaw(a.id, { status: 'organizing' });
    const b = await store.createRaw({ clientId: 'b', ...body });
    const q = new Queue(mkDeps(new FakeDsh(good)));
    await q.recover();
    await q.onIdle();
    expect((await store.getRaw(a.id))!.status).toBe('drafted');
    expect((await store.getRaw(b.id))!.status).toBe('drafted');
  });
});
