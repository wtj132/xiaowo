import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../src/api.js';
import { Store } from '../src/store.js';

const sample = {
  version: 29, at: 1,
  data: {
    name: '北欧 3 日', start: '2027-01-19', end: '2027-01-21', budget: 10000, people: ['我'],
    rates: { CNY: 1, EUR: 8 },
    tickets: [{ amount: 1000, cur: 'CNY' }, { amount: 50, cur: 'EUR' }],
    days: {
      '2027-01-20': { city: '哥本哈根', country: 'DK', stops: [{ amount: 100, cur: 'CNY' }] },
      '2027-01-19': { city: '柏林', country: 'DE', cover: 'https://example.com/a.jpg' },
      '2027-01-21': { city: '哥本哈根', country: 'DK' },
    },
    packing: [{ id: 'x', text: '护照', done: false }],
  },
};

let store: Store;
let app: ReturnType<typeof createApi>;
beforeEach(() => {
  store = new Store(mkdtempSync(join(tmpdir(), 'trips-')));
  app = createApi({ store, enqueue: () => {}, redo: () => {} });
});
const json = (path: string, method: string, body?: unknown) =>
  app.request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

describe('trips API', () => {
  it('imports a nordic-trip export and lists its summary', async () => {
    const res = await json('/api/trips', 'POST', sample);
    expect(res.status).toBe(201);
    const { trips } = await (await app.request('/api/trips')).json();
    expect(trips).toHaveLength(1);
    expect(trips[0]).toMatchObject({
      name: '北欧 3 日', days: 3, countries: ['DE', 'DK'], cities: ['柏林', '哥本哈根'],
      cover: 'https://example.com/a.jpg', budget: 10000, spent: 1000 + 400 + 100,
    });
  });

  it('keeps unknown fields untouched on round trip', async () => {
    const { trip } = await (await json('/api/trips', 'POST', sample)).json();
    const { trip: got } = await (await app.request(`/api/trips/${trip.id}`)).json();
    expect(got.data.packing).toEqual(sample.data.packing);
  });

  it('saves with matching rev and rejects a stale rev with the current copy', async () => {
    const { trip } = await (await json('/api/trips', 'POST', sample)).json();
    const ok = await json(`/api/trips/${trip.id}`, 'PUT', { rev: 1, data: { ...sample.data, name: '改名' } });
    expect((await ok.json()).trip.rev).toBe(2);
    const stale = await json(`/api/trips/${trip.id}`, 'PUT', { rev: 1, data: sample.data });
    expect(stale.status).toBe(409);
    expect((await stale.json()).trip.data.name).toBe('改名');
  });

  it('commits trips to the data repo', async () => {
    const { trip } = await (await json('/api/trips', 'POST', sample)).json();
    await store.listTrips();
    const files = execFileSync('git', ['ls-files'], { cwd: store.dataDir, encoding: 'utf8' });
    expect(files).toContain(`trips/${trip.id}.json`);
  });

  it('rejects non-trip bodies and unknown ids', async () => {
    expect((await json('/api/trips', 'POST', [1, 2])).status).toBe(400);
    expect((await json('/api/trips', 'POST', { data: { days: [] } })).status).toBe(400);
    expect((await app.request('/api/trips/nope')).status).toBe(404);
    expect((await json('/api/trips/../x', 'PUT', { rev: 1, data: {} })).status).toBe(404);
  });

  it('deletes a trip', async () => {
    const { trip } = await (await json('/api/trips', 'POST', sample)).json();
    expect((await json(`/api/trips/${trip.id}`, 'DELETE')).status).toBe(200);
    expect((await (await app.request('/api/trips')).json()).trips).toEqual([]);
  });
});
