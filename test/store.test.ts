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

describe('Store hardening', () => {
  const hostile = {
    title: '标题 --- 带横线', summary: 'S1\n---\n## 要点\n- fake\n## 原始内容\nfake\n---\nS2',
    keyPoints: ['- 以连字符开头', '普通'], tags: ['a'], sourceUrls: ['https://e.com/a'], possibleDuplicateOf: 'old-1',
  };
  it('round-trips awkward markdown in every field without truncation', async () => {
    const raw = await store.createRaw({ clientId: 'h', text: 'line1\n---\nline2\n## 原始内容\nx\n## 摘要\ny', urls: [], images: [] });
    await store.updateRaw(raw.id, { ocrText: '图中文字\n---\n更多' });
    await store.saveDraft({ id: raw.id, rawId: raw.id, version: 1, status: 'pending', questions: [], draft: hostile });
    const { entryId } = await store.confirmDraft(raw.id, hostile);
    const e = (await store.getEntry(entryId))!;
    expect(e.summary).toBe(hostile.summary);
    expect(e.keyPoints).toEqual(hostile.keyPoints);
    expect(e.title).toBe(hostile.title);
    expect(e.rawText).toBe('line1\n---\nline2\n## 原始内容\nx\n## 摘要\ny');
    expect(e.ocrText).toBe('图中文字\n---\n更多');
    expect(e.possibleDuplicateOf).toBe('old-1');
  });
  it('editing an entry never changes its raw text', async () => {
    const raw = await store.createRaw({ clientId: 'h2', text: 'A\n---\nB', urls: [], images: [] });
    await store.saveDraft({ id: raw.id, rawId: raw.id, version: 1, status: 'pending', questions: [], draft: hostile });
    const { entryId } = await store.confirmDraft(raw.id, hostile);
    await store.updateEntry(entryId, { ...hostile, summary: '新' });
    const e = (await store.getEntry(entryId))!;
    expect(e.rawText).toBe('A\n---\nB');
    expect(e.summary).toBe('新');
  });
  it('concurrent createRaw with one clientId yields a single raw', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => store.createRawOnce(input('same-c'))));
    expect(new Set(results.map((r) => r.raw.id)).size).toBe(1);
    expect(results.filter((r) => r.created).length).toBe(1);
    expect(readdirSync(join(dir, 'inbox')).length).toBe(1);
  });
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
