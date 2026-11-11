import { randomUUID } from 'node:crypto';

export class RequestError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function contentParts(content) {
  if (content == null) return [];
  if (typeof content === 'string') return content ? [{type: 'text', text: content}] : [];
  if (!Array.isArray(content)) throw new RequestError('content must be a string or array');
  return content.map(part => {
    if (part.type === 'text') return {type: 'text', text: String(part.text ?? '')};
    if (part.type === 'image_url') {
      const url = part.image_url?.url;
      const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(url || '');
      if (!match) throw new RequestError('Images must be inline base64 PNG, JPEG, GIF or WebP');
      return {type: 'image', source: {type: 'base64', media_type: match[1], data: match[2]}};
    }
    throw new RequestError(`Unsupported content type: ${part.type}`);
  });
}

export function chatToMessages(body) {
  if (!body || typeof body.model !== 'string' || !Array.isArray(body.messages) || !body.messages.length)
    throw new RequestError('model and nonempty messages are required');
  const system = [], messages = [];
  const append = (role, content) => {
    if (!content.length) return;
    const last = messages.at(-1);
    // Keep user instructions separate from tool results. The ACP bridge uses
    // that boundary to distinguish an MCP continuation from a new user turn.
    const toolResultsOnly = parts => parts.every(part => part.type === 'tool_result');
    if (last?.role === role && (role === 'assistant' ||
      (toolResultsOnly(last.content) && toolResultsOnly(content)))) last.content.push(...content);
    else messages.push({role, content});
  };
  for (const message of body.messages) {
    if (message.role === 'system' || message.role === 'developer') {
      const parts = contentParts(message.content);
      if (parts.some(p => p.type !== 'text')) throw new RequestError('System messages must contain text');
      system.push(...parts);
    } else if (message.role === 'tool') {
      if (!message.tool_call_id) throw new RequestError('tool_call_id is required');
      append('user', [{type: 'tool_result', tool_use_id: message.tool_call_id,
        content: contentParts(message.content)}]);
    } else if (message.role === 'user') append('user', contentParts(message.content));
    else if (message.role === 'assistant') {
      const parts = contentParts(message.content);
      for (const call of message.tool_calls || []) {
        if (call.type !== 'function' || !call.id || !call.function?.name)
          throw new RequestError('Only named function tool calls are supported');
        let input;
        try { input = JSON.parse(call.function.arguments || '{}'); }
        catch { throw new RequestError(`Invalid arguments for tool ${call.function.name}`); }
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RequestError('Tool arguments must be an object');
        parts.push({type: 'tool_use', id: call.id, name: call.function.name, input});
      }
      append('assistant', parts);
    } else throw new RequestError(`Unsupported role: ${message.role}`);
  }
  const tools = (body.tools || []).map(tool => {
    if (tool.type !== 'function' || !tool.function?.name) throw new RequestError('Only function tools are supported');
    return {name: tool.function.name, description: tool.function.description || '',
      input_schema: tool.function.parameters || {type: 'object', properties: {}}};
  });
  // The ACP bridge cannot enforce sampling, forced tool selection or JSON mode.
  // Reject these instead of returning a response that silently ignores a contract.
  if (body.tool_choice && body.tool_choice !== 'auto') throw new RequestError('Only automatic tool choice is supported');
  if (body.response_format && body.response_format.type !== 'text') throw new RequestError('Structured output is not supported');
  if (body.n != null && body.n !== 1) throw new RequestError('Only n=1 is supported');
  return {model: body.model, messages, system, ...(tools.length ? {tools} : {}),
    max_tokens: body.max_completion_tokens || body.max_tokens || 8192,
    stream: body.stream === true,
    ...(body.reasoning_effort ? {reasoning_effort: body.reasoning_effort} : {})};
}

export function usageToChat(usage = {}) {
  const cached = usage.cache_read_input_tokens || 0;
  const prompt = (usage.input_tokens || 0) + cached + (usage.cache_creation_input_tokens || 0);
  const completion = usage.output_tokens || 0;
  return {prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion,
    prompt_tokens_details: {cached_tokens: cached}};
}

