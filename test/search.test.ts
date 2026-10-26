import { afterEach, describe, expect, it } from 'vitest';
import { createSearchClient, type SearchClient } from '../src/search.js';

const fixture = new URL('./fixtures/fake-search-mcp.mjs', import.meta.url).pathname;
let client: SearchClient;
afterEach(() => client?.close());

describe('SearchClient', () => {
  it('fetchPage returns markdown and the title', async () => {
    client = createSearchClient(['node', fixture]);
    const r = await client.fetchPage('https://example.com/a');
    expect(r.ok).toBe(true);
    expect(r.markdown).toContain('body of the page');
    expect(r.title).toBe('Title of https://example.com/a');
  });
  it('research returns a brief', async () => {
    client = createSearchClient(['node', fixture]);
    const r = await client.research('how to animate');
    expect(r.ok).toBe(true);
    expect(r.markdown).toContain('Research brief: how to animate');
  });
  it('returns ok:false on timeout instead of throwing', async () => {
    client = createSearchClient(['node', fixture], { timeoutMs: 500 });
    const r = await client.fetchPage('https://example.com/slow');
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });
  it('recovers after the server process crashes', async () => {
    client = createSearchClient(['node', fixture], { timeoutMs: 3000 });
    expect((await client.fetchPage('https://example.com/crash')).ok).toBe(false);
    const again = await client.fetchPage('https://example.com/ok');
    expect(again.ok).toBe(true);
  });
  it('returns ok:false when the command cannot start', async () => {
    client = createSearchClient(['/nonexistent-binary'], { timeoutMs: 2000 });
    expect((await client.research('x')).ok).toBe(false);
  });
});
