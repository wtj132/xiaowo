import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 场景：每类东西记什么、问什么、怎么看，写在 scenes/<id>.md 里（头部是 JSON，正文是给助手的整理要求）。
 * 加场景、改字段只改文件，不改代码。
 */
export type FieldType = 'text' | 'longtext' | 'number' | 'enum' | 'date' | 'stars' | 'list';
export interface Field {
  key: string; label: string; type: FieldType;
  required?: boolean; options?: string[]; default?: string; hint?: string;
}
export interface Scene {
  id: string; name: string; group: 'taste' | 'knowledge' | 'life' | 'other'; color: string;
  detect: string; fields: Field[]; ask: string[]; enrich: string; card: string;
  /** 文献笔记类场景：整理时提议拆出卡片 */
  cards?: boolean;
  /** 给助手的整理要求（文件正文） */
  guide: string;
}
export interface SceneSet { persona: string; list: Scene[]; byId: Map<string, Scene>; fallback: Scene }

const TYPES = new Set<FieldType>(['text', 'longtext', 'number', 'enum', 'date', 'stars', 'list']);

export function parseScene(file: string, src: string): Scene {
  const m = src.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error(`${file}: 缺少 --- 包起来的头部`);
  let head: any;
  try { head = JSON.parse(m[1]); } catch (e) { throw new Error(`${file}: 头部不是合法 JSON（${(e as Error).message}）`); }
  if (typeof head.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(head.id)) throw new Error(`${file}: id 不合法`);
  const fields: Field[] = Array.isArray(head.fields) ? head.fields : [];
  for (const f of fields) {
    if (!f.key || !f.label || !TYPES.has(f.type)) throw new Error(`${file}: 字段 ${JSON.stringify(f)} 不合法`);
    if (f.type === 'enum' && !Array.isArray(f.options)) throw new Error(`${file}: 枚举字段 ${f.key} 缺 options`);
  }
  return {
    id: head.id, name: String(head.name ?? head.id), group: head.group ?? 'other', color: String(head.color ?? '#b9b4ab'),
    detect: String(head.detect ?? ''), fields, ask: Array.isArray(head.ask) ? head.ask : [], enrich: String(head.enrich ?? ''),
    card: String(head.card ?? 'note'), cards: head.cards === true, guide: m[2].trim(),
  };
}

export function loadScenes(dir: string): SceneSet {
  const files = readdirSync(dir).filter((f) => f.endsWith('.md') && !f.startsWith('_')).sort();
  const list = files.map((f) => parseScene(f, readFileSync(join(dir, f), 'utf8')));
  const byId = new Map(list.map((s) => [s.id, s]));
  const fallback = byId.get('note');
  if (!fallback) throw new Error('scenes/ 里必须有兜底场景 note.md');
  let persona = '';
  try { persona = readFileSync(join(dir, '_persona.md'), 'utf8').trim(); } catch { /* 没有性格文件也能跑 */ }
  return { persona, list, byId, fallback };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 把助手（或表单）给的字段值按场景定义收拾干净；不认识的键丢掉。 */
export function cleanFields(scene: Scene, raw: unknown): Record<string, unknown> {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const out: Record<string, unknown> = {};
  for (const f of scene.fields) {
    const v = src[f.key];
    if (v === undefined || v === null || v === '') {
      if (f.default !== undefined && f.type === 'enum') out[f.key] = f.default;
      continue;
    }
    switch (f.type) {
      case 'number': { const n = Number(v); if (Number.isFinite(n)) out[f.key] = n; break; }
      case 'stars': { const n = Math.round(Number(v)); if (n >= 1 && n <= 5) out[f.key] = n; break; }
      case 'list': {
        const arr = (Array.isArray(v) ? v : String(v).split('\n')).map((x) => String(x).trim()).filter(Boolean);
        if (arr.length) out[f.key] = arr;
        break;
      }
      case 'enum': out[f.key] = f.options!.includes(String(v)) ? String(v) : (f.default ?? f.options![0]); break;
      case 'date': if (DATE_RE.test(String(v))) out[f.key] = String(v); break;
      default: { const s = String(v).trim(); if (s) out[f.key] = s; }
    }
  }
  return out;
}

/** 提示词里描述一个场景的字段 */
export function describeFields(scene: Scene): string {
  if (!scene.fields.length) return '（这个场景没有专属字段，fields 给 {}）';
  return scene.fields.map((f) => {
    const kind = f.type === 'enum' ? `取值之一：${f.options!.join(' / ')}`
      : f.type === 'stars' ? '1–5 的整数' : f.type === 'list' ? '字符串数组' : f.type === 'number' ? '数字'
      : f.type === 'date' ? 'YYYY-MM-DD' : '字符串';
    return `- ${f.key}（${f.label}）：${kind}${f.required ? '，必填' : ''}${f.hint ? `；${f.hint}` : ''}`;
  }).join('\n');
}

let repo: SceneSet | null = null;
/** 仓库里的 scenes/（与 src/、dist/ 同级），读一次缓存 */
export const repoScenes = () => (repo ??= loadScenes(fileURLToPath(new URL('../scenes', import.meta.url))));

/** 知识类场景整理时提议拆出卡片（卡片本身除外） */
export const proposesCards = (scene: Scene) => scene.cards === true || (scene.group === 'knowledge' && scene.id !== 'card');
