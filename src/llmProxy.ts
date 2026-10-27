/**
 * 模型转发服务：以 lifeagent 用户运行，只有它能读 DeepSeek 密钥。
 * 站点进程把已登录的 /api/llm/chat/completions 请求转给这里，这里换上密钥发往 DeepSeek，
 * 流式响应原样回传。站点进程始终拿不到密钥。
 *
 *   LLM_KEY_FILE=/var/lib/lifeagent/deepseek.key LLM_PORT=8791 node dist/llmProxy.js
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export interface ProxyConfig {
  upstream: string;          // 例如 https://api.deepseek.com
  key: () => string;         // 每次请求现读，换密钥不用重启
  models: Set<string>;
  maxBody: number;
}

const send = (res: ServerResponse, code: number, obj: unknown) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
};

async function readBody(req: IncomingMessage, max: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) {
    n += (c as Buffer).length;
    if (n > max) return null;
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}

export function createLlmProxy(cfg: ProxyConfig) {
  return createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/chat/completions') return send(res, 404, { error: 'not found' });
    const raw = await readBody(req, cfg.maxBody);
    if (!raw) return send(res, 413, { error: '请求太大' });
    let body: any;
    try { body = JSON.parse(raw.toString('utf8')); } catch { return send(res, 400, { error: '不是 JSON' }); }
    if (!body || !Array.isArray(body.messages)) return send(res, 400, { error: '缺少 messages' });
    if (!cfg.models.has(body.model)) return send(res, 400, { error: `不支持的模型：${String(body.model)}` });

    let key: string;
    try { key = cfg.key().trim(); } catch { key = ''; }
    if (!key) return send(res, 503, { error: '服务器上还没有配置 DeepSeek 密钥' });

    const ctrl = new AbortController();
    res.on('close', () => ctrl.abort()); // 浏览器点了停止
    try {
      // 只转发模型需要的字段，不带客户端的任何请求头
      const up = await fetch(`${cfg.upstream.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST', signal: ctrl.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
      });
      res.writeHead(up.status, {
        'content-type': up.headers.get('content-type') ?? 'application/json',
        'cache-control': 'no-cache',
      });
      if (!up.body) return res.end();
      for await (const chunk of up.body as unknown as AsyncIterable<Uint8Array>) res.write(chunk);
      res.end();
    } catch (e) {
      if (ctrl.signal.aborted) return;
      if (!res.headersSent) send(res, 502, { error: `连不上 DeepSeek：${e instanceof Error ? e.message : String(e)}` });
      else res.end();
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const env = process.env;
  const keyFile = env.LLM_KEY_FILE ?? '/var/lib/lifeagent/deepseek.key';
  const server = createLlmProxy({
    upstream: env.LLM_UPSTREAM ?? 'https://api.deepseek.com',
    key: () => (env.LLM_KEY_FILE === '-' ? env.LLM_KEY ?? '' : readFileSync(keyFile, 'utf8')),
    models: new Set((env.LLM_MODELS ?? 'deepseek-chat,deepseek-reasoner').split(',').map((s) => s.trim()).filter(Boolean)),
    maxBody: 4 * 1024 * 1024,
  });
  const port = Number(env.LLM_PORT ?? 8791);
  server.listen(port, '127.0.0.1', () => console.log(`模型转发已启动: 127.0.0.1:${port}`));
}
