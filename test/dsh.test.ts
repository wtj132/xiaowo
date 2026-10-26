import { afterEach, describe, expect, it } from 'vitest';
import type { Config } from '../src/config.js';
import { createDshClient, type DshClient } from '../src/dsh.js';

const fake = new URL('./fixtures/fake-dsh.mjs', import.meta.url).pathname;
const cfg = { dshBin: fake, dshHome: '/tmp/dsh-test-home', dshWorkspace: '/tmp' } as Config;
let client: DshClient;
afterEach(() => client?.close());

describe('DshClient', () => {
  it('initializes first, then returns only the text block of the last message', async () => {
    client = createDshClient(cfg);
    expect(await client.ask('你好')).toBe('回答:你好');
  });
  it('never includes reasoning or empty tool-call messages', async () => {
    client = createDshClient(cfg);
    const out = await client.ask('x');
    expect(out).not.toContain('思考');
  });
  it('throws when the turn ends with max-tokens', async () => {
    client = createDshClient(cfg);
    await expect(client.ask('MAXTOKENS')).rejects.toThrow(/max-tokens/);
  });
  it('restarts after the child process exits', async () => {
    client = createDshClient(cfg);
    await expect(client.ask('EXIT')).rejects.toThrow();
    expect(await client.ask('again')).toBe('回答:again');
  });
  it('times out when no turn/end arrives', async () => {
    client = createDshClient(cfg);
    await expect(client.ask('HANG', { timeoutMs: 300 })).rejects.toThrow(/超时/);
  });
  it('scrubs inherited DSH env vars and sets the bridge home', async () => {
    process.env.DSH_PROFILE = 'web';
    process.env.DSH_WEB_URL = 'http://x';
    process.env.DEEPSEEK_API_KEY = 'sk-test';
    try {
      client = createDshClient(cfg);
      const env = JSON.parse(await client.ask('ENV'));
      expect(env.DSH_PROFILE).toBeNull();
      expect(env.DSH_WEB_URL).toBeNull();
      expect(env.DSH_HOME).toBe('/tmp/dsh-test-home');
      expect(env.KEY).toBe('sk-test');
    } finally {
      delete process.env.DSH_PROFILE; delete process.env.DSH_WEB_URL; delete process.env.DEEPSEEK_API_KEY;
    }
  });
  it('serializes concurrent asks', async () => {
    client = createDshClient(cfg);
    const [a, b] = await Promise.all([client.ask('one'), client.ask('two')]);
    expect([a, b]).toEqual(['回答:one', '回答:two']);
  });
});
