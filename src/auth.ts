import { createHmac, timingSafeEqual } from 'node:crypto';
import { getConnInfo } from '@hono/node-server/conninfo';
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

/** 只有在反向代理会覆盖该头时才信任 X-Forwarded-For（TRUST_PROXY=1）；否则用套接字地址。 */
function clientIp(cfg: Config, c: Context): string {
  if (cfg.trustProxy) return c.req.header('x-forwarded-for')?.split(',').pop()?.trim() || 'local';
  try { return getConnInfo(c).remote.address ?? 'local'; } catch { return 'local'; }
}

class Limiter {
  private fails = new Map<string, { count: number; since: number }>();
  blocked(ip: string): boolean {
    const f = this.fails.get(ip);
    if (f && Date.now() - f.since > WINDOW_MS) this.fails.delete(ip);
    return (this.fails.get(ip)?.count ?? 0) >= MAX_FAILS;
  }
  fail(ip: string) {
    const cur = this.fails.get(ip) ?? { count: 0, since: Date.now() };
    this.fails.set(ip, { count: cur.count + 1, since: cur.since });
  }
  clear(ip: string) { this.fails.delete(ip); }
}
const limiters = new WeakMap<Config, Limiter>();
const limiterFor = (cfg: Config) => {
  let l = limiters.get(cfg);
  if (!l) limiters.set(cfg, (l = new Limiter()));
  return l;
};

/** 路径用 Hono 解码后的 c.req.path，与路由匹配一致，避免 /%61pi 之类绕过。 */
export function authMiddleware(cfg: Config): MiddlewareHandler {
  const limiter = limiterFor(cfg);
  return async (c, next) => {
    const path = c.req.path;
    if (!path.startsWith('/api/') || path === '/api/login') return next();
    const ip = clientIp(cfg, c);
    if (limiter.blocked(ip)) return c.json({ error: '尝试次数过多，请稍后再试' }, 429);
    const bearer = c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
    if (bearer) {
      if (safeEqual(bearer, cfg.apiToken)) return next();
      limiter.fail(ip);
    }
    if (validSession(cfg, getCookie(c, COOKIE))) return next();
    return c.json({ error: '未登录' }, 401);
  };
}

export function loginRoute(cfg: Config): Handler {
  const limiter = limiterFor(cfg);
  return async (c) => {
    const ip = clientIp(cfg, c);
    if (limiter.blocked(ip)) return c.json({ error: '尝试次数过多，请稍后再试' }, 429);

    const body = (await c.req.json().catch(() => null)) ?? {};
    if (typeof body.password !== 'string' || !safeEqual(body.password, cfg.password)) {
      limiter.fail(ip);
      return c.json({ error: '口令不对' }, 401);
    }
    limiter.clear(ip);
    const exp = String(Math.floor(Date.now() / 1000) + MAX_AGE_S);
    const https = new URL(c.req.url).protocol === 'https:' || c.req.header('x-forwarded-proto') === 'https';
    setCookie(c, COOKIE, `${exp}.${sign(cfg, exp)}`, {
      httpOnly: true, sameSite: 'Lax', secure: https, path: '/', maxAge: MAX_AGE_S,
    });
    return c.json({ ok: true });
  };
}
