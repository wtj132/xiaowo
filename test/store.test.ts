import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store.js';

let dir: string;
let store: Store;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'store-'));
  store = new Store(dir);
});
const log = () => execFileSync('git', ['log', '--oneline'], { cwd: dir }).toString().trim().split('\n').filter(Boolean);
const input = (clientId = 'c1') => ({
  clientId, text: '一个很棒的动效', urls: ['https://b23.tv/x'],
  images: [{ name: 'a.png', data: Buffer.from('png') }],
});

describe('Store', () => {
  it('createRaw saves raw.json and images and makes one commit', async () => {
    const raw = await store.createRaw(input());
    expect(raw.status).toBe('saved');
    expect(existsSync(join(dir, 'inbox', raw.id, 'raw.json'))).toBe(true);
    expect(readdirSync(join(dir, 'inbox', raw.id))).toContain('img-0.png');
    expect(log().length).toBe(1);
  });

  it('createRaw with same clientId returns existing raw without new directory', async () => {
    const a = await store.createRaw(input('same'));
    const b = await store.createRaw(input('same'));
    expect(b.id).toBe(a.id);
    expect(readdirSync(join(dir, 'inbox')).length).toBe(1);
  });

  it('listRaw filters by status', async () => {
    const a = await store.createRaw(input('a'));
    await store.createRaw(input('b'));
    await store.updateRaw(a.id, { status: 'drafted' });
    expect((await store.listRaw('saved')).length).toBe(1);
    expect((await store.listRaw('drafted'))[0].id).toBe(a.id);
  });

  it('confirmDraft writes entry md containing original text', async () => {
    const raw = await store.createRaw(input());
    await store.saveDraft({
      id: raw.id, rawId: raw.id, version: 1, status: 'pending', questions: [],
      draft: { title: 'T', summary: 'S', keyPoints: ['k1'], tags: ['动效'], sourceUrls: ['https://b23.tv/x'] },
    });
    const { entryId } = await store.confirmDraft(raw.id, { title: 'T2', summary: 'S', keyPoints: ['k1'], tags: ['动效'], sourceUrls: [] });
    const md = readFileSync(join(dir, 'entries', `${entryId}.md`), 'utf8');
    expect(md).toContain('title: T2');
    expect(md).toContain('一个很棒的动效');
    expect((await store.getRaw(raw.id))!.status).toBe('confirmed');
    expect((await store.getDraft(raw.id))!.status).toBe('confirmed');
  });

  it('updateEntry changes an existing entry', async () => {
    const raw = await store.createRaw(input());
    await store.saveDraft({ id: raw.id, rawId: raw.id, version: 1, status: 'pending', questions: [],
      draft: { title: 'T', summary: 'S', keyPoints: [], tags: [], sourceUrls: [] } });
    const { entryId } = await store.confirmDraft(raw.id, { title: 'T', summary: 'S', keyPoints: [], tags: [], sourceUrls: [] });
    await store.updateEntry(entryId, { title: 'New', summary: 'S2', keyPoints: ['x'], tags: ['t'], sourceUrls: [] });
    const e = await store.getEntry(entryId);
    expect(e!.title).toBe('New');
    expect(e!.summary).toBe('S2');
    expect(e!.rawText).toContain('一个很棒的动效');
  });
});
