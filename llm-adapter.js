/**
 * LLM adapter - supports LM Studio, OpenAI, Claude, Google AI
 * All APIs called from main process to keep API keys secure
 * Uses Node http/https (not fetch) for reliable requests in Electron main process
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

function httpRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method: options.method || 'POST',
        headers: options.headers || {},
      },
      (res) => {
        let data = '';
        res.on('data', (ch) => (data += ch));
        res.on('end', () => {
          try {
            resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, data: JSON.parse(data) });
          } catch (e) {
            reject(new Error(data || res.statusMessage));
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(120000);
    if (body) req.write(body);
    req.end();
  });
}

function parseSSEChunk(parsed) {
  const openai = parsed.choices?.[0]?.delta?.content;
  if (openai) return openai;
  const claude = parsed.delta?.text;
  if (claude) return claude;
  const google = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
  if (google) return google;
  return null;
}

function httpStream(url, options, body, onChunk) {
  return new Promise((resolve, reject) => {
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
          res.on('end', () => reject(new Error(errData || res.statusMessage)));
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
                if (content && onChunk) onChunk(content);
              } catch (_) {}
            }
          }
        });
        res.on('end', () => resolve());
      }
    );
    req.on('error', reject);
    req.setTimeout(120000);
    if (body) req.write(body);
    req.end();
  });
}

function buildSystemPrompt(contextDocuments) {
  if (!contextDocuments?.length) {
    return 'You are helping the user analyze their documents. Answer based on their question.';
  }
  const sections = contextDocuments.map(
    (d) => `--- ${d.path} ---\n${d.content || ''}\n`
  );
  return `You are helping the user analyze their markdown documents. Context from open files:\n\n${sections.join('\n')}\nAnswer based on the documents and the user's question.`;
}

function convertToOpenAIMessages(messages, systemPrompt) {
  const out = [];
  if (systemPrompt) {
    out.push({ role: 'system', content: systemPrompt });
  }
  for (const m of messages) {
    if (m.role === 'assistant' || m.role === 'user') {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}

async function callLMStudio(provider, messages, contextDocuments) {
  let baseUrl = (provider.baseUrl || 'http://127.0.0.1:1234')
    .replace(/\/$/, '')
    .replace(/localhost/gi, '127.0.0.1');
  const useNativeApi = provider.apiFormat !== 'openai' && !baseUrl.endsWith('/v1');
  const docPrompt = buildSystemPrompt(contextDocuments);
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const inputText = lastUser?.content || '';
  const bodyStr = useNativeApi
    ? JSON.stringify({
        model: provider.modelId || 'local-model',
        system_prompt: docPrompt + (messages.length > 1 ? '\n\nConversation so far:\n' + messages.map((m) => `${m.role}: ${m.content}`).join('\n') : ''),
        input: inputText,
        temperature: 0.7,
      })
    : JSON.stringify({
        model: provider.modelId || 'local-model',
        messages: convertToOpenAIMessages(messages, docPrompt),
        temperature: 0.7,
      });
  const url = useNativeApi ? `${baseUrl}/api/v1/chat` : `${baseUrl}/v1/chat/completions`;
  const headers = { 'Content-Type': 'application/json' };
  if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`;
  const { ok, data } = await httpRequest(url, { method: 'POST', headers }, bodyStr);
  if (!ok) throw new Error(data?.error?.message || data?.message || 'Request failed');
  if (useNativeApi) {
    const output = data?.output;
    if (Array.isArray(output)) {
      const parts = output.filter((o) => o?.type === 'message').map((o) => o.content);
      return parts.join('\n') || '';
    }
    return data?.output?.content ?? data?.content ?? '';
  }
  return data.choices?.[0]?.message?.content || '';
}

async function callLMStudioStream(provider, messages, contextDocuments, onChunk) {
  const baseUrl = (provider.baseUrl || 'http://127.0.0.1:1234')
    .replace(/\/$/, '')
    .replace(/localhost/gi, '127.0.0.1');
  const docPrompt = buildSystemPrompt(contextDocuments);
  const body = {
    model: provider.modelId || 'local-model',
    messages: convertToOpenAIMessages(messages, docPrompt),
    temperature: 0.7,
    stream: true,
  };
  const url = baseUrl.endsWith('/v1') ? `${baseUrl}/chat/completions` : `${baseUrl}/v1/chat/completions`;
  await httpStream(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    },
    JSON.stringify(body),
    onChunk
  );
}

async function callOpenAI(provider, messages, contextDocuments) {
  const systemPrompt = buildSystemPrompt(contextDocuments);
  const body = {
    model: provider.modelId || 'gpt-4o',
    messages: convertToOpenAIMessages(messages, systemPrompt),
    temperature: 0.7,
  };
  const bodyStr = JSON.stringify(body);
  const { ok, data } = await httpRequest(
    'https://api.openai.com/v1/chat/completions',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${provider.apiKey}` },
    },
    bodyStr
  );
  if (!ok) throw new Error(data?.error?.message || data?.message || 'Request failed');
  return data.choices?.[0]?.message?.content || '';
}

async function callOpenAIStream(provider, messages, contextDocuments, onChunk) {
  const systemPrompt = buildSystemPrompt(contextDocuments);
  const body = {
    model: provider.modelId || 'gpt-4o',
    messages: convertToOpenAIMessages(messages, systemPrompt),
    temperature: 0.7,
    stream: true,
  };
  await httpStream(
    'https://api.openai.com/v1/chat/completions',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${provider.apiKey}` },
    },
    JSON.stringify(body),
    onChunk
  );
}

async function callClaude(provider, messages, contextDocuments) {
  const systemPrompt = buildSystemPrompt(contextDocuments);
  const claudeMessages = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
  const body = {
    model: provider.modelId || 'claude-3-5-sonnet-20241022',
    max_tokens: 4096,
    system: systemPrompt,
    messages: claudeMessages,
  };
  const bodyStr = JSON.stringify(body);
  const { ok, data } = await httpRequest(
    'https://api.anthropic.com/v1/messages',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': provider.apiKey,
        'anthropic-version': '2023-06-01',
      },
    },
    bodyStr
  );
  if (!ok) throw new Error(data?.error?.message || 'Request failed');
  const textBlock = data?.content?.find((c) => c.type === 'text');
  return textBlock?.text || '';
}

async function callGoogle(provider, messages, contextDocuments) {
  const systemPrompt = buildSystemPrompt(contextDocuments);
  const contents = [];
  for (const m of messages) {
    if (m.role === 'user' || m.role === 'assistant') {
      const role = m.role === 'user' ? 'user' : 'model';
      contents.push({ role, parts: [{ text: m.content }] });
    }
  }
  const body = {
    contents,
    systemInstruction: { parts: [{ text: systemPrompt }] },
  };
  const modelId = provider.modelId || 'gemini-1.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${encodeURIComponent(provider.apiKey)}`;
  const bodyStr = JSON.stringify(body);
  const { ok, data } = await httpRequest(
    url,
    { method: 'POST', headers: { 'Content-Type': 'application/json' } },
    bodyStr
  );
  if (!ok) throw new Error(data?.error?.message || 'Request failed');
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  return text || '';
}

async function chatCompletion(provider, messages, contextDocuments) {
  switch (provider.type) {
    case 'lmstudio':
      return callLMStudio(provider, messages, contextDocuments);
    case 'openai':
      return callOpenAI(provider, messages, contextDocuments);
    case 'claude':
      return callClaude(provider, messages, contextDocuments);
    case 'google':
      return callGoogle(provider, messages, contextDocuments);
    default:
      throw new Error(`Unknown provider type: ${provider.type}`);
  }
}

async function chatCompletionStream(provider, messages, contextDocuments, onChunk) {
  switch (provider.type) {
    case 'lmstudio':
      return callLMStudioStream(provider, messages, contextDocuments, onChunk);
    case 'openai':
      return callOpenAIStream(provider, messages, contextDocuments, onChunk);
    default:
      return null;
  }
}

function buildStreamRequest(provider, messages, contextDocuments) {
  const docPrompt = buildSystemPrompt(contextDocuments);
  const messagesForApi = convertToOpenAIMessages(messages, docPrompt);
  if (provider.type === 'lmstudio') {
    const baseUrl = (provider.baseUrl || 'http://127.0.0.1:1234')
      .replace(/\/$/, '')
      .replace(/localhost/gi, '127.0.0.1');
    const url = baseUrl.endsWith('/v1') ? `${baseUrl}/chat/completions` : `${baseUrl}/v1/chat/completions`;
    const body = JSON.stringify({
      model: provider.modelId || 'local-model',
      messages: messagesForApi,
      temperature: 0.7,
      stream: true,
    });
    return { url, options: { method: 'POST', headers: { 'Content-Type': 'application/json' } }, body };
  }
  if (provider.type === 'openai') {
    const body = JSON.stringify({
      model: provider.modelId || 'gpt-4o',
      messages: messagesForApi,
      temperature: 0.7,
      stream: true,
    });
    return {
      url: 'https://api.openai.com/v1/chat/completions',
      options: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${provider.apiKey}`,
        },
      },
      body,
    };
  }
  if (provider.type === 'claude') {
    const claudeMessages = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
    const body = JSON.stringify({
      model: provider.modelId || 'claude-3-5-sonnet-20241022',
      max_tokens: 4096,
      system: docPrompt,
      messages: claudeMessages,
      stream: true,
    });
    return {
      url: 'https://api.anthropic.com/v1/messages',
      options: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': provider.apiKey,
          'anthropic-version': '2023-06-01',
        },
      },
      body,
    };
  }
  if (provider.type === 'google') {
    const contents = [];
    for (const m of messages) {
      if (m.role === 'user' || m.role === 'assistant') {
        const role = m.role === 'user' ? 'user' : 'model';
        contents.push({ role, parts: [{ text: m.content }] });
      }
    }
    const modelId = provider.modelId || 'gemini-1.5-flash';
    const body = JSON.stringify({
      contents,
      systemInstruction: { parts: [{ text: docPrompt }] },
    });
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:streamGenerateContent?alt=sse&key=${encodeURIComponent(provider.apiKey)}`,
      options: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
      body,
    };
  }
  return null;
}

module.exports = { chatCompletion, chatCompletionStream, buildStreamRequest };
