import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { authMiddleware, loginRoute } from '../src/auth.js';
import type { Config } from '../src/config.js';

const cfg = { password: 'secret-pw', apiToken: 'tok123', trustProxy: true } as Config;
function app() {
  const a = new Hono();
  a.use('*', authMiddleware(cfg));
  a.post('/api/login', loginRoute(cfg));
  a.get('/api/inbox', (c) => c.json({ ok: true }));
  a.post('/api/capture', (c) => c.json({ ok: true }));
  a.get('/manifest.webmanifest', (c) => c.text('m'));
  return a;
}
const login = (a: Hono, password: string, ip = '1.1.1.1') =>
  a.request('/api/login', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ password }),
  });

describe('auth', () => {
  it('rejects requests without credentials', async () => {
    expect((await app().request('/api/inbox')).status).toBe(401);
  });
  it('rejects a wrong password', async () => {
    expect((await login(app(), 'nope')).status).toBe(401);
  });
  it('accepts the right password and the cookie unlocks the API', async () => {
    const a = app();
    const res = await login(a, 'secret-pw');
    expect(res.status).toBe(200);
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    const ok = await a.request('/api/inbox', { headers: { cookie: cookie.split(';')[0] } });
    expect(ok.status).toBe(200);
  });
  it('rejects a forged cookie', async () => {
    const res = await app().request('/api/inbox', { headers: { cookie: 'session=abc.def' } });
    expect(res.status).toBe(401);
  });
  it('accepts the bearer token', async () => {
    const res = await app().request('/api/capture', { method: 'POST', headers: { authorization: 'Bearer tok123' } });
    expect(res.status).toBe(200);
  });
  it('does not let a percent-encoded /api path skip auth', async () => {
    const a = app();
    for (const p of ['/%61pi/inbox', '/%61pi/capture']) {
      const res = await a.request(p, { method: p.endsWith('capture') ? 'POST' : 'GET' });
      expect([401, 404]).toContain(res.status);
    }
  });
  it('rate limits wrong bearer tokens too', async () => {
    const a = app();
    for (let i = 0; i < 10; i++) await a.request('/api/inbox', { headers: { authorization: 'Bearer wrong', 'x-forwarded-for': '7.7.7.7' } });
    const res = await a.request('/api/inbox', { headers: { authorization: 'Bearer tok123', 'x-forwarded-for': '7.7.7.7' } });
    expect(res.status).toBe(429);
  });
  it('lets the manifest through without auth', async () => {
    expect((await app().request('/manifest.webmanifest')).status).toBe(200);
  });
  it('rate limits after 10 wrong passwords from one IP', async () => {
    const a = app();
    for (let i = 0; i < 10; i++) await login(a, 'bad', '9.9.9.9');
    expect((await login(a, 'bad', '9.9.9.9')).status).toBe(429);
    expect((await login(a, 'secret-pw', '9.9.9.9')).status).toBe(429);
    expect((await login(a, 'secret-pw', '8.8.8.8')).status).toBe(200);
  });
});
