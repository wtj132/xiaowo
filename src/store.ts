import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { extname, join } from 'node:path';
import { promisify } from 'node:util';

import type { TripData, TripRecord } from './trips.js';

const sh = promisify(execFile);

export class RevConflict extends Error {
  constructor(readonly current: TripRecord) { super('旅程已在别处修改'); }
}

export type RawStatus = 'saved' | 'organizing' | 'drafted' | 'failed' | 'confirmed' | 'discarded';
export interface Raw {
  id: string; clientId: string; createdAt: string; text: string; urls: string[];
  images: string[]; status: RawStatus; ocrText?: string;
  /** 私密：不发给助手整理，文件不进 git（因此也不进 GitHub 备份） */
  private?: boolean;
}
/** 带类型、带理由的链接（卡片盒） */
export interface Link { to: string; type: string; reason: string }
/** 整理时提议拆出的卡片；主人勾选后才入库 */
export interface ProposedCard { title: string; draft: string; links: Link[] }
export interface Draft {
  title: string; summary: string; keyPoints: string[]; tags: string[];
  sourceUrls: string[]; possibleDuplicateOf?: string;
  /** 场景 id（scenes/<id>.md）；旧条目没有，视为 note */
  scene?: string; sceneAlt?: string[];
  /** 卡片上的一句话 */
  oneLine?: string;
  /** 这件事发生的日期，不同于入库时间 */
  date?: string;
  fields?: Record<string, unknown>;
  relations?: Link[];
  cards?: ProposedCard[];
}
export interface DraftRecord {
  id: string; rawId: string; version: number; draft: Draft | null;
  questions: string[]; status: 'pending' | 'confirmed' | 'discarded' | 'failed'; error?: string;
}
export interface Entry extends Draft { id: string; rawId: string; createdAt: string; rawText: string; ocrText?: string; private?: boolean }

export interface RawInput {
  clientId: string; text: string; urls: string[];
  images: { name: string; data: Buffer }[];
  private?: boolean;
}

