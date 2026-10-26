import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Config } from '../src/config.js';
import { FakeDsh } from '../src/dsh.js';
import { FakeSearch } from '../src/search.js';
import { createApp } from '../src/server.js';

const draftJson = JSON.stringify({ title: '卡片翻转', summary: '3D 翻转', keyPoints: ['perspective'], tags: ['css'], questions: [] });

describe('end to end', () => {
  it('login → capture → draft → confirm → entry, with git history', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'e2e-'));
    const cfg = { dataDir, password: 'pw', apiToken: 'tok', tesseractLangs: 'eng' } as Config;
    const { app, queue } = await createApp(cfg, { dsh: new FakeDsh(draftJson), search: new FakeSearch(), ocr: async () => '' });

    expect((await app.request('/api/inbox')).status).toBe(401);
    const login = await app.request('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'pw' }) });
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const h = { cookie, 'content-type': 'application/json' };

    const cap = await app.request('/api/capture', { method: 'POST', headers: h, body: JSON.stringify({ clientId: 'e1', text: 'B站看到的翻转动效 https://www.bilibili.com/video/BV1' }) });
    expect(cap.status).toBe(201);
    const { id } = await cap.json();
    await queue.onIdle();

    const inbox = await (await app.request('/api/inbox', { headers: h })).json();
    expect(inbox.items[0].raw.status).toBe('drafted');
    expect(inbox.items[0].draft.draft.title).toBe('卡片翻转');

    const conf = await app.request(`/api/drafts/${id}/confirm`, { method: 'POST', headers: h, body: JSON.stringify({ draft: inbox.items[0].draft.draft }) });
    expect(conf.status).toBe(200);
    const entries = (await (await app.request('/api/entries', { headers: h })).json()).entries;
    expect(entries[0].title).toBe('卡片翻转');

    const log = execFileSync('git', ['log', '--format=%s'], { cwd: dataDir }).toString();
    expect(log).toContain(`入库: ${id}`);
    expect(log).toContain(`收件: ${id}`);
  });

  it('serves the static shell without auth but not the API', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'e2e-'));
    const cfg = { dataDir, password: 'pw', apiToken: 'tok', tesseractLangs: 'eng' } as Config;
    const { app } = await createApp(cfg, { dsh: new FakeDsh(draftJson), search: new FakeSearch(), ocr: async () => '' });
    expect((await app.request('/api/entries')).status).toBe(401);
    expect((await app.request('/manifest.webmanifest')).status).toBe(200);
  });
});
