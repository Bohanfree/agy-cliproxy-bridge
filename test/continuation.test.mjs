import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createBridgeKit, baseBody, continueWithToolResults, readSse, readJson} from './support/bridge-kit.mjs';
import {chatToMessages, messageToChat} from '../protocol.mjs';

const joined = parts => parts.filter(p => p.type === 'text').map(p => p.text).join('');
const exactUsage = {inputTokens: 120, cachedReadTokens: 80, outputTokens: 8};

async function runScenario(t, {tail, stream = true, chat = false, compact = false, parallel = false}) {
  const kit = await createBridgeKit();
  t.after(() => kit.dispose());
  const output = path.join(kit.tmp, 'client-output.txt');
  let issued = 0;
  kit.prompts.push(async agent => {
    issued++;
    if (parallel) await agent.tools([['Read', {path: output}], ['Read', {path: output + '.second'}]]);
    else await agent.tool('Read', {path: output});
    await agent.text('ordinary completion');
    return {stopReason: 'end_turn', usage: exactUsage};
  });
  kit.prompts.push(async agent => {
    const prompt = joined(agent.prompt);
    assert.ok(prompt.includes('CLIENT_RESULT_MARKER'), 'completed tool result survives replay');
    assert.ok(prompt.includes('FOLLOWUP_MARKER'), 'follow-up or prefill survives replay');
    if (parallel) assert.ok(prompt.includes('SECOND_RESULT_MARKER'));
    if (tail === 'prefill' || tail === 'both') {
      assert.ok(prompt.includes('part of your own unfinished reply'), 'prefill stays a continuation carrier');
    }
    await agent.text('CONTINUATION_OK');
    return {stopReason: 'end_turn', usage: exactUsage};
  });
  const read = stream ? readSse : readJson;
  const body = baseBody({stream, metadata: {user_id: t.name}});
  const first = await read(await kit.request(body));
  assert.equal(first.stopReason, 'tool_use');
  // The client executes a side effect once, before returning its result.
  fs.appendFileSync(output, 'executed once\n');
  let next = continueWithToolResults(body, first, (_block, i) => i ? 'SECOND_RESULT_MARKER' : 'CLIENT_RESULT_MARKER');
  if (tail === 'inline') next.messages.at(-1).content.push({type: 'text', text: 'FOLLOWUP_MARKER summarize the existing results'});
  if (tail === 'separate' || tail === 'both') next.messages.push({role: 'user', content: 'FOLLOWUP_MARKER summarize the existing results'});
  if (tail === 'prefill' || tail === 'both') next.messages.push({role: 'assistant', content: 'FOLLOWUP_MARKER The summary is:'});
  if (compact) next = {...next, tools: [], system: 'Summarize the conversation; preserve completed tool results.'};
  if (chat) {
    const firstChat = messageToChat({content: first.content, stop_reason: first.stopReason}, body.model);
    const messages = [
      {role: 'user', content: 'start the task'}, firstChat.choices[0].message,
      ...first.content.filter(p => p.type === 'tool_use').map((p, i) => ({role: 'tool', tool_call_id: p.id, content: i ? 'SECOND_RESULT_MARKER' : 'CLIENT_RESULT_MARKER'})),
      ...(tail === 'separate' || tail === 'both' ? [{role: 'user', content: 'FOLLOWUP_MARKER summarize the existing results'}] : []),
      ...(tail === 'prefill' || tail === 'both' ? [{role: 'assistant', content: 'FOLLOWUP_MARKER The summary is:'}] : []),
    ];
    next = chatToMessages({model: body.model, messages, stream, tools: compact ? [] : [{type: 'function', function: {name: 'Read', parameters: {type: 'object'}}}]});
  }
  const final = await read(await kit.request(next));
  assert.equal(final.error, null);
  assert.equal(final.stopReason, 'end_turn');
  assert.equal(joined(final.content), 'CONTINUATION_OK');
  assert.equal(final.content.filter(p => p.type === 'tool_use').length, 0);
  assert.equal(issued, 1, 'initial tool-producing prompt never runs twice');
  assert.equal(fs.readFileSync(output, 'utf8'), 'executed once\n');
  assert.equal(kit.promptSerial, 2, 'one initial prompt and exactly one continuation');
  assert.equal(kit.acpSpawns.length, 2, 'old pending tool session is replaced once');
}

for (const stream of [false, true]) {
  for (const tail of ['inline', 'separate', 'prefill', 'both']) {
    test(`Messages ${stream ? 'streaming' : 'JSON'}: result + ${tail}`, {timeout: 8000}, t => runScenario(t, {tail, stream}));
  }
  for (const tail of ['separate', 'prefill', 'both']) {
    test(`Chat translation ${stream ? 'streaming' : 'JSON'}: result + ${tail}`, {timeout: 8000}, t => runScenario(t, {tail, stream, chat: true}));
  }
}
test('compaction reuses completed parallel tool results with tools removed', {timeout: 8000}, t => runScenario(t, {tail: 'both', compact: true, parallel: true}));