const exists = (p: string) => fs.access(p).then(() => true, () => false);
const oneLine = (s: string) => s.replace(/\s*\n\s*/g, ' ').trim();
const SECTIONS = { summary: '摘要', points: '要点', raw: '原始内容', ocr: '图片文字' } as const;
type SectionName = keyof typeof SECTIONS;
const marker = (name: SectionName) => `<!--life:${name}-->\n## ${SECTIONS[name]}\n`;

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

  /** 原料、草稿、条目共用同一个 id；写进 .git/info/exclude（不随仓库提交），git 永远看不到这些文件。 */
  private async excludeFromGit(id: string) {
    const file = this.p('.git', 'info', 'exclude');
    await fs.mkdir(this.p('.git', 'info'), { recursive: true });
    await fs.appendFile(file, `\n/inbox/${id}/\n/drafts/${id}.json\n/entries/${id}.md\n`);
  }

  private p(...parts: string[]) { return join(this.dataDir, ...parts); }
  private async readJson<T>(path: string): Promise<T | null> {
    try { return JSON.parse(await fs.readFile(path, 'utf8')) as T; } catch { return null; }
  }
  private newId() {
    const d = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    return `${d}-${randomBytes(4).toString('hex')}`;
  }

  async createRaw(input: RawInput): Promise<Raw> {
    return (await this.createRawOnce(input)).raw;
  }

  /** 查重与创建在同一个串行写入里完成：相同 clientId 并发提交也只会产生一份。 */
  async createRawOnce(input: RawInput): Promise<{ raw: Raw; created: boolean }> {
    return this.write(`收件`, async () => {
      const existing = (await this.listRaw()).find((r) => r.clientId === input.clientId);
      if (existing) return { raw: existing, created: false };
      const id = this.newId();
      if (input.private) await this.excludeFromGit(id);
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
        ...(input.private ? { private: true } : {}),
      };
      await fs.writeFile(join(dir, 'raw.json'), JSON.stringify(raw, null, 2));
      return { raw, created: true };
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
      ...(e.private ? ['private: true'] : []),
      ...(e.scene ? [`scene: ${e.scene}`] : []),
      ...(e.oneLine ? [`oneLine: ${oneLine(e.oneLine)}`] : []),
      ...(e.date ? [`date: ${e.date}`] : []),
      ...(e.fields && Object.keys(e.fields).length ? [`fields: ${JSON.stringify(e.fields)}`] : []),
      ...(e.relations?.length ? [`relations: ${JSON.stringify(e.relations)}`] : []),
      ...(e.possibleDuplicateOf ? [`duplicateOf: ${oneLine(e.possibleDuplicateOf)}`] : []),
      '---',
      '',
      `${marker('summary')}${e.summary}`,
      `${marker('points')}${e.keyPoints.map((k) => `- ${oneLine(k)}`).join('\n')}`,
      `${marker('raw')}${e.rawText}`,
      `${marker('ocr')}${e.ocrText ?? ''}`,
      '',
    ].join('\n');
  }

  /** 章节用不可见的注释标记切分，正文里出现 ---、## 标题都不会影响解析。 */
  private parseEntry(id: string, md: string): Entry {
    const end = md.indexOf('\n---\n', 4);
    const meta = Object.fromEntries(md.slice(4, end).split('\n').map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 2)]));
    const body = md.slice(end + 5).replace(/^\n/, '');
    const at = (name: SectionName, from: number) => body.indexOf(marker(name), from);
    const sStart = at('summary', 0);
    const pStart = body.indexOf(`\n${marker('points')}`, sStart);
    const rStart = body.indexOf(`\n${marker('raw')}`, pStart);
    const oStart = body.lastIndexOf(`\n${marker('ocr')}`);
    const slice = (from: number, mark: SectionName, to: number) => body.slice(from + (from === sStart ? 0 : 1) + marker(mark).length, to);
    const summary = slice(sStart, 'summary', pStart);
    const points = slice(pStart, 'points', rStart);
    const rawText = slice(rStart, 'raw', oStart);
    const ocr = body.slice(oStart + 1 + marker('ocr').length).replace(/\n$/, '');
    return {
      id, title: meta.title, tags: JSON.parse(meta.tags), sourceUrls: JSON.parse(meta.sources),
      createdAt: meta.createdAt, rawId: meta.rawId, summary,
      keyPoints: points.split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2)),
      rawText, ...(ocr ? { ocrText: ocr } : {}),
      ...(meta.duplicateOf ? { possibleDuplicateOf: meta.duplicateOf } : {}),
      ...(meta.private === 'true' ? { private: true } : {}),
      ...(meta.scene ? { scene: meta.scene } : {}),
      ...(meta.oneLine ? { oneLine: meta.oneLine } : {}),
      ...(meta.date ? { date: meta.date } : {}),
      ...(meta.fields ? { fields: JSON.parse(meta.fields) } : {}),
      ...(meta.relations ? { relations: JSON.parse(meta.relations) } : {}),
    };
  }

  async confirmDraft(draftId: string, edited: Draft, cards: { title: string; idea: string; links: Link[] }[] = []): Promise<{ entryId: string; cardIds: string[] }> {
    return this.write(`入库: ${draftId}`, async () => {
      const rec = await this.getDraft(draftId);
      const raw = rec && (await this.getRaw(rec.rawId));
      if (!rec || !raw) throw new Error(`草稿不存在: ${draftId}`);
      const { cards: _proposed, sceneAlt: _alt, ...kept } = edited;
      const now = new Date().toISOString();
      const entry: Entry = { ...kept, id: draftId, rawId: raw.id, createdAt: now, rawText: raw.text, ocrText: raw.ocrText, ...(raw.private ? { private: true } : {}) };
      await fs.mkdir(this.p('entries'), { recursive: true });
      await fs.writeFile(this.p('entries', `${entry.id}.md`), this.renderEntry(entry));
      // 拆出的卡片：各自成条，链回出处
      const cardIds: string[] = [];
      for (const c of cards) {
        const id = this.newId();
        const card: Entry = {
          id, rawId: raw.id, createdAt: now, rawText: '', title: c.title, summary: c.idea, keyPoints: [], tags: entry.tags.slice(0, 3),
          sourceUrls: [], scene: 'card', oneLine: c.title, date: entry.date, fields: { idea: c.idea, source: entry.title },
          relations: [{ to: entry.id, type: '出处', reason: '从这条文献笔记里拆出来' }, ...c.links],
          ...(raw.private ? { private: true } : {}),
        };
        await fs.writeFile(this.p('entries', `${id}.md`), this.renderEntry(card));
        cardIds.push(id);
      }
      await fs.writeFile(this.p('drafts', `${draftId}.json`), JSON.stringify({ ...rec, status: 'confirmed' }, null, 2));
      await fs.writeFile(this.p('inbox', raw.id, 'raw.json'), JSON.stringify({ ...raw, status: 'confirmed' }, null, 2));
      return { entryId: entry.id, cardIds };
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
      const raw = await this.getRaw(cur.rawId);
      const next: Entry = { ...cur, ...edited, rawText: raw?.text ?? cur.rawText, ocrText: raw?.ocrText ?? cur.ocrText };
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

  // ---------------------------------------------------------------- 旅程
  getTrip(id: string) { return this.readJson<TripRecord>(this.p('trips', `${id}.json`)); }

  async listTrips(): Promise<TripRecord[]> {
    await this.ready;
    const files = await fs.readdir(this.p('trips')).catch(() => [] as string[]);
    const all = await Promise.all(files.filter((f) => f.endsWith('.json')).map((f) => this.getTrip(f.slice(0, -5))));
    return all.filter((t): t is TripRecord => !!t);
  }

  async createTrip(data: TripData): Promise<TripRecord> {
    const name = typeof data.name === 'string' ? oneLine(data.name).slice(0, 40) : '旅程';
    return this.write(`新旅程: ${name}`, async () => {
      const rec: TripRecord = { id: this.newId(), rev: 1, updatedAt: new Date().toISOString(), data };
      await fs.mkdir(this.p('trips'), { recursive: true });
      await fs.writeFile(this.p('trips', `${rec.id}.json`), JSON.stringify(rec, null, 2));
      return rec;
    });
  }

  /** baseRev 与当前不一致时抛 RevConflict，不覆盖别处的修改。 */
  async saveTrip(id: string, data: TripData, baseRev: number, label = ''): Promise<TripRecord> {
    return this.write(`旅程: ${id} ${label}`.trim(), async () => {
      const cur = await this.getTrip(id);
      if (!cur) throw new Error(`旅程不存在: ${id}`);
      if (cur.rev !== baseRev) throw new RevConflict(cur);
      const next: TripRecord = { id, rev: cur.rev + 1, updatedAt: new Date().toISOString(), ...(label ? { label } : {}), data };
      await fs.writeFile(this.p('trips', `${id}.json`), JSON.stringify(next, null, 2));
      return next;
    });
  }

  /** 旅程的历史版本直接取自 git：每次保存都是一次提交。 */
  async tripHistory(id: string, limit = 60): Promise<TripRecord[]> {
    await this.chain; // 等正在进行的写入提交完
    const path = `trips/${id}.json`;
    const log = await this.git('log', `-n${limit}`, '--format=%H', '--', path).then((r) => r.stdout, () => '');
    const out: TripRecord[] = [];
    for (const hash of log.split('\n').filter(Boolean)) {
      try { out.push(JSON.parse((await this.git('show', `${hash}:${path}`)).stdout) as TripRecord); } catch { /* 删除提交等 */ }
    }
    return out;
  }

  /** 旅程附带的小数据（助手设置、对话），可能含模型密钥：只放在服务器磁盘上，永不进 git。 */
  private kvPath(id: string, name: string) { return this.p('.trip-kv', id, `${name}.json`); }
  async getTripKv(id: string, name: string): Promise<unknown> {
    return (await this.readJson<{ data: unknown }>(this.kvPath(id, name)))?.data ?? null;
  }
  async putTripKv(id: string, name: string, data: unknown): Promise<void> {
    await this.ready;
    await fs.mkdir(this.p('.trip-kv', id), { recursive: true, mode: 0o700 });
    await this.ensureExcluded('/.trip-kv/');
    const file = this.kvPath(id, name);
    await fs.writeFile(`${file}.tmp`, JSON.stringify({ data }), { mode: 0o600 });
    await fs.rename(`${file}.tmp`, file);
  }
  private async ensureExcluded(pattern: string) {
    const file = this.p('.git', 'info', 'exclude');
    const cur = await fs.readFile(file, 'utf8').catch(() => '');
    if (cur.split('\n').includes(pattern)) return;
    await fs.mkdir(this.p('.git', 'info'), { recursive: true });
    await fs.appendFile(file, `\n${pattern}\n`);
  }

  async deleteTrip(id: string): Promise<void> {
    await this.write(`删除旅程: ${id}`, async () => { await fs.rm(this.p('trips', `${id}.json`), { force: true }); });
  }
}
