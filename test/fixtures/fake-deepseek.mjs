// 本地调试用的假 DeepSeek：第一轮要求调用 add_packing，拿到工具结果后回一句话。
import { createServer } from 'node:http';
const sse = (res, chunks) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
  res.end('data: [DONE]\n\n');
};
createServer(async (req, res) => {
  let raw = ''; for await (const c of req) raw += c;
  let body;
  try { body = JSON.parse(raw); } catch { res.writeHead(400); return res.end('{"error":"bad json"}'); }
  if (req.headers.authorization !== 'Bearer sk-fake') { res.writeHead(401); return res.end('{"error":"bad key"}'); }
  const toolDone = body.messages.some((m) => m.role === 'tool');
  if (!toolDone) return sse(res, [
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'add_packing', arguments: '' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"items":["测试：小蜗服务器助手"]}' } }] } }] },
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
  ]);
  sse(res, [{ choices: [{ delta: { content: '加好了：清单里多了一条「测试：小蜗服务器助手」。' } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }]);
}).listen(8792, '127.0.0.1', () => console.log('fake deepseek on 8792'));