test('ordinary tool results continue the original ACP session', {timeout: 8000}, async t => {
  const kit = await createBridgeKit();
  t.after(() => kit.dispose());
  let result;
  kit.prompts.push(async agent => {
    result = await agent.tool('Read', {path: '/client/example'});
    await agent.text('ORDINARY_OK');
    return {stopReason: 'end_turn', usage: exactUsage};
  });
  const body = baseBody();
  const first = await readSse(await kit.request(body));
  const next = continueWithToolResults(body, first, () => 'DIRECT_RESULT');
  const final = await readSse(await kit.request(next));
  assert.equal(joined(final.content), 'ORDINARY_OK');
  assert.ok(JSON.stringify(result).includes('DIRECT_RESULT'));
  assert.equal(kit.acpSpawns.length, 1);
  assert.equal(kit.promptSerial, 1);
});

test('an incomplete parallel batch cannot trigger a follow-up replay', {timeout: 8000}, async t => {
  const kit = await createBridgeKit();
  t.after(() => kit.dispose());
  kit.prompts.push(async agent => {
    await agent.tools([['Read', {path: '/one'}], ['Read', {path: '/two'}]]);
    return {stopReason: 'end_turn'};
  });
  const body = baseBody();
  const first = await readSse(await kit.request(body));
  assert.equal(first.content.filter(p => p.type === 'tool_use').length, 2);
  const next = continueWithToolResults(body, first);
  next.messages.at(-1).content.pop();
  next.messages.push({role: 'assistant', content: 'FOLLOWUP_MARKER incomplete'});
  const response = await kit.request(next);
  assert.equal(response.status, 400);
  assert.match(await response.text(), /missing|pending|result/i);
  assert.equal(kit.promptSerial, 1);
  assert.equal(kit.acpSpawns.length, 1);
  assert.equal([...kit.module.__agyTestAllProcs][0].dead, false, 'incomplete results leave the pending owner intact');
});

test('a restored conversation with results and prefill replays without issuing the old tool', {timeout: 8000}, async t => {
  const kit = await createBridgeKit();
  t.after(() => kit.dispose());
  kit.prompts.push(async agent => {
    const text = joined(agent.prompt);
    assert.ok(text.includes('RESTORED_RESULT_MARKER'));
    assert.ok(text.includes('RESTORED_PREFILL_MARKER'));
    await agent.text('RESTORED_OK');
    return {stopReason: 'end_turn', usage: exactUsage};
  });
  const body = baseBody({messages: [
    {role: 'user', content: 'Read the original file'},
    {role: 'assistant', content: [{type: 'tool_use', id: 'restored_read', name: 'Read', input: {path: '/already-read'}}]},
    {role: 'user', content: [{type: 'tool_result', tool_use_id: 'restored_read', content: 'RESTORED_RESULT_MARKER'}]},
    {role: 'assistant', content: 'RESTORED_PREFILL_MARKER The summary is:'},
  ]});
  const result = await readSse(await kit.request(body));
  assert.equal(joined(result.content), 'RESTORED_OK');
  assert.equal(result.stopReason, 'end_turn');
  assert.equal(kit.promptSerial, 1);
});

test('recognized context notices still continue the existing tool session', {timeout: 8000}, async t => {
  const kit = await createBridgeKit();
  t.after(() => kit.dispose());
  let received;
  kit.prompts.push(async agent => {
    received = await agent.tool('Read', {path: '/client/example'});
    await agent.text('NOTICE_OK');
    return {stopReason: 'end_turn', usage: exactUsage};
  });
  const body = baseBody();
  const first = await readSse(await kit.request(body));
  const next = continueWithToolResults(body, first);
  next.messages.at(-1).content.push({type: 'text', text: '<system-reminder>NOTICE_MARKER</system-reminder>'});
  const final = await readSse(await kit.request(next));
  assert.equal(joined(final.content), 'NOTICE_OK');
  assert.ok(JSON.stringify(received).includes('NOTICE_MARKER'));
  assert.equal(kit.acpSpawns.length, 1);
});

test('malformed protocol notices cannot trigger a fresh replay', {timeout: 8000}, async t => {
  const kit = await createBridgeKit();
  t.after(() => kit.dispose());
  kit.prompts.push(async agent => {
    await agent.tool('Read', {path: '/client/example'});
    return {stopReason: 'end_turn'};
  });
  const body = baseBody();
  const first = await readSse(await kit.request(body));
  const next = continueWithToolResults(body, first);
  next.messages.at(-1).content.push({type: 'text', text: '<system-reminder>unfinished'});
  const response = await kit.request(next);
  assert.equal(response.status, 400);
  await response.text();
  assert.equal(kit.promptSerial, 1);
  assert.equal([...kit.module.__agyTestAllProcs][0].dead, false);
});

test('the explicit prefill-disable setting is preserved', async t => {
  const kit = await createBridgeKit({env: {AGY_BRIDGE_PREFILL: '0'}});
  t.after(() => kit.dispose());
  const response = await kit.request(baseBody({messages: [
    {role: 'user', content: 'hello'}, {role: 'assistant', content: 'unfinished'},
  ]}));
  assert.equal(response.status, 400);
  await response.text();
  assert.equal(kit.promptSerial, 0);
});
