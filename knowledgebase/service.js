const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const KB_FILE = 'knowledgebase.json';
const DEFAULT_EMBEDDING_MODEL = 'nomic-embed-text-v1.5';
const MAX_CHUNK_TOKENS = 650;
const TARGET_CHUNK_TOKENS = 550;
const OVERLAP_TOKENS = 90;

function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text || '').length / 4));
}

function normalizeContent(content) {
  return String(content || '').replace(/\r\n/g, '\n').trim();
}

function createFingerprint(content) {
  const normalized = normalizeContent(content);
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

function summarizeDocument(content) {
  const normalized = normalizeContent(content);
  const line = normalized
    .split('\n')
    .map((s) => s.trim())
    .find(Boolean) || '';
  if (!line) return 'Untitled document';
  return line.length > 120 ? `${line.slice(0, 117)}...` : line;
}

function anchorPreview(text, maxLen = 180) {
  const clean = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return '';
  return clean.length > maxLen ? clean.slice(0, maxLen) : clean;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return -1;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const av = Number(a[i]) || 0;
    const bv = Number(b[i]) || 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na <= 0 || nb <= 0) return -1;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function httpJson(url, options = {}, bodyObj = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const body = bodyObj ? JSON.stringify(bodyObj) : '';
    const req = mod.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method: options.method || 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {}),
          ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk.toString();
        });
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = raw ? JSON.parse(raw) : null;
          } catch (_) {}
          const ok = res.statusCode >= 200 && res.statusCode < 300;
          if (!ok) {
            const msg = parsed?.error?.message || parsed?.message || raw || res.statusMessage || 'Request failed';
            reject(new Error(msg));
            return;
          }
          resolve(parsed);
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(120000);
    if (body) req.write(body);
    req.end();
  });
}

