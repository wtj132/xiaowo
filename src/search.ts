import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export interface PageResult { ok: boolean; title?: string; markdown?: string; error?: string }
export interface ResearchResult { ok: boolean; markdown?: string; error?: string }
export interface SearchClient {
  fetchPage(url: string): Promise<PageResult>;
  research(question: string): Promise<ResearchResult>;
  close(): Promise<void>;
}

function toText(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  return content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n');
}

export function createSearchClient(cmd: string[], opts: { timeoutMs?: number } = {}): SearchClient {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  let conn: Promise<Client> | null = null;
  let current: Client | null = null;

  const reset = async () => {
    const c = current;
    conn = null;
    current = null;
    await c?.close().catch(() => undefined);
  };

  const connect = () => {
    conn ??= (async () => {
      const client = new Client({ name: 'life', version: '0.1.0' });
      client.onclose = () => { if (current === client) { conn = null; current = null; } };
      await client.connect(new StdioClientTransport({ command: cmd[0], args: cmd.slice(1), stderr: 'ignore' }));
      current = client;
      return client;
    })();
    return conn;
  };

  async function call(name: string, args: Record<string, unknown>): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
    try {
      const client = await connect();
      const result = await client.callTool({ name, arguments: args }, undefined, { timeout: timeoutMs });
      if ((result as { isError?: boolean }).isError) return { ok: false, error: toText(result) || '工具返回错误' };
      return { ok: true, text: toText(result) };
    } catch (e) {
      await reset();
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  return {
    async fetchPage(url) {
      const r = await call('fetch', { url });
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, markdown: r.text, title: r.text.match(/^#\s+(.+)$/m)?.[1]?.trim() };
    },
    async research(question) {
      const r = await call('research', { question });
      return r.ok ? { ok: true, markdown: r.text } : { ok: false, error: r.error };
    },
    close: reset,
  };
}

export class FakeSearch implements SearchClient {
  pages = new Map<string, PageResult>();
  researchCalls: string[] = [];
  researchResult: ResearchResult = { ok: true, markdown: '(fake research)' };
  async fetchPage(url: string) { return this.pages.get(url) ?? { ok: false, error: '抓取失败' }; }
  async research(q: string) { this.researchCalls.push(q); return this.researchResult; }
  async close() {}
}
