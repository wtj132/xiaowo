#!/usr/bin/env node
// 按真实协议响应的假 dsh：先 initialize 再接受 session/prompt。
import readline from 'node:readline';

let inited = false;
const send = (o) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...o }) + '\n');
const event = (type, data) => send({ method: 'session.event', params: { event: { type, data } } });

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') {
    inited = true;
    return send({ id: msg.id, result: { ok: true } });
  }
  if (msg.method === 'shutdown') {
    send({ id: msg.id, result: {} });
    process.exit(0);
  }
  if (msg.method !== 'session/prompt') return send({ id: msg.id, error: { message: 'unknown method' } });
  if (!inited) return send({ id: msg.id, error: { message: 'not initialized' } });

  const prompt = msg.params.contentBlocks[0].text;
  send({ id: msg.id, result: { messageId: 'm1' } });
  if (prompt.includes('EXIT')) process.exit(1);
  if (prompt.includes('HANG')) return;

  event('turn/start', { turn: 1 });
  event('assistant/message', { turn: 1, step: 1, message: { id: 'a1', content: [{ type: 'tool_call', name: 'shell' }] } });
  const answer = prompt.includes('ENV')
    ? JSON.stringify({ DSH_PROFILE: process.env.DSH_PROFILE ?? null, DSH_WEB_URL: process.env.DSH_WEB_URL ?? null, DSH_HOME: process.env.DSH_HOME, KEY: process.env.DEEPSEEK_API_KEY ?? null })
    : `回答:${prompt}`;
  event('assistant/message', {
    turn: 1, step: 2,
    message: { id: 'a2', content: [{ type: 'reasoning', text: '思考中' }, { type: 'text', text: answer }] },
  });
  event('turn/end', { turn: 1, reason: prompt.includes('MAXTOKENS') ? 'max-tokens' : 'completed' });
});
