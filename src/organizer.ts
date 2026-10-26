import { join } from 'node:path';
import type { DshClient } from './dsh.js';
import type { SearchClient } from './search.js';
import type { Draft, Raw, Store } from './store.js';

export interface OrganizerDeps {
  store: Store;
  dsh: DshClient;
  search: SearchClient;
  ocr: (imagePath: string) => Promise<string>;
}

export interface OrganizeResult { draft: Draft; questions: string[] }

const THIN_MATERIAL_CHARS = 500;
const PAGE_CLIP = 8000;
const RESEARCH_CLIP = 6000;

const INSTRUCTIONS = `你是用户的私人知识整理助手。用户随手丢进来一些原料（链接、截图文字、几句话），请整理成一条可长期查阅的"使用说明/介绍"。
要求：
- 输出语言必须是中文；英文材料请翻译概括，并在 summary 或 keyPoints 里保留原文链接。
- 只输出一个 JSON 对象，不要输出别的文字。字段：
  title（简短标题）、summary（一段话说明这是什么、有什么用）、keyPoints（字符串数组，关键信息/步骤/用法/代码思路）、tags（3-6 个中文或常用英文标签）、questions（字符串数组）。
  如与下列"已有条目"高度相似，再加字段 possibleDuplicateOf，值为该条目的 id；否则不要这个字段。
- 材料不足以写出可靠内容时，在 questions 里提最多 3 个让用户一句话就能回答的简单问题；但无论如何都要尽力给出完整草稿，不能只提问。
- 不要编造材料里没有的事实；不确定的地方写进 questions。`;

/** 从模型输出中取第一个平衡的 JSON 对象（容忍代码围栏和前后说明）。 */
export function parseDraftJson(text: string): unknown {
  const start = text.indexOf('{');
  if (start < 0) throw new Error('模型没有返回 JSON');
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  throw new Error('模型返回的 JSON 不完整');
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : []);

export async function organize(raw: Raw, deps: OrganizerDeps, note?: string): Promise<OrganizeResult> {
  const { store, dsh, search, ocr } = deps;
  const extraQuestions: string[] = [];

  const ocrParts: string[] = [];
  for (const name of raw.images) {
    try {
      const text = await ocr(join(store.dataDir, 'inbox', raw.id, name));
      if (text) ocrParts.push(text);
    } catch {
      extraQuestions.push('有一张图片没能识别出文字，能用一句话说明它是什么吗？');
    }
  }
  const ocrText = ocrParts.join('\n\n');
  if (ocrText !== (raw.ocrText ?? '')) await store.updateRaw(raw.id, { ocrText });

  const pages: string[] = [];
  const titles: string[] = [];
  for (const url of raw.urls) {
    const page = await search.fetchPage(url);
    if (page.ok && page.markdown) {
      pages.push(`### 网页 ${url}\n${page.markdown.slice(0, PAGE_CLIP)}`);
      if (page.title) titles.push(page.title);
    } else {
      extraQuestions.push(`没能打开链接 ${url}（${page.error ?? '未知原因'}），能用一句话说明它是什么吗？`);
    }
  }

  let researchMd = '';
  const size = raw.text.length + ocrText.length + pages.join('').length;
  if (size < THIN_MATERIAL_CHARS) {
    const query = [titles[0], raw.text.split('\n')[0], raw.urls[0]].find((q) => q && q.trim())?.slice(0, 200);
    if (query) {
      const r = await search.research(query);
      if (r.ok && r.markdown) researchMd = r.markdown.slice(0, RESEARCH_CLIP);
    }
  }

  const existing = (await store.listEntries()).slice(0, 50).map((e) => `- ${e.id}: ${e.title}`).join('\n');
  const prompt = [
    INSTRUCTIONS,
    note ? `\n用户对这次整理的补充/要求：${note}` : '',
    `\n## 已有条目\n${existing || '（无）'}`,
    `\n## 用户原文\n${raw.text || '（无）'}`,
    raw.urls.length ? `\n## 链接\n${raw.urls.join('\n')}` : '',
    ocrText ? `\n## 图片中识别出的文字\n${ocrText}` : '',
    pages.length ? `\n## 抓取到的网页内容\n${pages.join('\n\n')}` : '',
    researchMd ? `\n## 联网查到的补充资料\n${researchMd}` : '',
  ].join('\n');

  const parsed = parseDraftJson(await dsh.ask(prompt)) as Record<string, unknown>;
  if (typeof parsed.title !== 'string' || typeof parsed.summary !== 'string') throw new Error('草稿缺少 title 或 summary');

  const draft: Draft = {
    title: parsed.title,
    summary: parsed.summary,
    keyPoints: strings(parsed.keyPoints),
    tags: strings(parsed.tags),
    sourceUrls: raw.urls,
    ...(typeof parsed.possibleDuplicateOf === 'string' ? { possibleDuplicateOf: parsed.possibleDuplicateOf } : {}),
  };
  const questions = [...new Set([...strings(parsed.questions), ...extraQuestions])].slice(0, 5);
  return { draft, questions };
}
