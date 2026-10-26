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
  app.use('*', serveStatic({ root: './public' }));

  await queue.recover();
  const close = async () => { await dsh.close(); await search.close(); };
  return { app, queue, store, close };
}

/** 本地界面调试：不调用 DeepSeek，用原文生成一份假草稿。 */
function fakeOrganizerDeps(): Partial<AppDeps> {
  const dsh = new FakeDsh((prompt) => {
    const text = prompt.split('## 用户原文\n')[1]?.split('\n')[0] ?? '随手记';
    return JSON.stringify({
      title: text.slice(0, 20) || '未命名', summary: `（假数据）${text}`,
      keyPoints: ['要点一', '要点二'], tags: ['示例'],
      questions: text.length < 10 ? ['这是什么？能用一句话说明吗？'] : [],
    });
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
