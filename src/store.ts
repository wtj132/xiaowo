import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { extname, join } from 'node:path';
import { promisify } from 'node:util';

const sh = promisify(execFile);

export type RawStatus = 'saved' | 'organizing' | 'drafted' | 'failed' | 'confirmed' | 'discarded';
export interface Raw {
  id: string; clientId: string; createdAt: string; text: string; urls: string[];
  images: string[]; status: RawStatus; ocrText?: string;
}
export interface Draft {
  title: string; summary: string; keyPoints: string[]; tags: string[];
  sourceUrls: string[]; possibleDuplicateOf?: string;
}
export interface DraftRecord {
  id: string; rawId: string; version: number; draft: Draft | null;
  questions: string[]; status: 'pending' | 'confirmed' | 'discarded' | 'failed'; error?: string;
}
export interface Entry extends Draft { id: string; rawId: string; createdAt: string; rawText: string }

export interface RawInput {
  clientId: string; text: string; urls: string[];
  images: { name: string; data: Buffer }[];
}

const exists = (p: string) => fs.access(p).then(() => true, () => false);
const oneLine = (s: string) => s.replace(/\s*\n\s*/g, ' ').trim();

export class Store {
  private chain: Promise<unknown> = Promise.resolve();
  private ready: Promise<void>;

  constructor(readonly dataDir: string) {
    this.ready = this.init();
  }

  private async init() {
    await fs.mkdir(this.dataDir, { recursive: true });
    if (!(await exists(join(this.dataDir, '.git')))) await this.git('init', '-q');
  }

  private git(...args: string[]) {
    return sh('git', ['-c', 'user.name=life', '-c', 'user.email=life@localhost', ...args], { cwd: this.dataDir });
  }

