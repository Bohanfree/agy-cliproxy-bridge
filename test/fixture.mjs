// Deterministic protocol fixture, never a real model. Used only by cpa-test.
import {createBridgeServer} from '../server.mjs';
const tools = [{name: 'read_file'}, {name: 'write_file'}];
const server = createBridgeServer({key: 'fixture-only-bridge-key-not-a-secret',
  models: async () => ({'gemini-3.8-flash': {}}),
  bridgeFetch: async (_url, init) => {
    const body = JSON.parse(init.body);
    const prompt = body.messages.find(m => m.role === 'user').content.find(c => c.type === 'text').text;
    const plan = JSON.parse(prompt);
    const results = body.messages.flatMap(m => m.content).filter(c => c.type === 'tool_result');
    const read = results.find(r => r.tool_use_id === 'fixture_read');
    const write = results.find(r => r.tool_use_id === 'fixture_write');
    const marker = read?.content?.map(p => p.text || '').join('') || '';
    const content = write ? [{type: 'text', text: `OFFLINE_PROTOCOL_OK ${marker}`}]
      : read ? [{type: 'tool_use', id: 'fixture_write', name: tools[1].name, input: {path: plan.output, content: marker}}]
      : [{type: 'tool_use', id: 'fixture_read', name: tools[0].name, input: {path: plan.input}}];
    const value = {id: 'fixture_msg', type: 'message', role: 'assistant', model: body.model, content,
      stop_reason: write ? 'end_turn' : 'tool_use', usage: {input_tokens: 10, output_tokens: 5}};
    if (!body.stream) return Response.json(value);
    const events = [{type: 'message_start', message: {...value, content: []}}];
    content.forEach((block, index) => {
      events.push({type: 'content_block_start', index, content_block: block.type === 'tool_use' ? {...block, input: {}} : {...block, text: ''}});
      events.push({type: 'content_block_delta', index, delta: block.type === 'tool_use'
        ? {type: 'input_json_delta', partial_json: JSON.stringify(block.input)} : {type: 'text_delta', text: block.text}});
      events.push({type: 'content_block_stop', index});
    });
    events.push({type: 'message_delta', delta: {stop_reason: value.stop_reason}, usage: value.usage}, {type: 'message_stop'});
    return new Response(events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''), {headers: {'content-type': 'text/event-stream'}});
  }});
server.listen(Number(process.env.PORT || 9438), process.env.BIND || '127.0.0.1', () => console.log('OFFLINE FIXTURE listening on 9438'));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
