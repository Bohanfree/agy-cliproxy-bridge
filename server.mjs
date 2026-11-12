import http from 'node:http';
import fs from 'node:fs';
import { once } from 'node:events';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { chatToMessages, messageToChat, messagesStreamToChat, RequestError } from './protocol.mjs';

const MAX_BODY = 16 * 1024 * 1024;
export function createBridgeServer({key, bridgeFetch, models, requestTimeoutMs = 300000}) {
  if (!key || key.length < 24) throw new Error('A private API key of at least 24 characters is required');
  const expected = Buffer.from(`Bearer ${key}`);
  const server = http.createServer(async (req, res) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('Request deadline exceeded')), requestTimeoutMs);
    const abort = () => { if (!res.writableEnded) controller.abort(new Error('Client disconnected')); };
    res.on('close', abort);
    const json = (status, body) => { res.writeHead(status, {'content-type': 'application/json'}); res.end(JSON.stringify(body)); };
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (pathname === '/healthz' && req.method === 'GET') return json(200, {status: 'ok', service: 'agy-cliproxy-bridge', version: '0.1.2-agy.0.1.25-local.20261112.1'});
      const actual = Buffer.from(req.headers.authorization || '');
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
        return json(401, {error: {type: 'authentication_error', message: 'Invalid API key'}});
      if (pathname === '/v1/models' && req.method === 'GET') {
        const catalog = await models();
        return json(200, {object: 'list', data: Object.keys(catalog).map(id => ({id, object: 'model', created: 0, owned_by: 'agy'}))});
      }
      if (req.method !== 'POST' || !['/v1/chat/completions', '/v1/messages', '/v1/messages/count_tokens'].includes(pathname))
        return json(404, {error: {type: 'invalid_request_error', message: 'Unknown endpoint'}});
      let size = 0, chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY) throw new RequestError('Request body exceeds 16 MiB', 413);
        chunks.push(chunk);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw new RequestError('Invalid JSON'); }
      const chat = pathname === '/v1/chat/completions';
      const translated = chat ? chatToMessages(body) : body;
      const upstream = await bridgeFetch(`agy://local${chat ? '/v1/messages' : pathname}`, {
        method: 'POST', body: JSON.stringify(translated), signal: controller.signal,
      });
      if (!upstream.ok) {
        const text = await upstream.text();
        res.writeHead(upstream.status, {'content-type': 'application/json', 'x-should-retry': upstream.headers.get('x-should-retry') || 'false'});
        return res.end(text);
      }
      if (body.stream !== true || pathname.endsWith('count_tokens')) {
        const value = await upstream.json();
        return json(200, chat ? messageToChat(value, body.model) : value);
      }
      res.writeHead(200, {'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'x-accel-buffering': 'no'});
      const write = async data => {
        if (controller.signal.aborted) throw controller.signal.reason;
        if (!res.write(data)) await once(res, 'drain', {signal: controller.signal});
      };
      // Keep the HTTP connection alive while AGY thinks or waits for tools.
      const heartbeat = setInterval(() => { if (!res.destroyed) res.write(': keepalive\n\n'); }, 15000);
      try {
        if (chat) {
          for await (const chunk of messagesStreamToChat(upstream.body, body.model, body.stream_options?.include_usage === true))
            await write(`data: ${JSON.stringify(chunk)}\n\n`);
          await write('data: [DONE]\n\n');
        } else {
          const reader = upstream.body.getReader();
          try { while (true) { const {value, done} = await reader.read(); if (done) break; await write(value); } }
          finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        }
        res.end();
      } finally { clearInterval(heartbeat); }
    } catch (error) {
      const status = error.status || (controller.signal.aborted ? 504 : 502);
      const payload = {error: {type: status === 400 ? 'invalid_request_error' : 'api_error', message: String(error.message || error)}};
      if (!res.headersSent) json(status, payload);
      else if (!res.destroyed) res.end(`event: error\ndata: ${JSON.stringify(payload)}\n\n`);
    } finally { clearTimeout(timer); res.off('close', abort); }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const {AntigravityBridgePlugin} = await import('./vendor/agy-bridge/index.mjs');
  const plugin = await AntigravityBridgePlugin();
  const loader = await plugin.auth.loader();
  const key = fs.readFileSync(process.env.AGY_API_KEY_FILE || './api.key', 'utf8').trim();
  const server = createBridgeServer({key, bridgeFetch: loader.fetch, models: plugin.provider.models});
  server.listen(Number(process.env.PORT || 9437), process.env.BIND || '127.0.0.1', () => console.log('agy-cliproxy-bridge listening'));
  const shutdown = () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
}