  /** 串行化所有写操作，避免并发提交冲突 */
  private write<T>(message: string, fn: () => Promise<T>): Promise<T> {
    const run = async () => {
      await this.ready;
      const result = await fn();
      await this.git('add', '-A');
      const staged = await this.git('diff', '--cached', '--quiet').then(() => false, () => true);
      if (staged) await this.git('commit', '-q', '-m', message);
      return result;
    };
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private p(...parts: string[]) { return join(this.dataDir, ...parts); }
  private async readJson<T>(path: string): Promise<T | null> {
    try { return JSON.parse(await fs.readFile(path, 'utf8')) as T; } catch { return null; }
  }
  private newId() {
    const d = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    return `${d}-${randomBytes(2).toString('hex')}`;
  }

  async createRaw(input: RawInput): Promise<Raw> {
    await this.ready;
    const existing = (await this.listRaw()).find((r) => r.clientId === input.clientId);
    if (existing) return existing;
    const id = this.newId();
    return this.write(`收件: ${id}`, async () => {
      const dir = this.p('inbox', id);
      await fs.mkdir(dir, { recursive: true });
      const images: string[] = [];
      for (const [i, img] of input.images.entries()) {
        const name = `img-${i}${extname(img.name).toLowerCase() || '.png'}`;
        await fs.writeFile(join(dir, name), img.data);
        images.push(name);
      }
      const raw: Raw = {
        id, clientId: input.clientId, createdAt: new Date().toISOString(),
        text: input.text, urls: input.urls, images, status: 'saved',
      };
      await fs.writeFile(join(dir, 'raw.json'), JSON.stringify(raw, null, 2));
      return raw;
    });
  }

  getRaw(id: string) { return this.readJson<Raw>(this.p('inbox', id, 'raw.json')); }

  async updateRaw(id: string, patch: Partial<Raw>): Promise<Raw> {
    return this.write(`更新收件: ${id}`, async () => {
      const raw = await this.getRaw(id);
      if (!raw) throw new Error(`原料不存在: ${id}`);
      const next = { ...raw, ...patch, id: raw.id };
      await fs.writeFile(this.p('inbox', id, 'raw.json'), JSON.stringify(next, null, 2));
      return next;
    });
  }

  async listRaw(status?: RawStatus): Promise<Raw[]> {
    await this.ready;
    const ids = await fs.readdir(this.p('inbox')).catch(() => [] as string[]);
    const all = (await Promise.all(ids.map((id) => this.getRaw(id)))).filter((r): r is Raw => !!r);
    return all.filter((r) => !status || r.status === status).sort((a, b) => b.id.localeCompare(a.id));
  }

  async saveDraft(rec: DraftRecord): Promise<void> {
    await this.write(`草稿: ${rec.id} v${rec.version}`, async () => {
      await fs.mkdir(this.p('drafts'), { recursive: true });
      await fs.writeFile(this.p('drafts', `${rec.id}.json`), JSON.stringify(rec, null, 2));
    });
  }

  getDraft(id: string) { return this.readJson<DraftRecord>(this.p('drafts', `${id}.json`)); }

  async listDrafts(status?: DraftRecord['status']): Promise<DraftRecord[]> {
    await this.ready;
    const files = await fs.readdir(this.p('drafts')).catch(() => [] as string[]);
    const all = (await Promise.all(files.map((f) => this.readJson<DraftRecord>(this.p('drafts', f))))).filter((d): d is DraftRecord => !!d);
    return all.filter((d) => !status || d.status === status);
  }

  private renderEntry(e: Entry): string {
    return [
      '---',
      `title: ${oneLine(e.title)}`,
      `tags: ${JSON.stringify(e.tags)}`,
      `sources: ${JSON.stringify(e.sourceUrls)}`,
      `createdAt: ${e.createdAt}`,
      `rawId: ${e.rawId}`,
      '---',
      '',
      '## 摘要',
      e.summary,
      '',
      '## 要点',
      ...e.keyPoints.map((k) => `- ${oneLine(k)}`),
      '',
      '## 原始内容',
      e.rawText,
      '',
    ].join('\n');
  }

  private parseEntry(id: string, md: string): Entry {
    const [, front, body] = md.split(/^---\n|\n---\n/);
    const meta = Object.fromEntries(front.split('\n').map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 2)]));
    const rawIdx = body.indexOf('## 原始内容\n');
    const head = body.slice(0, rawIdx);
    const rawText = body.slice(rawIdx + '## 原始内容\n'.length).replace(/\n$/, '');
    const [, summaryPart, pointsPart] = head.split(/## 摘要\n|\n## 要点\n/);
    return {
      id, title: meta.title, tags: JSON.parse(meta.tags), sourceUrls: JSON.parse(meta.sources),
      createdAt: meta.createdAt, rawId: meta.rawId, summary: (summaryPart ?? '').replace(/\n+$/, ''),
      keyPoints: (pointsPart ?? '').split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2)),
      rawText,
    };
  }

  async confirmDraft(draftId: string, edited: Draft): Promise<{ entryId: string }> {
    return this.write(`入库: ${draftId}`, async () => {
      const rec = await this.getDraft(draftId);
      const raw = rec && (await this.getRaw(rec.rawId));
      if (!rec || !raw) throw new Error(`草稿不存在: ${draftId}`);
      const entry: Entry = { ...edited, id: draftId, rawId: raw.id, createdAt: new Date().toISOString(), rawText: raw.text };
      await fs.mkdir(this.p('entries'), { recursive: true });
      await fs.writeFile(this.p('entries', `${entry.id}.md`), this.renderEntry(entry));
      await fs.writeFile(this.p('drafts', `${draftId}.json`), JSON.stringify({ ...rec, status: 'confirmed' }, null, 2));
      await fs.writeFile(this.p('inbox', raw.id, 'raw.json'), JSON.stringify({ ...raw, status: 'confirmed' }, null, 2));
      return { entryId: entry.id };
    });
  }

  async getEntry(id: string): Promise<Entry | null> {
    try { return this.parseEntry(id, await fs.readFile(this.p('entries', `${id}.md`), 'utf8')); } catch { return null; }
  }

  async listEntries(): Promise<Entry[]> {
    await this.ready;
    const files = await fs.readdir(this.p('entries')).catch(() => [] as string[]);
    const all = await Promise.all(files.filter((f) => f.endsWith('.md')).map((f) => this.getEntry(f.slice(0, -3))));
    return all.filter((e): e is Entry => !!e).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async updateEntry(id: string, edited: Draft): Promise<Entry> {
    return this.write(`编辑条目: ${id}`, async () => {
      const cur = await this.getEntry(id);
      if (!cur) throw new Error(`条目不存在: ${id}`);
      const next: Entry = { ...cur, ...edited };
      await fs.writeFile(this.p('entries', `${id}.md`), this.renderEntry(next));
      return next;
    });
  }

  async discardDraft(draftId: string): Promise<void> {
    await this.write(`丢弃: ${draftId}`, async () => {
      const rec = await this.getDraft(draftId);
      if (rec) await fs.writeFile(this.p('drafts', `${draftId}.json`), JSON.stringify({ ...rec, status: 'discarded' }, null, 2));
      const raw = await this.getRaw(draftId);
      if (raw) await fs.writeFile(this.p('inbox', raw.id, 'raw.json'), JSON.stringify({ ...raw, status: 'discarded' }, null, 2));
    });
  }
}
