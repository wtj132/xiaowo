import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { RevConflict, type Store } from './store.js';
import type { TripRecord } from './trips.js';

/**
 * nordic-trip 自带的同步协议（原本由 serve_lan.py 提供），原样实现在这里，
 * 这样旅程详情页几乎不用改就能读写服务器。协议里的"同步密钥"就是旅程 id。
 */
const ID_RE = /^[\w-]+$/;
const KV_NAMES = new Set(['ai', 'net', 'chats']);
const MAX_BODY = 20 * 1024 * 1024;

type State = { version: number; data: unknown; at: number; label: string };
const state = (t: TripRecord): State => ({ version: t.rev, data: t.data, at: Math.floor(Date.parse(t.updatedAt) / 1000), label: t.label ?? '' });
const validTrip = (t: any) => t && typeof t === 'object' && /^\d{4}-\d{2}-\d{2}$/.test(t.start) && /^\d{4}-\d{2}-\d{2}$/.test(t.end) && t.days && typeof t.days === 'object' && !Array.isArray(t.days);

function brief(t: TripRecord) {
  const d = t.data as any;
  const inside = Object.entries(d.days ?? {}).filter(([k]) => k >= d.start && k <= d.end);
  return {
    v: t.rev, at: Math.floor(Date.parse(t.updatedAt) / 1000), label: t.label ?? '', start: d.start, end: d.end,
    stops: inside.reduce((n, [, x]: [string, any]) => n + (x?.stops?.length ?? 0), 0), tickets: d.tickets?.length ?? 0,
  };
}

export function createTripSync(store: Store) {
  const api = new Hono<{ Variables: { trip: TripRecord } }>();

  const keyed = async (c: any, next: () => Promise<void>) => {
    const id = c.req.header('x-trip-key') ?? '';
    const trip = ID_RE.test(id) ? await store.getTrip(id) : null;
    if (!trip) return c.json({ error: 'bad key' }, 403);
    c.set('trip', trip);
    await next();
  };
  for (const path of ['/api/trip', '/api/version', '/api/history', '/api/history/*', '/api/kv/*']) api.use(path, keyed);

  api.get('/api/trip', (c) => c.json(state(c.get('trip'))));
  api.get('/api/version', (c) => c.json({ version: c.get('trip').rev }));

  api.put('/api/trip', bodyLimit({ maxSize: MAX_BODY, onError: (c) => c.json({ error: 'body size' }, 413) }), async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || !Number.isInteger(body.base) || !validTrip(body.data)) return c.json({ error: 'bad trip' }, 400);
    const label = String(body.label ?? '').slice(0, 60);
    try {
      const next = await store.saveTrip(c.get('trip').id, body.data, body.base, label);
      return c.json({ version: next.rev });
    } catch (e) {
      if (e instanceof RevConflict) return c.json(state(e.current), 409); // 别处先存了；客户端会让主人选
      throw e;
    }
  });

  api.get('/api/history', async (c) => c.json({ history: (await store.tripHistory(c.get('trip').id)).map(brief) }));
  api.get('/api/history/:v', async (c) => {
    const v = Number(c.req.param('v'));
    const hit = (await store.tripHistory(c.get('trip').id, 400)).find((t) => t.rev === v);
    return hit ? c.json(state(hit)) : c.json({ error: 'no such version' }, 404);
  });

  api.get('/api/kv/:name', async (c) => {
    const name = c.req.param('name');
    if (!KV_NAMES.has(name)) return c.json({ error: 'unknown' }, 404);
    return c.json({ data: await store.getTripKv(c.get('trip').id, name) });
  });
  api.put('/api/kv/:name', bodyLimit({ maxSize: MAX_BODY, onError: (c) => c.json({ error: 'body size' }, 413) }), async (c) => {
    const name = c.req.param('name');
    if (!KV_NAMES.has(name)) return c.json({ error: 'unknown' }, 404);
    const body = await c.req.json().catch(() => null);
    if (!body || !('data' in body)) return c.json({ error: 'bad body' }, 400);
    await store.putTripKv(c.get('trip').id, name, body.data);
    return c.json({ ok: true });
  });

  return api;
}
