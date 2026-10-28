import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { pathToFileURL } from 'node:url';
import { createApi } from './api.js';
import { authMiddleware, loginRoute } from './auth.js';
import { loadConfig, type Config } from './config.js';
import { createDshClient, FakeDsh, type DshClient } from './dsh.js';
import { ocrImage } from './ocr.js';
import type { OrganizerDeps } from './organizer.js';
import { Queue } from './queue.js';
import { createTripSync } from './tripSync.js';
import { forwardLlm } from './llmForward.js';
import { createSearchClient, FakeSearch, type SearchClient } from './search.js';
import { Store } from './store.js';

export interface AppDeps {
  dsh: DshClient;
  search: SearchClient;
  ocr: OrganizerDeps['ocr'];
}

export async function createApp(cfg: Config, deps?: Partial<AppDeps>) {
  const store = new Store(cfg.dataDir);
  const dsh = deps?.dsh ?? createDshClient(cfg);
  const search = deps?.search ?? createSearchClient(cfg.searchCmd);
  const ocr = deps?.ocr ?? ((p: string) => ocrImage(p, cfg.tesseractLangs));
  const queue = new Queue({ store, dsh, search, ocr });

  const app = new Hono();
  app.use('*', authMiddleware(cfg));
  app.post('/api/login', loginRoute(cfg));
  app.route('/', createApi({ store, enqueue: (id) => queue.enqueue(id), redo: (id, note) => queue.redo(id, note) }));
  app.route('/', createTripSync(store));
  app.post('/api/llm/chat/completions', forwardLlm(cfg.llmProxyUrl));
  // 每次都让浏览器回来确认文件有没有变（没变只回 304），部署后不会卡在旧版
  app.use('*', serveStatic({ root: './public', onFound: (_path, c) => { c.header('Cache-Control', 'no-cache'); } }));

  await queue.recover();
  const close = async () => { await dsh.close(); await search.close(); };
  return { app, queue, store, close };
}

/** 本地界面调试：不调用 DeepSeek，按关键词假装认场景、填字段。 */
function fakeOrganizerDeps(): Partial<AppDeps> {
  const dsh = new FakeDsh((prompt) => {
    const text = prompt.match(/<<<资料开始:用户原文>>>\n([\s\S]*?)\n<<<资料结束/)?.[1] ?? '随手记';
    const guess = /《|电影|剧|二刷/.test(text) ? 'film' : /书|划线|在读/.test(text) ? 'book' : /报错|坑|失败/.test(text) ? 'bug' : /论文|arxiv|paper/i.test(text) ? 'paper' : 'note';
    if (prompt.startsWith('## 识别场景')) return JSON.stringify({ scene: guess, confidence: guess === 'note' ? 0.4 : 0.9, alternatives: ['card'] });
    const scene = prompt.match(/整理一条「(.+?)」/)?.[1];
    const base = { title: text.slice(0, 20) || '未命名', oneLine: text.slice(0, 30), summary: `（假数据）${text}`, keyPoints: [], tags: ['示例'] };
    if (scene === '影视') return JSON.stringify({ ...base, title: text.match(/《(.+?)》/)?.[1] ?? base.title, fields: { work: text.match(/《(.+?)》/)?.[1] ?? '某片', year: 2000, creator: '某导演', status: '看完' }, questions: [] });
    if (scene === '踩坑') return JSON.stringify({ ...base, fields: { symptom: text, stack: 'Node' }, questions: [] });
    if (scene === '论文') {
      const old = prompt.match(/^- (\d{8}-\d{6}-[0-9a-f]{8}): /m)?.[1];
      return JSON.stringify({ ...base, fields: { problem: '（假数据）要解决的问题', method: '（假数据）方法' }, questions: ['你为什么存它？'],
        cards: [{ title: '（假数据）一个可以脱离论文读懂的观点', draft: '一两句初稿', links: old ? [{ to: old, type: '同主题', reason: '（假数据）都在讲评测' }] : [] }] });
    }
    return JSON.stringify({ ...base, keyPoints: ['要点一', '要点二'], questions: text.length < 10 ? ['这是什么？能用一句话说明吗？'] : [] });
  });
  return { dsh, search: new FakeSearch(), ocr: async () => '' };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const cfg = loadConfig(process.env);
  const { app, close } = await createApp(cfg, process.env.FAKE_ORGANIZER ? fakeOrganizerDeps() : undefined);
  const server = serve({ fetch: app.fetch, port: cfg.port, hostname: process.env.HOST ?? '127.0.0.1' }, (info) =>
    console.log(`life 已启动: http://${process.env.HOST ?? '127.0.0.1'}:${info.port}`));
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, async () => { server.close(); await close(); process.exit(0); });
  }
}
