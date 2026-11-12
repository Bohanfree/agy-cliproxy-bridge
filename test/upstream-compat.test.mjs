import test from 'node:test';
import assert from 'node:assert/strict';
import {createBridgeKit} from './support/bridge-kit.mjs';
import {windowsNcBuild, windowsTreeKill} from '../vendor/agy-bridge/platform.mjs';

test('Windows launcher recognizes Magpie Bun and constructs a process-tree cleanup', () => {
  const build = windowsNcBuild('C:\\magpie\\magpie-bun.exe', 'server.mjs', 'nc.exe', {bun: '1.4.4'});
  assert.ok(build.args.includes('--windows-hide-console'));
  assert.equal(windowsNcBuild('C:\\node.exe', 'server.mjs', 'nc.exe', {}), null);
  const cleanup = windowsTreeKill([123, 456]);
  assert.ok(cleanup.args.includes('/T'));
});

test('ACP output already includes thinking and cache remains independent', async t => {
  const kit = await createBridgeKit(); t.after(() => kit.dispose());
  const normalize = kit.module.__agyTestNormalizeAcpUsage;
  const usage = normalize({inputTokens: 2133, cachedReadTokens: 4899, outputTokens: 140, thoughtTokens: 139});
  assert.equal(usage.input_tokens, 2133);
  assert.equal(usage.cache_read_input_tokens, 4899);
  assert.equal(usage.output_tokens, 140);
  assert.equal(usage.output_tokens_details.thinking_tokens, 139);
  assert.equal(normalize({outputTokens: 2, thoughtTokens: 5}).output_tokens, 5);
});

test('mentions of incomplete notice tags remain user instructions', async t => {
  const kit = await createBridgeKit(); t.after(() => kit.dispose());
  const inspect = kit.module.__agyTestInspectToolTurn;
  const result = [{block: {tool_use_id: 'tool_1'}, call: {name: 'Read'}, result: {content: [{type: 'text', text: 'RESULT'}]}}];
  const msg = {model: 'gemini-4-argon', messages: [
    {role: 'assistant', content: [{type:'tool_use', id:'tool_1', name:'Read', input:{}}]},
    {role: 'user', content: [{type:'tool_result', tool_use_id:'tool_1', content:'RESULT'}, {type:'text', text:'Explain the literal string <channel please'}]},
  ]};
  assert.equal(inspect(result, msg).userSteered, true);
  msg.messages[1].content[1].text = '<system-reminder>unfinished';
  assert.throws(() => inspect(result, msg), /text beside a live tool_result/);
});
