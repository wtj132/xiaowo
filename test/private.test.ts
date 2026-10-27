import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../src/api.js';
import { FakeDsh } from '../src/dsh.js';
import { Queue } from '../src/queue.js';
import { FakeSearch } from '../src/search.js';
import { Store } from '../src/store.js';

let store: Store;
beforeEach(() => { store = new Store(mkdtempSync(join(tmpdir(), 'priv-'))); });
const tracked = () => execFileSync('git', ['ls-files'], { cwd: store.dataDir, encoding: 'utf8' });

describe('private entries', () => {
  it('never reach git, even after confirm', async () => {
    const pub = await store.createRaw({ clientId: 'p', text: '公开', urls: [], images: [] });
    const raw = await store.createRaw({ clientId: 's', text: '会议纪要', urls: [], images: [{ name: 'a.png', data: Buffer.from('x') }], private: true });
    const draft = { title: 'T', summary: '', keyPoints: [], tags: [], sourceUrls: [] };
    await store.saveDraft({ id: raw.id, rawId: raw.id, version: 1, draft, questions: [], status: 'pending' });
    await store.confirmDraft(raw.id, draft);
    expect(tracked()).toContain(pub.id);
    expect(tracked()).not.toContain(raw.id);
    expect((await store.getEntry(raw.id))!.private).toBe(true);
  });

  it('queue drafts locally without calling the assistant', async () => {
    const raw = await store.createRaw({ clientId: 's', text: '第一行\n更多', urls: [], images: [], private: true });
    const dsh = new FakeDsh('不应被调用');
    let asked = false;
    dsh.ask = async () => { asked = true; return ''; };
    const q = new Queue({ store, dsh, search: new FakeSearch(), ocr: async () => '' });
    q.enqueue(raw.id);
    await q.onIdle();
    expect(asked).toBe(false);
    expect((await store.getDraft(raw.id))!.draft!.title).toBe('第一行');
    expect((await store.getRaw(raw.id))!.status).toBe('drafted');
  });

  it('api accepts private on capture and refuses redo', async () => {
    const app = createApi({ store, enqueue: () => {}, redo: () => {} });
    const fd = new FormData();
    fd.append('clientId', 'c'); fd.append('text', '内部方案'); fd.append('private', '1');
    const { id } = await (await app.request('/api/capture', { method: 'POST', body: fd })).json();
    expect((await store.getRaw(id))!.private).toBe(true);
    await store.saveDraft({ id, rawId: id, version: 1, draft: { title: 'T', summary: '', keyPoints: [], tags: [], sourceUrls: [] }, questions: [], status: 'pending' });
    const res = await app.request(`/api/drafts/${id}/redo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ note: '改' }) });
    expect(res.status).toBe(409);
  });
});
