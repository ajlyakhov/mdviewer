let transcriber = null;

process.on('message', async (msg) => {
  if (msg.type === 'load') {
    try {
      const { pipeline, env } = await import('@xenova/transformers');
      const backend = String(msg.backend || 'native').toLowerCase();
      env.cacheDir = msg.cacheDir;
      env.allowLocalModels = false;
      if (backend === 'wasm') {
        globalThis.self = globalThis.self || globalThis;
        if (env.backends?.onnx?.wasm) {
          env.backends.onnx.wasm.numThreads = 1;
          env.backends.onnx.wasm.simd = true;
          env.backends.onnx.wasm.proxy = false;
        }
        if (env.onnx?.wasm) {
          env.onnx.wasm.numThreads = 1;
        }
      }
      console.error('[whisper-worker] loading model', msg.model, 'backend:', backend);
      transcriber = await pipeline('automatic-speech-recognition', msg.model, {
        progress_callback: (p) => process.send({ type: 'progress', data: p }),
        ...(backend === 'wasm' ? { device: 'wasm' } : {}),
      });
      process.send({ type: 'ready', backend });
    } catch (e) {
      process.send({ type: 'load-error', error: e?.message || String(e) });
    }
    return;
  }

  if (msg.type === 'transcribe') {
    if (!transcriber) {
      process.send({ type: 'error', id: msg.id, error: 'Whisper model not loaded' });
      return;
    }
    try {
      const audio = new Float32Array(msg.audioData);
      const languageHint = String(msg.languageHint || '').trim().toLowerCase();
      const options = { sampling_rate: msg.sampleRate || 16000 };
      if (languageHint) options.language = languageHint;
      console.error(
        '[whisper-worker] transcribing, samples:',
        audio.length,
        'rate:',
        msg.sampleRate,
        'languageHint:',
        languageHint || 'auto'
      );
      const result = await transcriber(audio, options);
      console.error('[whisper-worker] result:', result.text);
      process.send({
        type: 'result',
        id: msg.id,
        data: { text: result.text?.trim() || '' },
      });
    } catch (e) {
      console.error('[whisper-worker] transcribe error:', e);
      process.send({ type: 'error', id: msg.id, error: e?.message || String(e) });
    }
  }
});
