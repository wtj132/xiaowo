import type { Context } from 'hono';

const MAX_BODY = 4 * 1024 * 1024;

/** 已登录的旅程助手请求 → 本机的模型转发服务（密钥只在那边）。 */
export function forwardLlm(proxyUrl: string) {
  return async (c: Context) => {
    if (!proxyUrl) return c.json({ error: '服务器上的助手还没配置（缺 LLM_PROXY_URL）' }, 503);
    const len = Number(c.req.header('content-length') ?? 0);
    if (len > MAX_BODY) return c.json({ error: '请求太大' }, 413);
    const body = await c.req.arrayBuffer();
    if (body.byteLength > MAX_BODY) return c.json({ error: '请求太大' }, 413);
    try {
      const up = await fetch(`${proxyUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST', body, signal: c.req.raw.signal,
        headers: { 'content-type': 'application/json' },
      });
      return new Response(up.body, {
        status: up.status,
        headers: { 'content-type': up.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-cache', 'x-accel-buffering': 'no' },
      });
    } catch {
      return c.json({ error: '服务器上的助手没有运行' }, 502);
    }
  };
}
