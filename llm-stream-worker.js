/**
 * Worker thread for LLM streaming - isolates HTTP/SSE parsing from main process
 * so the main thread stays responsive for forwarding chunks to the renderer.
 */
const { parentPort } = require('worker_threads');
const http = require('http');
const https = require('https');
const { URL } = require('url');

function parseSSEChunk(parsed) {
  const openai = parsed.choices?.[0]?.delta?.content;
  if (openai) return openai;
  const claude = parsed.delta?.text;
  if (claude) return claude;
  const google = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
  if (google) return google;
  return null;
}

parentPort.on('message', (msg) => {
  const { url, options, body } = msg;
  const u = new URL(url);
  const mod = u.protocol === 'https:' ? https : http;
  let buffer = '';
  const req = mod.request(
    {
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: options.method || 'POST',
      headers: options.headers || {},
    },
    (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        let errData = '';
        res.on('data', (ch) => (errData += ch));
        res.on('end', () => parentPort.postMessage({ type: 'done', error: errData || res.statusMessage }));
        return;
      }
      res.on('data', (ch) => {
        buffer += ch.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);
              const content = parseSSEChunk(parsed);
              if (content) parentPort.postMessage({ type: 'chunk', content });
            } catch (_) {}
          }
        }
      });
      res.on('end', () => parentPort.postMessage({ type: 'done' }));
    }
  );
  req.on('error', (err) => parentPort.postMessage({ type: 'done', error: err.message }));
  req.setTimeout(120000);
  if (body) req.write(body);
  req.end();
});
