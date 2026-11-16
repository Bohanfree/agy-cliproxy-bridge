import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {cloak, outgoing, turnsAway} from '../vendor/agy-bridge/cloak.mjs';
import {createBridgeKit, baseBody, readJson} from './support/bridge-kit.mjs';

test('Codex CLI and Pi identity lines that triggered live 429s are reworded', () => {
  for (const [original, expected] of [
    ['You are a coding agent running in the Codex CLI, a terminal-based coding assistant.',
      "You're a coding agent running in the Codex CLI, a terminal-based coding assistant."],
    ['You are a coding assistant running inside pi, a coding agent harness.',
      'You are a coding assistant running within pi, a coding agent harness.'],
  ]) {
    assert.equal(turnsAway(original), true);
    assert.equal(cloak(original), expected);
    assert.equal(turnsAway(expected), false);
    assert.equal(cloak(expected), expected);
  }
});

test('wrapped identity lines and old invisible-character variants receive the same rewrite', () => {
  for (const original of [
    'You are a coding agent\nrunning in the Codex CLI',
    'Y\u200bo\u200bu are a coding agent running in the Codex CLI',
  ]) {
    const rewritten = outgoing(original);
    assert.equal(turnsAway(rewritten), false);
    assert.doesNotMatch(rewritten, /[\u200b-\u200f\u2060-\u2064]/);
    assert.match(rewritten, /^You're a coding agent/);
  }
});

test('unaffected GPT-6 instructions and the surrounding task wording stay intact', () => {
  const plain = 'You are Codex, an agent based on GPT-6.\nKeep all user numbers and names.';
  assert.equal(outgoing(plain), plain);
  const task = 'Read the existing file once. Preserve 123.45 and CLIENT_RESULT_MARKER.';
  assert.equal(outgoing('You are a coding agent running in the Codex CLI\n' + task),
    "You're a coding agent running in the Codex CLI\n" + task);
});

test('sessions opened with the old rejected identity are replaced; newly rewritten sessions still resume', async t => {
  const kit = await createBridgeKit();
  t.after(() => kit.dispose());
  const hash = value => createHash('sha256').update(value).digest('hex');
  const original = 'You are a coding agent running in the Codex CLI.\nKeep task results.';
  const history = [{role: 'user', content: 'original task'}, {role: 'assistant', content: 'done'}];
  const file = path.join(kit.env.XDG_STATE_HOME, 'magpie-agy-bridge', 'sessions.json');
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, JSON.stringify({version: 1, entries: [{
    key: 'old-session', sessionId: 'retains-rejected-identity', at: kit.clock.now(), workDir: null,
    historyHash: hash(kit.module.__agyTestHistoryKey(history)),
    instructionsHash: hash(kit.module.__agyTestInstructionsIdentity(original)),
  }]}));
  assert.equal(kit.module.__agyTestTakeParked('old-session', {instructions: original, history}), null);
  kit.module.__agyTestPark({convKey: 'updated-session', sessionId: 'uses-rewritten-identity',
    expectedMessages: history, instructions: original, workDir: null, hasSentFirstTurn: true,
    historyInvalid: false, turn: null, dead: false, canPark() { return true; }});
  assert.equal(kit.module.__agyTestTakeParked('updated-session', {instructions: original, history})?.sessionId,
    'uses-rewritten-identity');
});

test('the updated bridge still settles exact transcript usage with independent input and cache counters', async t => {
  const kit = await createBridgeKit();
  t.after(() => kit.dispose());
  kit.prompts.push(async agent => {
    const filename = path.join(kit.env.HOME, '.gemini', 'antigravity-cli', 'brain',
      agent.sessionId, '.system_generated', 'logs', 'transcript.jsonl');
    fs.mkdirSync(path.dirname(filename), {recursive: true});
    fs.writeFileSync(filename, JSON.stringify({type: 'PLANNER_RESPONSE', step_index: 1,
      input_tokens: 120, cache_read_tokens: 800, output_tokens: 9}) + '\n');
    await agent.text('ACCOUNTING_OK');
    return {stopReason: 'end_turn', usage: {inputTokens: 120, cachedReadTokens: 800, outputTokens: 9}};
  });
  const result = await readJson(await kit.request(baseBody({stream: false, tools: []})));
  assert.equal(result.content[0].text, 'ACCOUNTING_OK');
  assert.equal(result.usage.input_tokens, 120);
  assert.equal(result.usage.cache_read_input_tokens, 800);
  assert.equal(result.usage.output_tokens, 9);
  assert.equal(kit.turns[0].responseSteps[0].usageKind, 'exact_model_step');
});
