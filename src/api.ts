import { Hono } from 'hono';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { Draft, Store } from './store.js';

export interface ApiDeps {
  store: Store;
  enqueue: (rawId: string) => void;
  redo: (draftId: string, note: string) => void;
}

const ID_RE = /^[\w-]+$/;
const FILE_RE = /^img-\d+\.(png|jpe?g|webp|heic|heif)$/i;
const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
};

const isStrings = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'string');
function parseDraft(v: any): Draft | null {
  if (!v || typeof v.title !== 'string' || !v.title.trim() || typeof v.summary !== 'string') return null;
  if (!isStrings(v.keyPoints) || !isStrings(v.tags) || !isStrings(v.sourceUrls ?? [])) return null;
  return {
    title: v.title, summary: v.summary, keyPoints: v.keyPoints, tags: v.tags, sourceUrls: v.sourceUrls ?? [],
    ...(typeof v.possibleDuplicateOf === 'string' ? { possibleDuplicateOf: v.possibleDuplicateOf } : {}),
  };
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_EXT = /\.(png|jpe?g|webp|heic|heif)$/i;
const URL_RE = /https?:\/\/[^\s<>"'，。）)]+/g;

const asArray = (v: unknown): unknown[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

export function createApi(deps: ApiDeps) {
  const { store, enqueue, redo } = deps;
  const api = new Hono();

  api.post('/api/capture', async (c) => {
    const isJson = (c.req.header('content-type') ?? '').includes('application/json');
    const body: Record<string, unknown> = isJson
      ? await c.req.json().catch(() => ({}))
      : await c.req.parseBody({ all: true }).catch(() => ({}));

    const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : '';
    if (!clientId) return c.json({ error: '缺少 clientId' }, 400);

    const text = typeof body.text === 'string' ? body.text.trim() : '';
    const urls = [...new Set([
      ...asArray(body.url).filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u.trim())).map((u) => u.trim()),
      ...(text.match(URL_RE) ?? []),
    ])];

    const images: { name: string; data: Buffer }[] = [];
    for (const f of asArray(body.images)) {
      if (!(f instanceof File)) continue;
      const looksImage = f.type.startsWith('image/') || IMAGE_EXT.test(f.name);
      if (!looksImage || !(f.type.startsWith('image/') || f.type === '')) return c.json({ error: '只支持图片文件' }, 400);
      if (f.size > MAX_IMAGE_BYTES) return c.json({ error: '图片不能超过 10MB' }, 413);
      const ext = IMAGE_EXT.test(f.name) ? f.name : `${f.name}.${f.type.split('/')[1] ?? 'png'}`;
      images.push({ name: ext, data: Buffer.from(await f.arrayBuffer()) });
    }

    if (!text && urls.length === 0 && images.length === 0) return c.json({ error: '内容不能为空' }, 400);

    const before = (await store.listRaw()).find((r) => r.clientId === clientId);
    if (before) return c.json({ id: before.id, status: before.status }, 200);
    const raw = await store.createRaw({ clientId, text, urls, images });
    enqueue(raw.id);
    return c.json({ id: raw.id, status: raw.status }, 201);
  });

  const OPEN: string[] = ['saved', 'organizing', 'drafted', 'failed'];

  api.get('/api/inbox', async (c) => {
    const raws = (await store.listRaw()).filter((r) => OPEN.includes(r.status));
    const items = await Promise.all(raws.map(async (raw) => ({ raw, draft: (await store.getDraft(raw.id)) ?? undefined })));
    const rank = (s: string) => (s === 'drafted' || s === 'failed' ? 0 : 1);
    items.sort((a, b) => rank(a.raw.status) - rank(b.raw.status) || b.raw.id.localeCompare(a.raw.id));
    return c.json({ items });
  });

  api.get('/api/drafts/:id', async (c) => {
    const rec = ID_RE.test(c.req.param('id')) ? await store.getDraft(c.req.param('id')) : null;
    return rec ? c.json({ draft: rec }) : c.json({ error: '草稿不存在' }, 404);
  });

  api.post('/api/drafts/:id/confirm', async (c) => {
    const id = c.req.param('id');
    const rec = ID_RE.test(id) ? await store.getDraft(id) : null;
    if (!rec) return c.json({ error: '草稿不存在' }, 404);
    if (rec.status !== 'pending') return c.json({ error: '这条草稿现在不能确认' }, 409);
    const draft = parseDraft((await c.req.json().catch(() => ({}))).draft);
    if (!draft) return c.json({ error: '草稿格式不对' }, 400);
    return c.json(await store.confirmDraft(id, draft));
  });

  api.post('/api/drafts/:id/discard', async (c) => {
    const id = c.req.param('id');
    if (!ID_RE.test(id) || !(await store.getDraft(id))) return c.json({ error: '草稿不存在' }, 404);
    await store.discardDraft(id);
    return c.json({ ok: true });
  });

  const redoRoute = (field: 'note' | 'answers') => async (c: any) => {
    const id = c.req.param('id');
    const rec = ID_RE.test(id) ? await store.getDraft(id) : null;
    if (!rec || rec.status === 'confirmed' || rec.status === 'discarded') return c.json({ error: '草稿不存在或已处理' }, 404);
    const text = String((await c.req.json().catch(() => ({})))[field] ?? '').trim();
    if (!text) return c.json({ error: '内容不能为空' }, 400);
    redo(id, field === 'answers' ? `用户对你提出的问题的回答：${text}` : text);
    return c.json({ ok: true }, 202);
  };
  api.post('/api/drafts/:id/redo', redoRoute('note'));
  api.post('/api/drafts/:id/answer', redoRoute('answers'));

  api.post('/api/raw/:id/retry', async (c) => {
    const raw = ID_RE.test(c.req.param('id')) ? await store.getRaw(c.req.param('id')) : null;
    if (!raw) return c.json({ error: '原料不存在' }, 404);
    if (raw.status !== 'failed' && raw.status !== 'saved') return c.json({ error: '这条不需要重试' }, 409);
    enqueue(raw.id);
    return c.json({ ok: true }, 202);
  });

  api.get('/api/entries', async (c) => c.json({ entries: await store.listEntries() }));

  api.get('/api/entries/:id', async (c) => {
    const entry = ID_RE.test(c.req.param('id')) ? await store.getEntry(c.req.param('id')) : null;
    return entry ? c.json({ entry }) : c.json({ error: '条目不存在' }, 404);
  });

  api.put('/api/entries/:id', async (c) => {
    const id = c.req.param('id');
    if (!ID_RE.test(id) || !(await store.getEntry(id))) return c.json({ error: '条目不存在' }, 404);
    const draft = parseDraft((await c.req.json().catch(() => ({}))).draft);
    if (!draft) return c.json({ error: '条目格式不对' }, 400);
    return c.json({ entry: await store.updateEntry(id, draft) });
  });

  api.get('/api/files/:rawId/:name', async (c) => {
    const { rawId, name } = c.req.param();
    if (!ID_RE.test(rawId) || !FILE_RE.test(name)) return c.json({ error: '文件不存在' }, 404);
    try {
      const data = await fs.readFile(join(store.dataDir, 'inbox', rawId, name));
      const ext = name.split('.').pop()!.toLowerCase();
      return c.body(data, 200, { 'content-type': MIME[ext] ?? 'application/octet-stream', 'cache-control': 'private, max-age=3600' });
    } catch {
      return c.json({ error: '文件不存在' }, 404);
    }
  });

  return api;
}
