import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {parseSSE} from '../protocol.mjs';

const base = process.env.CPA_TEST_URL || 'http://127.0.0.1:19438/v1';
const key = process.env.CPA_TEST_API_KEY || 'fixture-only-client-key-not-a-secret';
const outputDir = path.resolve('.artifacts/offline-local-files');
await fs.mkdir(outputDir, {recursive: true});
const evidence = [];
const tools = ['read_file', 'write_file'].map(name => ({type: 'function', function: {name, description: `Test-only ${name}`, parameters: {type: 'object', properties: {path: {type: 'string'}, content: {type: 'string'}}, required: ['path']}}}));
async function execute(call, expected, marker) {
  const args = JSON.parse(call.function.arguments);
  if (call.function.name === 'read_file') {
    assert.equal(args.path, expected.input); return fs.readFile(args.path, 'utf8');
  }
  assert.equal(call.function.name, 'write_file'); assert.equal(args.path, expected.output);
  assert.equal(args.content, marker); await fs.writeFile(args.path, args.content); return 'written';
}
async function request(endpoint, body) {
  const response = await fetch(base + endpoint, {method: 'POST', headers: {authorization: `Bearer ${key}`, 'content-type': 'application/json'}, body: JSON.stringify(body), signal: AbortSignal.timeout(15000)});
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response;
}
for (const streaming of [false, true]) {
  const marker = `LOCAL_MAC_${randomUUID()}`;
  const expected = {input: path.join(outputDir, `input-${streaming}.txt`), output: path.join(outputDir, `output-${streaming}.txt`)};
  await fs.writeFile(expected.input, marker);
  const messages = [{role: 'user', content: JSON.stringify(expected)}];
  let final = '';
  for (let step = 0; step < 3; step++) {
    const response = await request('/chat/completions', {model: 'agy-gemini-3.8-flash', messages, tools, stream: streaming});
    let message;
    if (!streaming) message = (await response.json()).choices[0].message;
    else {
      message = {role: 'assistant', content: '', tool_calls: []};
      for await (const event of parseSSE(response.body)) {
        const delta = event.choices?.[0]?.delta;
        if (!delta) continue;
        message.content += delta.content || '';
        for (const call of delta.tool_calls || []) {
          const item = message.tool_calls[call.index] ||= {id: call.id, type: 'function', function: {name: '', arguments: ''}};
          if (call.id) item.id = call.id;
          item.function.name += call.function?.name || '';
          item.function.arguments += call.function?.arguments || '';
        }
      }
    }
    messages.push(message);
    if (!message.tool_calls?.length) {final = message.content; break;}
    for (const call of message.tool_calls) messages.push({role: 'tool', tool_call_id: call.id, content: await execute(call, expected, marker)});
  }
  assert.equal(await fs.readFile(expected.output, 'utf8'), marker);
  assert.ok(final.includes(marker));
  evidence.push({test: streaming ? 'chat_streaming' : 'chat_nonstreaming', passed: true, output: expected.output});
}
// Exercise CPA's Responses translation, including returning a tool result.
const expected = {input: '/test-only-input', output: '/test-only-output'};
const responseTools = tools.map(t => ({type: 'function', ...t.function}));
let input = [{role: 'user', content: JSON.stringify(expected)}];
const first = await (await request('/responses', {model: 'agy-gemini-3.8-flash', input, tools: responseTools, stream: false})).json();
const call = first.output.find(item => item.type === 'function_call');
assert.equal(call.name, 'read_file');
input.push(...first.output, {type: 'function_call_output', call_id: call.call_id, output: 'RESPONSES_MARKER'});
const second = await (await request('/responses', {model: 'agy-gemini-3.8-flash', input, tools: responseTools, stream: false})).json();
const write = second.output.find(item => item.type === 'function_call');
assert.equal(write.name, 'write_file');
assert.equal(JSON.parse(write.arguments).content, 'RESPONSES_MARKER');
evidence.push({test: 'responses_tool_roundtrip', passed: true});
const streamingResponse = await request('/responses', {model: 'agy-gemini-3.8-flash', input: [{role: 'user', content: JSON.stringify(expected)}], tools: responseTools, stream: true});
const responseEvents = await Array.fromAsync(parseSSE(streamingResponse.body));
const completed = responseEvents.find(e => e.type === 'response.completed');
assert.ok(completed, 'Responses stream must have a terminal response.completed event');
const streamedCall = completed.response.output.find(i => i.type === 'function_call');
assert.equal(streamedCall.name, 'read_file');
assert.equal(JSON.parse(streamedCall.arguments).path, expected.input);
evidence.push({test: 'responses_streaming_tool_call', passed: true});
await fs.writeFile('.artifacts/offline-integration.json', JSON.stringify({kind: 'DETERMINISTIC_PROTOCOL_FIXTURE_NOT_REAL_MODEL', evidence}, null, 2));
console.log(JSON.stringify(evidence, null, 2));
