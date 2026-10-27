import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { forwardLlm } from '../src/llmForward.js';
import { createLlmProxy } from '../src/llmProxy.js';

let upstream: Server, proxy: Server, seen: { auth?: string; body?: any; cookie?: string }[], key: string;
const url = (s: Server) => `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
const listen = (s: Server) => new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));

beforeEach(async () => {
  seen = []; key = 'sk-test-key';
  upstream = createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    seen.push({ auth: req.headers.authorization, cookie: req.headers.cookie, body: JSON.parse(raw) });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"content":"你好"}}]}\n\n');
    res.end('data: [DONE]\n\n');
  });
  await listen(upstream);
  proxy = createLlmProxy({ upstream: url(upstream), key: () => key, models: new Set(['deepseek-chat']), maxBody: 1024 * 1024 });
  await listen(proxy);
});
afterEach(() => { upstream.close(); proxy.close(); });

const ask = (body: unknown, base = url(proxy), headers: Record<string, string> = {}) =>
  fetch(`${base}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const chat = { model: 'deepseek-chat', stream: true, messages: [{ role: 'user', content: 'hi' }] };

describe('llm proxy (lifeagent side)', () => {
  it('adds the key, drops client headers and streams the answer back', async () => {
    const res = await ask(chat, url(proxy), { cookie: 'life=secret', authorization: 'Bearer from-browser' });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('你好');
    expect(seen[0].auth).toBe('Bearer sk-test-key');
    expect(seen[0].cookie).toBeUndefined();
  });
  it('refuses models outside the allowlist', async () => {
    expect((await ask({ ...chat, model: 'gpt-4o' })).status).toBe(400);
    expect(seen).toHaveLength(0);
  });
  it('says so when no key is configured', async () => {
    key = '';
    expect((await ask(chat)).status).toBe(503);
  });
  it('only serves POST /chat/completions', async () => {
    expect((await fetch(`${url(proxy)}/models`)).status).toBe(404);
  });
});

describe('site forward route', () => {
  it('returns 503 when no proxy is configured', async () => {
    const app = new Hono().post('/api/llm/chat/completions', forwardLlm(''));
    expect((await app.request('/api/llm/chat/completions', { method: 'POST', body: '{}' })).status).toBe(503);
  });
  it('passes the stream through from the proxy', async () => {
    const app = new Hono().post('/api/llm/chat/completions', forwardLlm(url(proxy)));
    const res = await app.request('/api/llm/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(chat) });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('[DONE]');
  });
});
