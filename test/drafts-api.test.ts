import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../src/api.js';
import { Store, type Draft } from '../src/store.js';

const draft: Draft = { title: 'T', summary: 'S', keyPoints: ['k'], tags: ['t'], sourceUrls: [] };
let store: Store;
let app: ReturnType<typeof createApi>;
let enqueued: string[];
let redone: { id: string; note: string }[];
let rawId: string;

beforeEach(async () => {
  store = new Store(mkdtempSync(join(tmpdir(), 'dapi-')));
  enqueued = []; redone = [];
  app = createApi({ store, enqueue: (id) => enqueued.push(id), redo: (id, note) => redone.push({ id, note }) });
  const raw = await store.createRaw({ clientId: 'a', text: '原文内容', urls: [], images: [{ name: 'a.png', data: Buffer.from('PNGDATA') }] });
  rawId = raw.id;
  await store.saveDraft({ id: rawId, rawId, version: 1, draft, questions: ['这是什么？'], status: 'pending' });
  await store.updateRaw(rawId, { status: 'drafted' });
});
const json = (path: string, method: string, body?: unknown) =>
  app.request(path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

describe('draft & entry API', () => {
  it('inbox lists the drafted item with its draft', async () => {
    const { items } = await (await app.request('/api/inbox')).json();
    expect(items[0].raw.id).toBe(rawId);
    expect(items[0].draft.questions).toEqual(['这是什么？']);
  });
  it('confirm writes the entry and marks the raw confirmed', async () => {
    const res = await json(`/api/drafts/${rawId}/confirm`, 'POST', { draft: { ...draft, title: '改过的标题' } });
    expect(res.status).toBe(200);
    const { entryId } = await res.json();
    expect((await store.getEntry(entryId))!.title).toBe('改过的标题');
    expect((await store.getRaw(rawId))!.status).toBe('confirmed');
    expect((await (await app.request('/api/inbox')).json()).items).toEqual([]);
    expect((await (await app.request('/api/entries')).json()).entries.length).toBe(1);
  });
  it('confirm on a failed draft is 409', async () => {
    await store.saveDraft({ id: rawId, rawId, version: 2, draft: null, questions: [], status: 'failed', error: 'x' });
    expect((await json(`/api/drafts/${rawId}/confirm`, 'POST', { draft })).status).toBe(409);
  });
  it('confirm rejects a malformed draft body', async () => {
    expect((await json(`/api/drafts/${rawId}/confirm`, 'POST', { draft: { title: 1 } })).status).toBe(400);
  });
  it('discard keeps nothing in entries', async () => {
    expect((await json(`/api/drafts/${rawId}/discard`, 'POST')).status).toBe(200);
    expect((await store.getRaw(rawId))!.status).toBe('discarded');
    expect((await store.listEntries()).length).toBe(0);
  });
  it('redo and answer call the queue with a note', async () => {
    expect((await json(`/api/drafts/${rawId}/redo`, 'POST', { note: '多讲原理' })).status).toBe(202);
    expect((await json(`/api/drafts/${rawId}/answer`, 'POST', { answers: '这是个 CSS 动效' })).status).toBe(202);
    expect(redone[0]).toEqual({ id: rawId, note: '多讲原理' });
    expect(redone[1].note).toContain('这是个 CSS 动效');
  });
  it('retry re-enqueues a failed raw', async () => {
    await store.updateRaw(rawId, { status: 'failed' });
    expect((await json(`/api/raw/${rawId}/retry`, 'POST')).status).toBe(202);
    expect(enqueued).toEqual([rawId]);
  });
  it('entry can be edited after confirmation', async () => {
    const { entryId } = await (await json(`/api/drafts/${rawId}/confirm`, 'POST', { draft })).json();
    expect((await json(`/api/entries/${entryId}`, 'PUT', { draft: { ...draft, summary: '新摘要' } })).status).toBe(200);
    expect((await (await app.request(`/api/entries/${entryId}`)).json()).entry.summary).toBe('新摘要');
  });
  it('entry detail includes the original image names', async () => {
    const { entryId } = await (await json(`/api/drafts/${rawId}/confirm`, 'POST', { draft })).json();
    const body = await (await app.request(`/api/entries/${entryId}`)).json();
    expect(body.images).toEqual(['img-0.png']);
  });
  it('serves a stored image', async () => {
    const res = await app.request(`/api/files/${rawId}/img-0.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(await res.text()).toBe('PNGDATA');
  });
  it('refuses path traversal in the file route', async () => {
    for (const p of [`/api/files/${rawId}/..%2F..%2Fraw.json`, '/api/files/..%2F../x.png', `/api/files/${rawId}/raw.json`]) {
      expect([400, 404]).toContain((await app.request(p)).status);
    }
  });
});
