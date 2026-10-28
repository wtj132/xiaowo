import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../src/api.js';
import { FakeDsh } from '../src/dsh.js';
import { detectScene, organize } from '../src/organizer.js';
import { cleanFields, parseScene, repoScenes } from '../src/scenes.js';
import { FakeSearch } from '../src/search.js';
import { Store } from '../src/store.js';

const scenes = repoScenes();
const film = scenes.byId.get('film')!;

describe('scene files', () => {
  it('every scene in the repo parses and has a fallback', () => {
    expect(scenes.fallback.id).toBe('note');
    expect([...scenes.byId.keys()].sort()).toEqual(['book', 'bug', 'card', 'film', 'note', 'paper']);
    expect(scenes.persona).toContain('小小蜗');
  });
  it('rejects a broken header', () => {
    expect(() => parseScene('x.md', '---\n{bad}\n---\n')).toThrow(/JSON/);
    expect(() => parseScene('x.md', '---\n{"id":"x","fields":[{"key":"a","label":"A","type":"enum"}]}\n---\n')).toThrow(/options/);
  });
  it('cleans field values by type and drops unknown keys', () => {
    expect(cleanFields(film, { work: ' 花样年华 ', year: '2000', rating: 9, status: '乱写', quotes: 'a\nb', date: '昨天', junk: 1 }))
      .toEqual({ work: '花样年华', year: 2000, status: '看完', quotes: ['a', 'b'] });
    expect(cleanFields(film, {})).toEqual({ status: '看完' });
  });
});

let store: Store;
beforeEach(() => { store = new Store(mkdtempSync(join(tmpdir(), 'scn-'))); });
const deps = (dsh: FakeDsh) => ({ store, dsh, search: new FakeSearch(), ocr: async () => '' });

describe('two-step organize', () => {
  it('detects the scene, then fills that scene\'s fields', async () => {
    const raw = await store.createRaw({ clientId: 'a', text: '重看《花样年华》，雨夜那段太美了'.repeat(30), urls: [], images: [] });
    const dsh = new FakeDsh((p) => p.startsWith('## 识别场景')
      ? '{"scene":"film","confidence":0.9}'
      : JSON.stringify({ title: '花样年华', oneLine: '雨夜那段太美了', date: '2026-10-27', summary: '', keyPoints: [], tags: ['王家卫'],
        fields: { work: '花样年华', year: 2000, rating: 5 }, questions: ['和谁看的？'] }));
    const r = await organize(raw, deps(dsh));
    expect(dsh.prompts).toHaveLength(2);
    expect(dsh.prompts[1]).toContain('小小蜗');
    expect(dsh.prompts[1]).toContain('看的日期');
    expect(r.draft).toMatchObject({ scene: 'film', date: '2026-10-27', oneLine: '雨夜那段太美了', fields: { work: '花样年华', year: 2000, rating: 5, status: '看完' } });
    expect(r.questions).toEqual(['和谁看的？']);
  });
  it('falls back to note when detection is garbage, and offers alternatives when unsure', async () => {
    expect((await detectScene(new FakeDsh('不知道'), scenes, 'x')).scene.id).toBe('note');
    const unsure = await detectScene(new FakeDsh('{"scene":"bug","confidence":0.4,"alternatives":["note","nope"]}'), scenes, 'x');
    expect(unsure).toMatchObject({ scene: { id: 'bug' }, alternatives: ['note'] });
  });
  it('paper proposes cards and keeps only links to real entries', async () => {
    const old = await store.createRaw({ clientId: 'o', text: '旧卡片', urls: [], images: [] });
    await store.saveDraft({ id: old.id, rawId: old.id, version: 1, draft: null, questions: [], status: 'pending' });
    await store.confirmDraft(old.id, { title: '旧观点', summary: '', keyPoints: [], tags: [], sourceUrls: [], scene: 'card' });
    const raw = await store.createRaw({ clientId: 'p', text: 'paper '.repeat(120), urls: [], images: [] });
    const dsh = new FakeDsh((p) => p.startsWith('## 识别场景') ? '{"scene":"paper"}' : JSON.stringify({
      title: 'P', summary: '', keyPoints: [], tags: [], fields: { problem: '评测' },
      cards: [{ title: '用历史轨迹回放评测', draft: '避免自己出题自己考', links: [{ to: old.id, type: '支持', reason: '同一个思路' }, { to: 'fake', type: '支持', reason: 'x' }] }],
    }));
    const r = await organize(raw, deps(dsh));
    expect(r.draft.cards).toEqual([{ title: '用历史轨迹回放评测', draft: '避免自己出题自己考', links: [{ to: old.id, type: '支持', reason: '同一个思路' }] }]);
  });
});

describe('cards, relations and backlinks through the API', () => {
  it('confirming with picked cards creates linked card entries that show up as backlinks', async () => {
    const app = createApi({ store, enqueue: () => {}, redo: () => {} });
    const raw = await store.createRaw({ clientId: 'p', text: 'paper', urls: [], images: [] });
    await store.saveDraft({ id: raw.id, rawId: raw.id, version: 1, draft: null, questions: [], status: 'pending' });
    await store.updateRaw(raw.id, { status: 'drafted' });
    const res = await app.request(`/api/drafts/${raw.id}/confirm`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        draft: { title: '论文 P', summary: 's', keyPoints: [], tags: ['agent'], sourceUrls: [], scene: 'paper', fields: { problem: '评测', bogus: 1 }, date: '2026-10-28' },
        cards: [{ title: '一句完整的观点', idea: '我的话', links: [] }],
      }),
    });
    const { entryId, cardIds } = await res.json();
    expect(cardIds).toHaveLength(1);
    const paper = await store.getEntry(entryId);
    expect(paper).toMatchObject({ scene: 'paper', date: '2026-10-28', fields: { problem: '评测' } });
    const card = await store.getEntry(cardIds[0]);
    expect(card).toMatchObject({ scene: 'card', title: '一句完整的观点', relations: [{ to: entryId, type: '出处' }] });
    const detail = await (await app.request(`/api/entries/${entryId}`)).json();
    expect(detail.backlinks).toEqual([expect.objectContaining({ id: cardIds[0], type: '出处' })]);
    const cardDetail = await (await app.request(`/api/entries/${cardIds[0]}`)).json();
    expect(cardDetail.titles[entryId]).toBe('论文 P');
  });
  it('rescene re-queues an old entry and lists scenes without prompts', async () => {
    const queued: string[] = [];
    const app = createApi({ store, enqueue: (id) => queued.push(id), redo: () => {} });
    const raw = await store.createRaw({ clientId: 'o', text: '旧条目', urls: [], images: [] });
    await store.saveDraft({ id: raw.id, rawId: raw.id, version: 1, draft: null, questions: [], status: 'pending' });
    await store.confirmDraft(raw.id, { title: '旧', summary: '', keyPoints: [], tags: [], sourceUrls: [] });
    expect((await app.request(`/api/entries/${raw.id}/rescene`, { method: 'POST' })).status).toBe(202);
    expect(queued).toEqual([raw.id]);
    expect((await store.getRaw(raw.id))!.status).toBe('saved');
    const { scenes: list } = await (await app.request('/api/scenes')).json();
    expect(list.find((s: any) => s.id === 'film').fields.length).toBeGreaterThan(3);
    expect(list[0].guide).toBeUndefined();
  });
});