export function stopReason(reason) {
  return reason === 'tool_use' ? 'tool_calls' : reason === 'max_tokens' ? 'length' : 'stop';
}

export function messageToChat(message, model) {
  const content = (message.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  const tools = (message.content || []).filter(b => b.type === 'tool_use').map(b => ({
    id: b.id, type: 'function', function: {name: b.name, arguments: JSON.stringify(b.input || {})}
  }));
  const thinking = (message.content || []).filter(b => b.type === 'thinking').map(b => b.thinking).join('');
  return {id: message.id || `chatcmpl-${randomUUID()}`, object: 'chat.completion',
    created: Math.floor(Date.now() / 1000), model,
    choices: [{index: 0, message: {role: 'assistant', content: content || null,
      ...(tools.length ? {tool_calls: tools} : {}), ...(thinking ? {reasoning_content: thinking} : {})},
    finish_reason: stopReason(message.stop_reason)}], usage: usageToChat(message.usage)};
}

export async function* parseSSE(stream) {
  const reader = stream.getReader(), decoder = new TextDecoder();
  let buffer = '';
  const parse = raw => {
    const lines = raw.split('\n');
    const data = lines.filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return null;
    return JSON.parse(data);
  };
  try {
    while (true) {
      const {done, value} = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, {stream: true});
      buffer = buffer.replace(/\r\n/g, '\n');
      let at;
      while ((at = buffer.indexOf('\n\n')) !== -1) {
        const event = parse(buffer.slice(0, at)); buffer = buffer.slice(at + 2);
        if (event) yield event;
      }
      if (done) break;
      if (buffer.length > 16 * 1024 * 1024) throw new Error('Upstream SSE event exceeds limit');
    }
    if (buffer.trim()) { const event = parse(buffer); if (event) yield event; }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function* messagesStreamToChat(stream, model, includeUsage = false) {
  let id = `chatcmpl-${randomUUID()}`, created = Math.floor(Date.now() / 1000), toolIndex = 0;
  const toolIndices = new Map(); let usage = {}, stopped = false;
  const chunk = (delta, finish_reason = null) => ({id, object: 'chat.completion.chunk', created, model,
    choices: [{index: 0, delta, finish_reason}]});
  for await (const event of parseSSE(stream)) {
    if (event.type === 'error') throw new Error(event.error?.message || 'Upstream stream error');
    if (event.type === 'message_start') {
      id = event.message.id || id; usage = {...event.message.usage};
      yield chunk({role: 'assistant', content: ''});
    } else if (event.type === 'content_block_start') {
      const block = event.content_block;
      if (block.type === 'tool_use') {
        const index = toolIndex++; toolIndices.set(event.index, index);
        yield chunk({tool_calls: [{index, id: block.id, type: 'function', function: {name: block.name,
          arguments: Object.keys(block.input || {}).length ? JSON.stringify(block.input) : ''}}]});
      } else if (block.type === 'text' && block.text) yield chunk({content: block.text});
      else if (block.type === 'thinking' && block.thinking) yield chunk({reasoning_content: block.thinking});
    } else if (event.type === 'content_block_delta') {
      const delta = event.delta;
      if (delta.type === 'text_delta') yield chunk({content: delta.text});
      else if (delta.type === 'thinking_delta') yield chunk({reasoning_content: delta.thinking});
      else if (delta.type === 'input_json_delta') {
        if (!toolIndices.has(event.index)) throw new Error('Tool delta arrived without a tool');
        yield chunk({tool_calls: [{index: toolIndices.get(event.index), function: {arguments: delta.partial_json}}]});
      }
    } else if (event.type === 'message_delta') {
      usage = {...usage, ...event.usage};
      if (event.delta?.stop_reason) yield chunk({}, stopReason(event.delta.stop_reason));
    } else if (event.type === 'message_stop') stopped = true;
  }
  if (!stopped) throw new Error('Upstream stream ended before message_stop');
  if (includeUsage) yield {id, object: 'chat.completion.chunk', created, model, choices: [], usage: usageToChat(usage)};
}
