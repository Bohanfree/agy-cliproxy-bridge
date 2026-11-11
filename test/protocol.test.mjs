import test from 'node:test';
import assert from 'node:assert/strict';
import {chatToMessages, messageToChat, messagesStreamToChat, parseSSE} from '../protocol.mjs';
import {createBridgeServer} from '../server.mjs';

const key = 'test-key-012345678901234567890123456789';
function stream(events) {
  const bytes = new TextEncoder().encode(events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''));
  let position = 0;
  return new ReadableStream({pull(controller) {
    if (position === bytes.length) return controller.close();
    controller.enqueue(bytes.slice(position, position += Math.min(7, bytes.length - position)));
  }});
}
const events = [
  {type: 'message_start', message: {id: 'msg_1', usage: {input_tokens: 20, cache_read_input_tokens: 5}}},
  {type: 'content_block_start', index: 0, content_block: {type: 'text', text: ''}},
  {type: 'content_block_delta', index: 0, delta: {type: 'text_delta', text: '读取本机文件'}},
  {type: 'content_block_stop', index: 0},
  {type: 'content_block_start', index: 1, content_block: {type: 'tool_use', id: 'call_read', name: 'read_file', input: {}}},
  {type: 'content_block_delta', index: 1, delta: {type: 'input_json_delta', partial_json: '{"path":'}},
  {type: 'content_block_delta', index: 1, delta: {type: 'input_json_delta', partial_json: '"/tmp/中文.txt"}'}},
  {type: 'content_block_stop', index: 1},
  {type: 'message_delta', delta: {stop_reason: 'tool_use'}, usage: {output_tokens: 12}},
  {type: 'message_stop'},
];

test('keeps tool call identity, results and a following user instruction in order', () => {
  const body = chatToMessages({model: 'gemini-3.8-flash', messages: [
    {role: 'developer', content: 'Work on the Mac'},
    {role: 'user', content: 'Read my file'},
    {role: 'assistant', content: null, tool_calls: [{id: 'call_1', type: 'function', function: {name: 'read_file', arguments: '{"path":"/Users/demo/a.txt"}'}}]},
    {role: 'tool', tool_call_id: 'call_1', content: 'unique-marker-123'},
    {role: 'user', content: 'Now write a summary'},
  ], tools: [{type: 'function', function: {name: 'read_file', parameters: {type: 'object', properties: {path: {type: 'string'}}}}}]});
  assert.equal(body.system[0].text, 'Work on the Mac');
  assert.equal(body.messages.length, 4);
  assert.equal(body.messages[1].content[0].input.path, '/Users/demo/a.txt');
  assert.deepEqual(body.messages[2].content.map(p => p.type), ['tool_result']);
  assert.deepEqual(body.messages[3].content, [{type: 'text', text: 'Now write a summary'}]);
  assert.equal(body.messages[2].content[0].tool_use_id, 'call_1');
  assert.equal(body.messages[2].content[0].content[0].text, 'unique-marker-123');
});

test('rejects malformed tool arguments, unsupported tools and externally hosted images', () => {
  const body = {model: 'test', messages: [{role: 'user', content: 'hi'}]};
  assert.throws(() => chatToMessages({...body, tools: [{type: 'custom', name: 'shell'}]}), /function tools/);
  assert.throws(() => chatToMessages({...body, response_format: {type: 'json_schema'}}), /Structured output/);
  assert.throws(() => chatToMessages({...body, messages: [{role: 'assistant', tool_calls: [{type: 'function', id: 'x', function: {name: 'x', arguments: '{broken'}}]}]}), /Invalid arguments/);
  assert.throws(() => chatToMessages({...body, messages: [{role: 'user', content: [{type: 'image_url', image_url: {url: 'http://169.254.169.254/secret'}}]}]}), /inline base64/);
});

