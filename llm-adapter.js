/**
 * LLM adapter - supports LM Studio, Ollama, OpenAI, Claude, Google AI
 * All APIs called from main process to keep API keys secure
 * Uses Node http/https (not fetch) for reliable requests in Electron main process
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const DEFAULT_MAX_CONTEXT_TOKENS = 8192;
const DEFAULT_MAX_OUTPUT_TOKENS = 700;
const INPUT_SAFETY_MARGIN_TOKENS = 200;
const APPROX_CHARS_PER_TOKEN = 4;
const MAX_CONTEXT_DOCS = 5;
const MAX_CONTEXT_DOC_CHARS = 5000;
const DEBUG_PROMPT_BUDGET = process.env.MDVIEWER_DEBUG_PROMPT === '1';

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

function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text || '').length / APPROX_CHARS_PER_TOKEN));
}

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function resolveEffectiveContextLength(provider) {
  return (
    toInt(provider?.effectiveContextLength) ||
    toInt(provider?.loadedContextLength) ||
    toInt(provider?.maxContextLength) ||
    DEFAULT_MAX_CONTEXT_TOKENS
  );
}

function resolveMaxOutputTokens(provider, effectiveContextLength) {
  const configured =
    provider?.maxOutputTokensUserSet
      ? toInt(provider?.maxOutputTokens)
      : toInt(provider?.reservedOutputTokens);
  const fallback =
    effectiveContextLength <= 2300
      ? 700
      : effectiveContextLength <= 5000
        ? 1200
        : effectiveContextLength <= 12000
          ? 1600
          : 2000;
  const hardCap = Math.max(256, Math.floor(effectiveContextLength * 0.45));
  return Math.max(128, Math.min(configured || fallback, hardCap));
}

function resolveAdaptiveOutputTokens(provider, effectiveContextLength, approxPromptTokens) {
  const staticCap = resolveMaxOutputTokens(provider, effectiveContextLength);
  if (provider?.maxOutputTokensUserSet) return staticCap;
  const minCap = 700;
  const softHeadroom = Math.max(
    256,
    effectiveContextLength - approxPromptTokens - INPUT_SAFETY_MARGIN_TOKENS - 300
  );
  const adaptiveTarget = Math.min(2400, softHeadroom);
  const hardCap = Math.max(256, Math.floor(effectiveContextLength * 0.45));
  return Math.max(minCap, Math.min(Math.max(staticCap, adaptiveTarget), hardCap));
}

function sanitizeMessages(messages) {
  return (messages || [])
    .map((m) => ({ role: m?.role, content: String(m?.content || '').trim() }))
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content);
}

function trimMessagesByBudget(messages, budgetTokens) {
  const source = sanitizeMessages(messages);
  if (!source.length) return { messages: [], droppedCount: 0 };
  const latestUserIndex = (() => {
    for (let i = source.length - 1; i >= 0; i--) {
      if (source[i].role === 'user') return i;
    }
    return -1;
  })();
  if (latestUserIndex < 0) {
    return { messages: source.slice(-20), droppedCount: Math.max(0, source.length - 20) };
  }

  const selected = [];
  const selectedIndexes = new Set();
  let usedTokens = 0;
  const addMessage = (idx, force = false) => {
    if (idx < 0 || idx >= source.length || selectedIndexes.has(idx)) return false;
    const m = source[idx];
    const content = m.content;
    const cost = estimateTokens(content) + 8;
    if (!force && usedTokens + cost > budgetTokens) return false;
    selected.unshift({ role: m.role, content });
    selectedIndexes.add(idx);
    usedTokens += cost;
    return true;
  };

  addMessage(latestUserIndex, true);
  for (let i = source.length - 1; i >= 0; i--) {
    if (i === latestUserIndex) continue;
    if (!addMessage(i, false)) continue;
    if (selected.length >= 24) break;
  }
  return {
    messages: selected,
    droppedCount: Math.max(0, source.length - selectedIndexes.size),
  };
}

function truncateDocumentsByBudget(contextDocuments, budgetTokens) {
  const docs = [];
  let usedTokens = 0;
  let truncatedCount = 0;
  for (const d of contextDocuments || []) {
    if (!d?.path) continue;
    if (docs.length >= MAX_CONTEXT_DOCS) break;
    const raw = String(d.content || '');
    let content = raw;
    if (content.length > MAX_CONTEXT_DOC_CHARS) {
      content = `${content.slice(0, MAX_CONTEXT_DOC_CHARS)}\n\n... [truncated]`;
      truncatedCount++;
    }
    const section = `--- ${d.path} ---\n${content}\n`;
    const cost = estimateTokens(section) + 10;
    if (docs.length > 0 && usedTokens + cost > budgetTokens) break;
    docs.push({ path: d.path, content });
    usedTokens += cost;
  }
  return { docs, truncatedCount };
}

function buildSystemPrompt(contextDocuments) {
  const priorityInstruction =
    'Priority: answer the latest user message first. Use earlier conversation only as supporting context.';
  if (!contextDocuments?.length) {
    return `${priorityInstruction}\nYou are helping the user analyze their documents. Answer based on their question.`;
  }
  const sections = contextDocuments.map(
    (d) => `--- ${d.path} ---\n${d.content || ''}\n`
  );
  return `${priorityInstruction}\nYou are helping the user analyze their markdown documents. Context from open files:\n\n${sections.join('\n')}\nAnswer based on the documents and the user's question.`;
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

function preparePromptContext(provider, messages, contextDocuments) {
  const effectiveContextLength = resolveEffectiveContextLength(provider);
  const baselineOutputTokens = resolveMaxOutputTokens(provider, effectiveContextLength);
  const baselineInputBudget = Math.max(
    512,
    effectiveContextLength - baselineOutputTokens - INPUT_SAFETY_MARGIN_TOKENS
  );
  const docBudget = Math.max(256, Math.floor(baselineInputBudget * 0.4));
  const messageBudget = Math.max(256, baselineInputBudget - docBudget);

  const { docs, truncatedCount } = truncateDocumentsByBudget(contextDocuments, docBudget);
  const { messages: trimmedMessages, droppedCount } = trimMessagesByBudget(messages, messageBudget);
  const systemPrompt = buildSystemPrompt(docs);
  const approxPromptTokens =
    estimateTokens(systemPrompt) +
    trimmedMessages.reduce((sum, m) => sum + estimateTokens(m.content) + 8, 0);
  const maxOutputTokens = resolveAdaptiveOutputTokens(
    provider,
    effectiveContextLength,
    approxPromptTokens
  );
  const inputBudgetTokens = Math.max(
    512,
    effectiveContextLength - maxOutputTokens - INPUT_SAFETY_MARGIN_TOKENS
  );

  const debug = {
    effectiveContextLength,
    baselineOutputTokens,
    maxOutputTokens,
    inputBudgetTokens,
    approxPromptTokens,
    droppedMessageCount: droppedCount,
    includedDocCount: docs.length,
    truncatedDocCount: truncatedCount,
  };
  if (DEBUG_PROMPT_BUDGET || provider?.debugPromptBudget) {
    console.info('[llm-adapter] prompt-budget', {
      provider: provider?.type,
      modelId: provider?.modelId,
      ...debug,
    });
  }

  return {
    systemPrompt,
    messages: trimmedMessages,
    contextDocuments: docs,
    maxOutputTokens,
    debug,
  };
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

async function callLMStudio(provider, messages, contextDocuments) {
  let baseUrl = (provider.baseUrl || 'http://127.0.0.1:1234')
    .replace(/\/$/, '')
    .replace(/localhost/gi, '127.0.0.1');
  const useNativeApi = provider.apiFormat !== 'openai' && !baseUrl.endsWith('/v1');
  const prepared = preparePromptContext(provider, messages, contextDocuments);
  const docPrompt = prepared.systemPrompt;
  const lastUser = [...prepared.messages].reverse().find((m) => m.role === 'user');
  const inputText = lastUser?.content || '';
  const bodyStr = useNativeApi
    ? JSON.stringify({
        model: provider.modelId || 'local-model',
        system_prompt:
          docPrompt +
          (prepared.messages.length > 1
            ? '\n\nConversation so far:\n' + prepared.messages.map((m) => `${m.role}: ${m.content}`).join('\n')
            : ''),
        input: inputText,
        max_tokens: prepared.maxOutputTokens,
        n_predict: prepared.maxOutputTokens,
        temperature: 0.7,
      })
    : JSON.stringify({
        model: provider.modelId || 'local-model',
        messages: convertToOpenAIMessages(prepared.messages, docPrompt),
        max_tokens: prepared.maxOutputTokens,
        temperature: 0.7,
      });
  const url = useNativeApi ? `${baseUrl}/api/v1/chat` : `${baseUrl}/v1/chat/completions`;
  const headers = { 'Content-Type': 'application/json' };
  if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`;
  const { ok, data } = await httpRequest(url, { method: 'POST', headers }, bodyStr);
  if (!ok) throw new Error(data?.error?.message || data?.message || 'Request failed');
  if (DEBUG_PROMPT_BUDGET || provider?.debugPromptBudget) {
    const finishReason = data?.choices?.[0]?.finish_reason ?? data?.finish_reason ?? null;
    if (finishReason) {
      console.info('[llm-adapter] finish-reason', { provider: provider?.type, modelId: provider?.modelId, finishReason });
    }
  }
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
  const prepared = preparePromptContext(provider, messages, contextDocuments);
  const body = {
    model: provider.modelId || 'local-model',
    messages: convertToOpenAIMessages(prepared.messages, prepared.systemPrompt),
    max_tokens: prepared.maxOutputTokens,
    temperature: 0.7,
    stream: true,
  };
  const url = baseUrl.endsWith('/v1') ? `${baseUrl}/chat/completions` : `${baseUrl}/v1/chat/completions`;
  await httpStream(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
      },
    },
    JSON.stringify(body),
    onChunk
  );
}

async function callOllama(provider, messages, contextDocuments) {
  const baseUrl = (provider.baseUrl || 'http://127.0.0.1:11434')
    .replace(/\/$/, '')
    .replace(/localhost/gi, '127.0.0.1');
  const prepared = preparePromptContext(provider, messages, contextDocuments);
  const body = {
    model: provider.modelId || 'llama3.2:1b',
    messages: convertToOpenAIMessages(prepared.messages, prepared.systemPrompt),
    max_tokens: prepared.maxOutputTokens,
    temperature: 0.7,
  };
  const bodyStr = JSON.stringify(body);
  const { ok, data } = await httpRequest(
    `${baseUrl}/v1/chat/completions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    },
    bodyStr
  );
  if (!ok) throw new Error(data?.error?.message || data?.message || 'Request failed');
  return data.choices?.[0]?.message?.content || '';
}

async function callOllamaStream(provider, messages, contextDocuments, onChunk) {
  const baseUrl = (provider.baseUrl || 'http://127.0.0.1:11434')
    .replace(/\/$/, '')
    .replace(/localhost/gi, '127.0.0.1');
  const prepared = preparePromptContext(provider, messages, contextDocuments);
  const body = {
    model: provider.modelId || 'llama3.2:1b',
    messages: convertToOpenAIMessages(prepared.messages, prepared.systemPrompt),
    max_tokens: prepared.maxOutputTokens,
    temperature: 0.7,
    stream: true,
  };
  await httpStream(
    `${baseUrl}/v1/chat/completions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    },
    JSON.stringify(body),
    onChunk
  );
}

async function callOpenAI(provider, messages, contextDocuments) {
  const prepared = preparePromptContext(provider, messages, contextDocuments);
  const body = {
    model: provider.modelId || 'gpt-4o',
    messages: convertToOpenAIMessages(prepared.messages, prepared.systemPrompt),
    max_tokens: prepared.maxOutputTokens,
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
  if (DEBUG_PROMPT_BUDGET || provider?.debugPromptBudget) {
    const finishReason = data?.choices?.[0]?.finish_reason ?? data?.finish_reason ?? null;
    if (finishReason) {
      console.info('[llm-adapter] finish-reason', { provider: provider?.type, modelId: provider?.modelId, finishReason });
    }
  }
  return data.choices?.[0]?.message?.content || '';
}

async function callOpenAIStream(provider, messages, contextDocuments, onChunk) {
  const prepared = preparePromptContext(provider, messages, contextDocuments);
  const body = {
    model: provider.modelId || 'gpt-4o',
    messages: convertToOpenAIMessages(prepared.messages, prepared.systemPrompt),
    max_tokens: prepared.maxOutputTokens,
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
  const prepared = preparePromptContext(provider, messages, contextDocuments);
  const claudeMessages = prepared.messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
  const body = {
    model: provider.modelId || 'claude-3-5-sonnet-20241022',
    max_tokens: prepared.maxOutputTokens,
    system: prepared.systemPrompt,
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
  if (DEBUG_PROMPT_BUDGET || provider?.debugPromptBudget) {
    const finishReason = data?.stop_reason ?? data?.stopReason ?? null;
    if (finishReason) {
      console.info('[llm-adapter] finish-reason', { provider: provider?.type, modelId: provider?.modelId, finishReason });
    }
  }
  const textBlock = data?.content?.find((c) => c.type === 'text');
  return textBlock?.text || '';
}

async function callGoogle(provider, messages, contextDocuments) {
  const prepared = preparePromptContext(provider, messages, contextDocuments);
  const contents = [];
  for (const m of prepared.messages) {
    if (m.role === 'user' || m.role === 'assistant') {
      const role = m.role === 'user' ? 'user' : 'model';
      contents.push({ role, parts: [{ text: m.content }] });
    }
  }
  const body = {
    contents,
    systemInstruction: { parts: [{ text: prepared.systemPrompt }] },
    generationConfig: { maxOutputTokens: prepared.maxOutputTokens },
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
  if (DEBUG_PROMPT_BUDGET || provider?.debugPromptBudget) {
    const finishReason = data?.candidates?.[0]?.finishReason ?? null;
    if (finishReason) {
      console.info('[llm-adapter] finish-reason', { provider: provider?.type, modelId: provider?.modelId, finishReason });
    }
  }
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  return text || '';
}

async function chatCompletion(provider, messages, contextDocuments) {
  switch (provider.type) {
    case 'lmstudio':
      return callLMStudio(provider, messages, contextDocuments);
    case 'ollama':
      return callOllama(provider, messages, contextDocuments);
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
    case 'ollama':
      return callOllamaStream(provider, messages, contextDocuments, onChunk);
    case 'openai':
      return callOpenAIStream(provider, messages, contextDocuments, onChunk);
    default:
      return null;
  }
}

function buildStreamRequest(provider, messages, contextDocuments) {
  const prepared = preparePromptContext(provider, messages, contextDocuments);
  const docPrompt = prepared.systemPrompt;
  const messagesForApi = convertToOpenAIMessages(prepared.messages, docPrompt);
  if (provider.type === 'lmstudio') {
    const baseUrl = (provider.baseUrl || 'http://127.0.0.1:1234')
      .replace(/\/$/, '')
      .replace(/localhost/gi, '127.0.0.1');
    const url = baseUrl.endsWith('/v1') ? `${baseUrl}/chat/completions` : `${baseUrl}/v1/chat/completions`;
    const body = JSON.stringify({
      model: provider.modelId || 'local-model',
      messages: messagesForApi,
      max_tokens: prepared.maxOutputTokens,
      temperature: 0.7,
      stream: true,
    });
    return { url, options: { method: 'POST', headers: { 'Content-Type': 'application/json' } }, body };
  }
  if (provider.type === 'ollama') {
    const baseUrl = (provider.baseUrl || 'http://127.0.0.1:11434')
      .replace(/\/$/, '')
      .replace(/localhost/gi, '127.0.0.1');
    const body = JSON.stringify({
      model: provider.modelId || 'llama3.2:1b',
      messages: messagesForApi,
      max_tokens: prepared.maxOutputTokens,
      temperature: 0.7,
      stream: true,
    });
    return { url: `${baseUrl}/v1/chat/completions`, options: { method: 'POST', headers: { 'Content-Type': 'application/json' } }, body };
  }
  if (provider.type === 'openai') {
    const body = JSON.stringify({
      model: provider.modelId || 'gpt-4o',
      messages: messagesForApi,
      max_tokens: prepared.maxOutputTokens,
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
    const claudeMessages = prepared.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
    const body = JSON.stringify({
      model: provider.modelId || 'claude-3-5-sonnet-20241022',
      max_tokens: prepared.maxOutputTokens,
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
    for (const m of prepared.messages) {
      if (m.role === 'user' || m.role === 'assistant') {
        const role = m.role === 'user' ? 'user' : 'model';
        contents.push({ role, parts: [{ text: m.content }] });
      }
    }
    const modelId = provider.modelId || 'gemini-1.5-flash';
    const body = JSON.stringify({
      contents,
      systemInstruction: { parts: [{ text: docPrompt }] },
      generationConfig: { maxOutputTokens: prepared.maxOutputTokens },
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
