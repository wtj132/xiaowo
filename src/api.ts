import { Hono } from 'hono';
import type { Store } from './store.js';

export interface ApiDeps {
  store: Store;
  enqueue: (rawId: string) => void;
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_EXT = /\.(png|jpe?g|webp|heic|heif)$/i;
const URL_RE = /https?:\/\/[^\s<>"'，。）)]+/g;

const asArray = (v: unknown): unknown[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

export function createApi(deps: ApiDeps) {
  const { store, enqueue } = deps;
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

  return api;
}
