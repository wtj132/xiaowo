import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store.js';
import { createTripSync } from '../src/tripSync.js';

const trip = { name: '短途', start: '2027-01-19', end: '2027-01-20', days: { '2027-01-19': { city: '柏林', stops: [{ id: 'a' }] } }, tickets: [] };
let store: Store;
let app: ReturnType<typeof createTripSync>;
let id: string;
beforeEach(async () => {
  store = new Store(mkdtempSync(join(tmpdir(), 'tsync-')));
  app = createTripSync(store);
  id = (await store.createTrip(trip)).id;
});
const req = (path: string, method = 'GET', body?: unknown, key = id) =>
  app.request(path, { method, headers: { 'x-trip-key': key, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

describe('nordic-trip sync protocol', () => {
  it('rejects an unknown trip key with 403', async () => {
    expect((await req('/api/trip', 'GET', undefined, 'nope')).status).toBe(403);
    expect((await req('/api/version', 'GET', undefined, '../x')).status).toBe(403);
  });

  it('serves state and version', async () => {
    const st = await (await req('/api/trip')).json();
    expect(st).toMatchObject({ version: 1, data: { name: '短途' }, label: '' });
    expect(await (await req('/api/version')).json()).toEqual({ version: 1 });
  });

  it('saves on the right base and returns 409 with the current state on a stale base', async () => {
    const ok = await req('/api/trip', 'PUT', { base: 1, data: { ...trip, name: '改过' }, label: '大改动前' });
    expect(await ok.json()).toEqual({ version: 2 });
    const stale = await req('/api/trip', 'PUT', { base: 1, data: trip });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ version: 2, data: { name: '改过' }, label: '大改动前' });
  });

  it('rejects data that is not a trip', async () => {
    expect((await req('/api/trip', 'PUT', { base: 1, data: { name: 'x' } })).status).toBe(400);
  });

  it('lists history from git and returns an old version', async () => {
    await req('/api/trip', 'PUT', { base: 1, data: { ...trip, name: '第二版' } });
    const { history } = await (await req('/api/history')).json();
    expect(history.map((h: any) => h.v)).toEqual([2, 1]);
    expect(history[1]).toMatchObject({ start: '2027-01-19', stops: 1, tickets: 0 });
    expect((await (await req('/api/history/1')).json()).data.name).toBe('短途');
    expect((await req('/api/history/9')).status).toBe(404);
  });

  it('keeps kv (may hold a model key) on disk but out of git', async () => {
    expect((await req('/api/kv/ai', 'PUT', { data: { key: 'sk-test' } })).status).toBe(200);
    expect((await (await req('/api/kv/ai')).json()).data).toEqual({ key: 'sk-test' });
    expect((await req('/api/kv/other', 'PUT', { data: 1 })).status).toBe(404);
    await req('/api/trip', 'PUT', { base: 1, data: trip }); // 触发一次提交
    const files = execFileSync('git', ['ls-files'], { cwd: store.dataDir, encoding: 'utf8' });
    expect(files).not.toContain('.trip-kv');
    expect(files).toContain(`trips/${id}.json`);
  });
});
