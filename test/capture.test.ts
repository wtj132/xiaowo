import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../src/api.js';
import { Store } from '../src/store.js';

let dir: string;
let store: Store;
let queued: string[];
let app: ReturnType<typeof createApi>;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cap-'));
  store = new Store(dir);
  queued = [];
  app = createApi({ store, enqueue: (id) => queued.push(id), redo: () => {} });
});

function post(fields: Record<string, string | Blob | (string | Blob)[]>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x as string);
  return app.request('/api/capture', { method: 'POST', body: fd });
}
const png = (n = 8) => new File([new Uint8Array(n)], 'a.png', { type: 'image/png' });

describe('POST /api/capture', () => {
  it('saves text only and enqueues it', async () => {
    const res = await post({ clientId: 'c1', text: '随手记一下' });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe('saved');
    expect(queued).toEqual([body.id]);
  });
  it('extracts links from the text', async () => {
    const body = await (await post({ clientId: 'c2', text: '看这个 https://www.bilibili.com/video/BV1xx 不错' })).json();
    expect((await store.getRaw(body.id))!.urls).toEqual(['https://www.bilibili.com/video/BV1xx']);
  });
  it('accepts an explicit url field', async () => {
    const body = await (await post({ clientId: 'c3', url: 'https://example.com/a' })).json();
    expect((await store.getRaw(body.id))!.urls).toContain('https://example.com/a');
  });
  it('saves a png to disk', async () => {
    const body = await (await post({ clientId: 'c4', images: png() })).json();
    expect(readdirSync(join(dir, 'inbox', body.id))).toContain('img-0.png');
  });
  it('rejects empty and whitespace-only submissions', async () => {
    const res = await post({ clientId: 'c5', text: '   \n ' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('内容不能为空');
    expect(queued).toEqual([]);
  });
  it('rejects an image larger than 10MB', async () => {
    expect((await post({ clientId: 'c6', images: png(10 * 1024 * 1024 + 1) })).status).toBe(413);
  });
  it('rejects non-image files', async () => {
    const pdf = new File(['%PDF'], 'a.pdf', { type: 'application/pdf' });
    expect((await post({ clientId: 'c7', images: pdf })).status).toBe(400);
  });
  it('rejects a missing clientId', async () => {
    expect((await post({ text: 'x' })).status).toBe(400);
  });
  it('returns the same id for a repeated clientId and does not enqueue twice', async () => {
    const a = await (await post({ clientId: 'dup', text: 'x' })).json();
    const res = await post({ clientId: 'dup', text: 'x' });
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe(a.id);
    expect(queued.length).toBe(1);
    expect(readdirSync(join(dir, 'inbox')).length).toBe(1);
  });
  it('accepts JSON bodies too', async () => {
    const res = await app.request('/api/capture', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientId: 'j1', text: 'hi' }),
    });
    expect(res.status).toBe(201);
  });
});
