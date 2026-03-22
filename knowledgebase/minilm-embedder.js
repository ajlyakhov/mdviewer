let extractorPromise = null;

async function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const mod = await import('@xenova/transformers');
      const { pipeline } = mod;
      return pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    })();
  }
  return extractorPromise;
}

function tensorToMatrix(tensor) {
  if (!tensor) return [];
  const dims = tensor.dims || [];
  const data = Array.from(tensor.data || []);
  if (dims.length === 1) {
    return [data];
  }
  if (dims.length >= 2) {
    const rows = dims[0];
    const cols = dims[dims.length - 1];
    const out = [];
    for (let r = 0; r < rows; r++) {
      out.push(data.slice(r * cols, (r + 1) * cols));
    }
    return out;
  }
  return [];
}

async function embedWithMiniLM(inputs) {
  const cleanInputs = (inputs || []).map((s) => String(s || '').trim()).filter(Boolean);
  if (!cleanInputs.length) return [];
  const extractor = await getExtractor();
  const tensor = await extractor(cleanInputs, { pooling: 'mean', normalize: true });
  const matrix = tensorToMatrix(tensor);
  if (!matrix.length || matrix.length !== cleanInputs.length) {
    throw new Error('MiniLM returned invalid embeddings.');
  }
  return matrix;
}

module.exports = {
  embedWithMiniLM,
};
