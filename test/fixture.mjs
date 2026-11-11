// Deterministic AGY boundary, real adapter + ACP/MCP bridge. No Google requests.
import {createBridgeServer} from '../server.mjs';
import {createBridgeKit} from './support/bridge-kit.mjs';

const kit = await createBridgeKit();
const textOf = value => value?.content?.filter(p => p.type === 'text').map(p => p.text).join('') || '';
kit.defaultPrompt = async agent => {
  const prompt = agent.prompt.filter(p => p.type === 'text').map(p => p.text).join('');
  if (prompt.includes('FOLLOWUP_MARKER') || prompt.includes('PREFILL_MARKER')) {
    const marker = /CPA_CONTINUATION_[a-f0-9-]+/.exec(prompt)?.[0];
    if (!marker || !prompt.includes('[tool result')) throw new Error('Continuation lost the completed result');
    await agent.text(`CONTINUATION_OK ${marker}`);
  } else {
    const match = /\{"input":"[^"\n]+","output":"[^"\n]+"\}/.exec(prompt);
    if (!match) throw new Error('Fixture input plan missing');
    const plan = JSON.parse(match[0]);
    const read = await agent.tool('read_file', {path: plan.input});
    const marker = textOf(read?.result || read);
    if (!marker) throw new Error('Client read result missing');
    await agent.tool('write_file', {path: plan.output, content: marker});
    await agent.text(`OFFLINE_PROTOCOL_OK ${marker}`);
  }
  return {stopReason: 'end_turn', usage: {inputTokens: 100, cachedReadTokens: 50, outputTokens: 10}};
};
const server = createBridgeServer({key: 'fixture-only-bridge-key-not-a-secret',
  models: () => kit.models(), bridgeFetch: (url, init) => kit.fetch(url, init)});
server.listen(Number(process.env.PORT || 9438), process.env.BIND || '127.0.0.1', () => console.log('OFFLINE CORE FIXTURE listening on 9438'));
process.on('SIGTERM', async () => {
  server.closeAllConnections(); server.close();
  await kit.dispose(); process.exit(0);
});
