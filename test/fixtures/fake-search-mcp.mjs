import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'fake-search', version: '0.0.1' });
const text = (t) => ({ content: [{ type: 'text', text: t }] });

server.tool('fetch', { url: z.string() }, async ({ url }) => {
  if (url.includes('slow')) await new Promise((r) => setTimeout(r, 60_000));
  if (url.includes('crash')) process.exit(1);
  return text(`# Title of ${url}\n\nbody of the page`);
});
server.tool('research', { question: z.string() }, async ({ question }) => text(`# Research brief: ${question}\n\nsome sources`));

await server.connect(new StdioServerTransport());
