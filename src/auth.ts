import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Context, Handler, MiddlewareHandler } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { Config } from './config.js';

const COOKIE = 'session';
const MAX_AGE_S = 90 * 24 * 3600;
const MAX_FAILS = 10;
const WINDOW_MS = 15 * 60 * 1000;

const sign = (cfg: Config, payload: string) =>
  createHmac('sha256', `session:${cfg.password}`).update(payload).digest('hex');

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function validSession(cfg: Config, value: string | undefined): boolean {
  if (!value) return false;
  const [exp, mac] = value.split('.');
  if (!exp || !mac || Number(exp) < Date.now() / 1000) return false;
  return safeEqual(sign(cfg, exp), mac);
}

const clientIp = (c: Context) => c.req.header('x-forwarded-for')?.split(',')[0].trim() || 'local';

/** 仅 /api/* 需要鉴权（登录除外）；静态页面本身不含数据。 */
export function authMiddleware(cfg: Config): MiddlewareHandler {
  return async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (!path.startsWith('/api/') || path === '/api/login') return next();
    const bearer = c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
    if ((bearer && safeEqual(bearer, cfg.apiToken)) || validSession(cfg, getCookie(c, COOKIE))) return next();
    return c.json({ error: '未登录' }, 401);
  };
}

export function loginRoute(cfg: Config): Handler {
  const fails = new Map<string, { count: number; since: number }>();
  return async (c) => {
    const ip = clientIp(c);
    const now = Date.now();
    const f = fails.get(ip);
    if (f && now - f.since > WINDOW_MS) fails.delete(ip);
    if ((fails.get(ip)?.count ?? 0) >= MAX_FAILS) return c.json({ error: '尝试次数过多，请稍后再试' }, 429);

    const body = await c.req.json().catch(() => ({}));
    if (typeof body.password !== 'string' || !safeEqual(body.password, cfg.password)) {
      const cur = fails.get(ip) ?? { count: 0, since: now };
      fails.set(ip, { count: cur.count + 1, since: cur.since });
      return c.json({ error: '口令不对' }, 401);
    }
    fails.delete(ip);
    const exp = String(Math.floor(now / 1000) + MAX_AGE_S);
    const https = new URL(c.req.url).protocol === 'https:' || c.req.header('x-forwarded-proto') === 'https';
    setCookie(c, COOKIE, `${exp}.${sign(cfg, exp)}`, {
      httpOnly: true, sameSite: 'Lax', secure: https, path: '/', maxAge: MAX_AGE_S,
    });
    return c.json({ ok: true });
  };
}