test('SSE survives arbitrary UTF-8 byte boundaries and preserves streamed tool arguments', async () => {
  const chunks = await Array.fromAsync(messagesStreamToChat(stream(events), 'test-model', true));
  assert.equal(chunks.map(c => c.choices[0]?.delta.content || '').join(''), '读取本机文件');
  const toolChunks = chunks.flatMap(c => c.choices[0]?.delta.tool_calls || []);
  assert.equal(toolChunks[0].id, 'call_read');
  assert.equal(toolChunks.map(t => t.function.arguments).join(''), '{"path":"/tmp/中文.txt"}');
  assert.equal(chunks.at(-2).choices[0].finish_reason, 'tool_calls');
  assert.equal(chunks.at(-1).usage.total_tokens, 37);
});

test('an interrupted or failed upstream stream never becomes a successful completion', async () => {
  await assert.rejects(Array.fromAsync(messagesStreamToChat(stream(events.slice(0, 3)), 'test')), /before message_stop/);
  await assert.rejects(Array.fromAsync(messagesStreamToChat(stream([{type: 'error', error: {message: 'No capacity'}}]), 'test')), /No capacity/);
});

test('nonstreaming output keeps multiple calls, thinking and cache usage', () => {
  const output = messageToChat({content: [{type: 'thinking', thinking: 'reason'}, {type: 'tool_use', id: 'a', name: 'read', input: {path: '/a'}}, {type: 'tool_use', id: 'b', name: 'read', input: {path: '/b'}}], stop_reason: 'tool_use', usage: {input_tokens: 10, cache_read_input_tokens: 30, output_tokens: 5}}, 'test');
  assert.equal(output.choices[0].message.tool_calls.length, 2);
  assert.equal(output.choices[0].message.reasoning_content, 'reason');
  assert.equal(output.usage.total_tokens, 45);
});

test('HTTP endpoint enforces authentication and forwards tools without executing them', async t => {
  const received = [];
  const server = createBridgeServer({key, models: async () => ({'test-model': {}}), bridgeFetch: async (_url, init) => {
    received.push(JSON.parse(init.body));
    return Response.json({content: [{type: 'tool_use', id: 'test-call', name: 'read_file', input: {path: '/local-only'}}], stop_reason: 'tool_use'});
  }});
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => {server.closeAllConnections(); server.close(r);}));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base + '/v1/models')).status, 401);
  assert.equal((await fetch(base + '/healthz')).status, 200);
  assert.equal((await fetch(base + '/v1/models', {headers: {authorization: `Bearer ${key}`}})).status, 200);
  const result = await fetch(base + '/v1/chat/completions', {method: 'POST', headers: {authorization: `Bearer ${key}`}, body: JSON.stringify({model: 'test-model', messages: [{role: 'user', content: 'Read file'}]})});
  assert.equal(result.status, 200);
  assert.equal((await result.json()).choices[0].message.tool_calls[0].function.name, 'read_file');
  assert.equal(received[0].messages[0].content[0].text, 'Read file');
  assert.equal((await fetch(base + '/v1/chat/completions', {method: 'POST', headers: {authorization: `Bearer ${key}`}, body: '{bad'})).status, 400);
});

test('disconnect propagates cancellation to the AGY bridge', async t => {
  let started, aborted;
  const start = new Promise(r => started = r), stop = new Promise(r => aborted = r);
  const server = createBridgeServer({key, models: async () => ({}), bridgeFetch: async (_url, init) => {
    started();
    await new Promise((_r, reject) => init.signal.addEventListener('abort', () => {aborted(); reject(init.signal.reason);}, {once: true}));
  }});
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => {server.closeAllConnections(); server.close(r);}));
  const controller = new AbortController();
  const call = fetch(`http://127.0.0.1:${server.address().port}/v1/chat/completions`, {method: 'POST', headers: {authorization: `Bearer ${key}`}, body: JSON.stringify({model: 'test', messages: [{role: 'user', content: 'wait'}]}), signal: controller.signal}).catch(() => {});
  await start; controller.abort();
  await Promise.race([stop, new Promise((_r, reject) => {const timer = setTimeout(() => reject(new Error('Cancel not propagated')), 1500); timer.unref();})]);
  await call;
});