function splitMarkdownBlocks(content) {
  const lines = String(content || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let inFence = false;
  let fenceLines = [];
  let paragraph = [];
  let headingPath = [];

  const flushParagraph = () => {
    const text = paragraph.join('\n').trim();
    if (!text) {
      paragraph = [];
      return;
    }
    blocks.push({ type: 'text', headingPath: headingPath.join(' > '), text });
    paragraph = [];
  };

  const flushFence = () => {
    const text = fenceLines.join('\n').trim();
    if (!text) {
      fenceLines = [];
      return;
    }
    blocks.push({ type: 'code', headingPath: headingPath.join(' > '), text });
    fenceLines = [];
  };

  for (const rawLine of lines) {
    const line = String(rawLine || '');
    if (/^```/.test(line.trim())) {
      if (inFence) {
        fenceLines.push(line);
        flushFence();
        inFence = false;
      } else {
        flushParagraph();
        inFence = true;
        fenceLines.push(line);
      }
      continue;
    }

    if (inFence) {
      fenceLines.push(line);
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (headingMatch) {
      flushParagraph();
      const depth = headingMatch[1].length;
      const title = headingMatch[2].trim();
      headingPath = headingPath.slice(0, depth - 1);
      headingPath.push(title);
      blocks.push({ type: 'heading', headingPath: headingPath.join(' > '), text: `${headingMatch[1]} ${title}` });
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  if (inFence) flushFence();
  return blocks;
}

function tailTokens(text, tokenCount) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  if (words.length <= tokenCount) return words.join(' ');
  return words.slice(words.length - tokenCount).join(' ');
}

function chunkMarkdown(content) {
  const blocks = splitMarkdownBlocks(content);
  const chunks = [];
  let currentText = '';
  let currentHeading = '';
  let currentTokens = 0;

  const flushChunk = () => {
    const text = currentText.trim();
    if (!text) {
      currentText = '';
      currentTokens = 0;
      return;
    }
    chunks.push({
      chunkIndex: chunks.length,
      headingPath: currentHeading || '',
      tokenCount: estimateTokens(text),
      content: text,
    });
    const overlapText = tailTokens(text, OVERLAP_TOKENS);
    currentText = overlapText ? `${overlapText}\n` : '';
    currentTokens = estimateTokens(currentText);
  };

  for (const block of blocks) {
    const blockText = String(block.text || '').trim();
    if (!blockText) continue;
    const blockTokens = estimateTokens(blockText);
    if (block.headingPath) currentHeading = block.headingPath;

    if (blockTokens > MAX_CHUNK_TOKENS) {
      flushChunk();
      const words = blockText.split(/\s+/).filter(Boolean);
      let cursor = 0;
      while (cursor < words.length) {
        const slice = words.slice(cursor, cursor + TARGET_CHUNK_TOKENS);
        if (!slice.length) break;
        const text = slice.join(' ');
        chunks.push({
          chunkIndex: chunks.length,
          headingPath: currentHeading || '',
          tokenCount: estimateTokens(text),
          content: text,
        });
        cursor += Math.max(1, TARGET_CHUNK_TOKENS - OVERLAP_TOKENS);
      }
      currentText = '';
      currentTokens = 0;
      continue;
    }

    if (currentTokens + blockTokens > TARGET_CHUNK_TOKENS && currentText.trim()) {
      flushChunk();
    }
    currentText += `${blockText}\n\n`;
    currentTokens = estimateTokens(currentText);
  }

  flushChunk();
  return chunks;
}

class KnowledgebaseService {
  constructor(userDataPath) {
    this.filePath = path.join(userDataPath, KB_FILE);
    this.cache = null;
  }

  async load() {
    if (this.cache) return this.cache;
    try {
      const raw = await fs.promises.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      this.cache = {
        documents: toArray(parsed.documents),
        chunks: toArray(parsed.chunks),
        chunkEmbeddings: toArray(parsed.chunkEmbeddings),
      };
    } catch (_) {
      this.cache = { documents: [], chunks: [], chunkEmbeddings: [] };
    }
    return this.cache;
  }

  async save(nextDb) {
    const payload = JSON.stringify(nextDb, null, 2);
    const dir = path.dirname(this.filePath);
    await fs.promises.mkdir(dir, { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    await fs.promises.writeFile(tmpPath, payload, 'utf-8');
    await fs.promises.rename(tmpPath, this.filePath);
    this.cache = nextDb;
  }

  async clearAll() {
    const empty = { documents: [], chunks: [], chunkEmbeddings: [] };
    await this.save(empty);
    return { ok: true };
  }

  async getDocumentStatus({ path: docPath, content }) {
    const db = await this.load();
    const docFingerprint = createFingerprint(content);
    const found = db.documents.find((d) => d.docFingerprint === docFingerprint) || null;
    const samePathRows = db.documents
      .filter((d) => d.path && docPath && d.path === docPath)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const staleByPath = !found && samePathRows.length > 0;
    return {
      docFingerprint,
      inKnowledgebase: Boolean(found),
      document: found,
      path: docPath || '',
      staleByPath,
      staleFingerprints: staleByPath ? samePathRows.map((d) => d.docFingerprint) : [],
    };
  }

  async listDocuments() {
    const db = await this.load();
    const byPath = new Map();
    for (const row of db.documents) {
      if (!row.path) continue;
      const current = byPath.get(row.path);
      if (!current || (row.updatedAt || 0) > (current.updatedAt || 0)) {
        byPath.set(row.path, row);
      }
    }
    return [...db.documents]
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .map((row) => {
        const latestForPath = row.path ? byPath.get(row.path) : null;
        const stale = Boolean(latestForPath && latestForPath.docFingerprint !== row.docFingerprint);
        return { ...row, stale };
      });
  }

  async addDocument({ path: docPath, content, baseUrl, model, replacePathVersions = false }) {
    const normalized = normalizeContent(content);
    if (!normalized) {
      throw new Error('Cannot add empty document to knowledgebase.');
    }
    const db = await this.load();
    const now = Date.now();
    const docFingerprint = createFingerprint(normalized);
    const existing = db.documents.find((d) => d.docFingerprint === docFingerprint);
    if (existing) {
      let nextDb = clone(db);
      if (replacePathVersions && docPath) {
        const staleFingerprints = nextDb.documents
          .filter((d) => d.path === docPath && d.docFingerprint !== docFingerprint)
          .map((d) => d.docFingerprint);
        if (staleFingerprints.length) {
          nextDb = this.removeFingerprints(nextDb, staleFingerprints);
        }
      }
      nextDb.documents = nextDb.documents.map((d) =>
        d.docFingerprint === docFingerprint
          ? { ...d, path: docPath || d.path, updatedAt: now }
          : d
      );
      await this.save(nextDb);
      return { docFingerprint, alreadyExists: true, chunkCount: existing.chunkCount || 0 };
    }

    const chunks = chunkMarkdown(normalized);
    if (!chunks.length) {
      throw new Error('Failed to generate chunks for this document.');
    }

    const vectors = await this.embedTexts({
      baseUrl,
      model: model || DEFAULT_EMBEDDING_MODEL,
      inputs: chunks.map((c) => c.content),
    });
    if (!vectors.length || vectors.length !== chunks.length) {
      throw new Error('Embedding model returned unexpected vector count.');
    }

    const documentRow = {
      docFingerprint,
      path: docPath || '',
      summary: summarizeDocument(normalized),
      createdAt: now,
      updatedAt: now,
      chunkCount: chunks.length,
    };
    const chunkRows = chunks.map((chunk, idx) => {
      const chunkId = `${docFingerprint}:${idx}`;
      return {
        chunkId,
        docFingerprint,
        path: docPath || '',
        chunkIndex: chunk.chunkIndex,
        headingPath: chunk.headingPath,
        tokenCount: chunk.tokenCount,
        content: chunk.content,
      };
    });
    const embeddingRows = chunkRows.map((chunk, idx) => ({
      chunkId: chunk.chunkId,
      docFingerprint,
      embedding: vectors[idx],
    }));

    const nextDb = clone(db);
    const cleanedDb = replacePathVersions && docPath
      ? this.removeFingerprints(
          nextDb,
          nextDb.documents
            .filter((d) => d.path === docPath && d.docFingerprint !== docFingerprint)
            .map((d) => d.docFingerprint)
        )
      : nextDb;
    cleanedDb.documents.push(documentRow);
    cleanedDb.chunks.push(...chunkRows);
    cleanedDb.chunkEmbeddings.push(...embeddingRows);
    await this.save(cleanedDb);
    return { docFingerprint, alreadyExists: false, chunkCount: chunks.length };
  }

  removeFingerprints(db, fingerprints) {
    const removeSet = new Set(toArray(fingerprints).filter(Boolean));
    if (!removeSet.size) return db;
    const nextDb = clone(db);
    const chunkIds = new Set(
      nextDb.chunks
        .filter((c) => removeSet.has(c.docFingerprint))
        .map((c) => c.chunkId)
    );
    nextDb.chunkEmbeddings = nextDb.chunkEmbeddings.filter(
      (row) => !chunkIds.has(row.chunkId) && !removeSet.has(row.docFingerprint)
    );
    nextDb.chunks = nextDb.chunks.filter((c) => !removeSet.has(c.docFingerprint));
    nextDb.documents = nextDb.documents.filter((d) => !removeSet.has(d.docFingerprint));
    return nextDb;
  }

  async deleteDocumentByFingerprint(docFingerprint) {
    const fp = String(docFingerprint || '').trim();
    if (!fp) throw new Error('docFingerprint is required.');
    const db = await this.load();
    const hasDoc = db.documents.some((d) => d.docFingerprint === fp);
    if (!hasDoc) return { ok: true, deleted: false };

    const nextDb = clone(db);
    const chunkIds = new Set(
      nextDb.chunks
        .filter((c) => c.docFingerprint === fp)
        .map((c) => c.chunkId)
    );

    nextDb.chunkEmbeddings = nextDb.chunkEmbeddings.filter(
      (row) => !chunkIds.has(row.chunkId) && row.docFingerprint !== fp
    );
    nextDb.chunks = nextDb.chunks.filter((c) => c.docFingerprint !== fp);
    nextDb.documents = nextDb.documents.filter((d) => d.docFingerprint !== fp);
    await this.save(nextDb);
    return { ok: true, deleted: true };
  }

  async searchSimilarChunks({ query, baseUrl, model, topK = 12, maxPerDocument = 3 }) {
    const cleanQuery = String(query || '').trim();
    if (!cleanQuery) return [];
    const db = await this.load();
    if (!db.chunkEmbeddings.length) return [];

    const [queryVector] = await this.embedTexts({
      baseUrl,
      model: model || DEFAULT_EMBEDDING_MODEL,
      inputs: [cleanQuery],
    });
    if (!queryVector) return [];

    const chunkById = new Map(db.chunks.map((c) => [c.chunkId, c]));
    const scored = db.chunkEmbeddings
      .map((row) => {
        const chunk = chunkById.get(row.chunkId);
        if (!chunk) return null;
        const score = cosineSimilarity(queryVector, row.embedding);
        return { score, chunk };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);

    const perDocCounter = new Map();
    const selected = [];
    for (const row of scored) {
      if (selected.length >= Math.max(1, topK)) break;
      const fp = row.chunk.docFingerprint;
      const used = perDocCounter.get(fp) || 0;
      if (used >= Math.max(1, maxPerDocument)) continue;
      perDocCounter.set(fp, used + 1);
      selected.push(row);
    }

    return selected.map(({ score, chunk }) => ({
      score,
      docFingerprint: chunk.docFingerprint,
      path: chunk.path,
      headingPath: chunk.headingPath,
      chunkIndex: chunk.chunkIndex,
      content: chunk.content,
    }));
  }

  async buildContextDocuments(args) {
    const rows = await this.searchSimilarChunks(args);
    const contextDocuments = rows.map((row, idx) => ({
      path: row.path || row.docFingerprint,
      content: [
        `Source: ${row.path || 'unknown'}`,
        row.headingPath ? `Section: ${row.headingPath}` : '',
        `Rank: ${idx + 1}`,
        '',
        row.content,
      ]
        .filter(Boolean)
        .join('\n'),
    }));
    const references = rows.map((row, idx) => ({
      rank: idx + 1,
      path: row.path || row.docFingerprint,
      headingPath: row.headingPath || '',
      chunkIndex: row.chunkIndex,
      score: row.score,
      anchor: anchorPreview(row.content, 180),
    }));
    return { contextDocuments, references };
  }

  async embedTexts({ baseUrl, model, inputs }) {
    const cleanInputs = toArray(inputs).map((s) => String(s || '').trim()).filter(Boolean);
    if (!cleanInputs.length) return [];
    const root = String(baseUrl || 'http://127.0.0.1:1234')
      .replace(/\/$/, '')
      .replace(/localhost/gi, '127.0.0.1');
    const url = root.endsWith('/v1') ? `${root}/embeddings` : `${root}/v1/embeddings`;
    const data = await httpJson(
      url,
      { method: 'POST' },
      {
        model: model || DEFAULT_EMBEDDING_MODEL,
        input: cleanInputs,
      }
    );
    const list = toArray(data?.data)
      .sort((a, b) => (a.index || 0) - (b.index || 0))
      .map((row) => row.embedding)
      .filter((vec) => Array.isArray(vec) && vec.length > 0);
    if (list.length !== cleanInputs.length) {
      throw new Error('Embedding count mismatch from LM Studio.');
    }
    return list;
  }
}

function createKnowledgebaseService(userDataPath) {
  return new KnowledgebaseService(userDataPath);
}

module.exports = {
  createKnowledgebaseService,
  createFingerprint,
  DEFAULT_EMBEDDING_MODEL,
};
