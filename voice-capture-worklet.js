class VoiceCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunkSize = 2048;
    this.buffer = new Float32Array(this.chunkSize);
    this.offset = 0;
  }

  _emitChunk() {
    if (this.offset <= 0) return;
    const out = this.buffer.slice(0, this.offset);
    this.port.postMessage(out, [out.buffer]);
    this.offset = 0;
  }

  process(inputs) {
    const input = inputs?.[0]?.[0];
    if (!input || input.length === 0) return true;

    let i = 0;
    while (i < input.length) {
      const remaining = this.chunkSize - this.offset;
      const take = Math.min(remaining, input.length - i);
      this.buffer.set(input.subarray(i, i + take), this.offset);
      this.offset += take;
      i += take;
      if (this.offset >= this.chunkSize) this._emitChunk();
    }

    return true;
  }
}

registerProcessor('voice-capture-processor', VoiceCaptureProcessor);
