import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import readline from 'node:readline';
import type { Config } from './config.js';

export interface DshClient {
  ask(prompt: string, opts?: { timeoutMs?: number }): Promise<string>;
  close(): Promise<void>;
}

const PROVIDER = process.env.DSH_PROVIDER ?? 'deepseek-official';
const MODEL = process.env.DSH_MODEL ?? 'deepseek-v4-pro';
const PROFILE = process.env.DSH_SDK_PROFILE ?? 'sdk-minimal';
/** agent 子进程只拿到这些环境变量，站点口令、API token 等绝不透传。 */
const ENV_WHITELIST = ['PATH', 'HOME', 'USER', 'LANG', 'LC_ALL', 'TMPDIR', 'SHELL', 'TERM', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY'];

/** 环境变量优先，其次已登录的 DSH 凭据；只注入子进程，不写日志。 */
function resolveApiKey(): string | undefined {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY;
  const file = join(homedir(), '.dsh', '.credentials.yaml');
  if (!existsSync(file)) return undefined;
  const line = readFileSync(file, 'utf8').split('\n').find((l) => l.trim().startsWith('DEEPSEEK_API_KEY:'));
  return line?.split(':').slice(1).join(':').trim() || undefined;
}

interface Turn {
  messages: Map<string, string>;
  resolve: (text: string) => void;
  reject: (e: Error) => void;
}

export function createDshClient(cfg: Config): DshClient {
  let child: ChildProcessWithoutNullStreams | null = null;
  let ready: Promise<unknown> | null = null;
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  let turn: Turn | null = null;
  let tail: Promise<unknown> = Promise.resolve();

  const failAll = (err: Error) => {
    for (const p of pending.values()) p.reject(err);
    pending.clear();
    turn?.reject(err);
    turn = null;
  };

  function onFrame(line: string) {
    if (!line.trim()) return;
    let msg: any;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.id !== undefined && !msg.method) {
      const slot = pending.get(msg.id);
      if (!slot) return;
      pending.delete(msg.id);
      if (msg.error) slot.reject(new Error(msg.error.message || 'rpc error'));
      else slot.resolve(msg.result);
      return;
    }
    if (msg.method !== 'session.event' || !turn) return;
    const { type, data } = msg.params?.event ?? {};
    if (type === 'assistant/message') {
      const content = (data?.message?.content ?? []) as { type: string; text?: string }[];
      const text = content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
      if (text) turn.messages.set(data.message.id ?? String(turn.messages.size), text);
    } else if (type === 'turn/end') {
      const t = turn;
      turn = null;
      if (data?.reason === 'completed' || data?.reason?.kind === 'completed') t.resolve([...t.messages.values()].join('\n\n'));
      else t.reject(new Error(`DSH 回合未完成: ${typeof data?.reason === 'string' ? data.reason : JSON.stringify(data?.reason)}`));
    }
  }

  function request(method: string, params: unknown): Promise<unknown> {
    const id = nextId++;
    return new Promise((resolveFn, reject) => {
      pending.set(id, { resolve: resolveFn, reject });
      child!.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  function start(): Promise<unknown> {
    if (ready) return ready;
    const home = resolve(cfg.dshHome);
    const workspace = resolve(cfg.dshWorkspace);
    mkdirSync(home, { recursive: true });
    mkdirSync(workspace, { recursive: true });
    const key = resolveApiKey();
    const env: NodeJS.ProcessEnv = {
      ...Object.fromEntries(ENV_WHITELIST.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]])),
      DSH_HOME: home,
      ...(key ? { DEEPSEEK_API_KEY: key } : {}),
    };

    const proc = spawn(cfg.dshBin, ['--profile', PROFILE], { cwd: workspace, env, stdio: ['pipe', 'pipe', 'pipe'] });
    child = proc;
    proc.stderr.on('data', () => undefined);
    proc.stdin.on('error', () => undefined);
    proc.on('error', (e) => { if (child === proc) { child = null; ready = null; failAll(e); } });
    proc.on('exit', (code) => {
      // 已被超时流程替换掉的旧进程退出时，不能连累新进程的请求
      if (child === proc) { child = null; ready = null; failAll(new Error(`dsh 进程退出 (code ${code})`)); }
    });
    readline.createInterface({ input: proc.stdout }).on('line', (line) => { if (child === proc) onFrame(line); });

    ready = request('initialize', { provider: PROVIDER, model: MODEL, cwd: workspace });
    ready.catch(() => { ready = null; });
    return ready;
  }

  /** 超时后杀掉子进程：旧回合的迟到事件不会串到下一次请求，卡死的进程也不会堵住队列。 */
  function abort(reason: Error) {
    const c = child;
    child = null;
    ready = null;
    failAll(reason);
    c?.kill('SIGKILL');
  }

  async function runAsk(prompt: string, timeoutMs: number): Promise<string> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { const e = new Error(`DSH 超时 (${timeoutMs}ms)`); abort(e); reject(e); }, timeoutMs);
    });
    const attempt = (async () => {
      await start();
      const done = new Promise<string>((resolveFn, reject) => {
        turn = { messages: new Map(), resolve: resolveFn, reject };
      });
      done.catch(() => undefined);
      await request('session/prompt', { sessionId: randomUUID(), contentBlocks: [{ type: 'text', text: prompt }] });
      return done;
    })();
    attempt.catch(() => undefined);
    try {
      return await Promise.race([attempt, timeout]);
    } finally {
      clearTimeout(timer);
      turn = null;
    }
  }

  return {
    ask(prompt, opts = {}) {
      const run = () => runAsk(prompt, opts.timeoutMs ?? 180_000);
      const next = tail.then(run, run);
      tail = next.catch(() => undefined);
      return next;
    },
    async close() {
      const c = child;
      if (!c) return;
      await request('shutdown', {}).catch(() => undefined);
      setTimeout(() => c.kill('SIGTERM'), 1000).unref();
    },
  };
}

/** 测试用：按提示词返回预设文本。 */
export class FakeDsh implements DshClient {
  prompts: string[] = [];
  starts: number[] = [];
  ends: number[] = [];
  constructor(private reply: string | ((prompt: string) => string | Promise<string>)) {}
  async ask(prompt: string) {
    this.prompts.push(prompt);
    this.starts.push(Date.now());
    try {
      return typeof this.reply === 'string' ? this.reply : await this.reply(prompt);
    } finally {
      this.ends.push(Date.now());
    }
  }
  async close() {}
}
