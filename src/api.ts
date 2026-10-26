import { Hono } from 'hono';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { bodyLimit } from 'hono/body-limit';
import type { Draft, Store } from './store.js';

export interface ApiDeps {
  store: Store;
  enqueue: (rawId: string) => void;
  redo: (draftId: string, note: string) => void;
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_BODY_BYTES = 30 * 1024 * 1024;
const MAX_IMAGES = 9;
const MAX_TEXT_CHARS = 20000;
const URL_RE = /https?:\/\/[^\s<>"'，。）)]+/g;
const ID_RE = /^[\w-]+$/;
const FILE_RE = /^img-\d+\.(png|jpg|webp|heic)$/;
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', heic: 'image/heic' };

/** 按文件头判断真实图片类型，不信任客户端给的文件名和 MIME。 */
function sniffImage(b: Buffer): 'png' | 'jpg' | 'webp' | 'heic' | null {
  if (b.length >= 8 && b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (b.length >= 12 && b.toString('latin1', 4, 8) === 'ftyp' && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1|heif)$/.test(b.toString('latin1', 8, 12))) return 'heic';
  return null;
}

const isStrings = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'string');
function parseDraft(v: any): Draft | null {
  if (!v || typeof v.title !== 'string' || !v.title.trim() || typeof v.summary !== 'string') return null;
  if (!isStrings(v.keyPoints) || !isStrings(v.tags) || !isStrings(v.sourceUrls ?? [])) return null;
  return {
    title: v.title, summary: v.summary, keyPoints: v.keyPoints, tags: v.tags, sourceUrls: v.sourceUrls ?? [],
    ...(typeof v.possibleDuplicateOf === 'string' ? { possibleDuplicateOf: v.possibleDuplicateOf } : {}),
  };
}

const asArray = (v: unknown): unknown[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

export function createApi(deps: ApiDeps) {
  const { store, enqueue, redo } = deps;
  const api = new Hono();

  api.post('/api/capture', bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json({ error: '内容太大了（最多 30MB）' }, 413) }), async (c) => {
    const isJson = (c.req.header('content-type') ?? '').includes('application/json');
    const body: Record<string, unknown> = (isJson
      ? await c.req.json().catch(() => null)
      : await c.req.parseBody({ all: true }).catch(() => null)) ?? {};

    const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : '';
    if (!clientId) return c.json({ error: '缺少 clientId' }, 400);

    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (text.length > MAX_TEXT_CHARS) return c.json({ error: `文字太长了（最多 ${MAX_TEXT_CHARS} 字）` }, 400);
    const urls = [...new Set([
      ...asArray(body.url).filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u.trim())).map((u) => u.trim()),
      ...(text.match(URL_RE) ?? []),
    ])];

    const files = asArray(body.images).filter((f): f is File => f instanceof File);
    if (files.length > MAX_IMAGES) return c.json({ error: `一次最多 ${MAX_IMAGES} 张图片` }, 400);
    const images: { name: string; data: Buffer }[] = [];
    for (const f of files) {
      if (f.size > MAX_IMAGE_BYTES) return c.json({ error: '图片不能超过 10MB' }, 413);
      const data = Buffer.from(await f.arrayBuffer());
      const kind = data.length ? sniffImage(data) : null;
      if (!kind) return c.json({ error: '只支持图片文件（png/jpg/webp/heic）' }, 400);
      images.push({ name: `img.${kind}`, data });
    }

    if (!text && urls.length === 0 && images.length === 0) return c.json({ error: '内容不能为空' }, 400);

    const { raw, created } = await store.createRawOnce({ clientId, text, urls, images });
    if (!created) return c.json({ id: raw.id, status: raw.status }, 200);
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
    const rawNow = await store.getRaw(rec.rawId);
    if (rec.status !== 'pending' || rawNow?.status === 'organizing') return c.json({ error: '这条草稿现在不能确认（可能正在重做）' }, 409);
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
    if (!entry) return c.json({ error: '条目不存在' }, 404);
    const raw = await store.getRaw(entry.rawId);
    return c.json({ entry, images: raw?.images ?? [] });
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
      return c.body(data, 200, { 'content-type': MIME[ext] ?? 'application/octet-stream', 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff' });
    } catch {
      return c.json({ error: '文件不存在' }, 404);
    }
  });

  return api;
}
