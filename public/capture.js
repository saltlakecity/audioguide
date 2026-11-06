// Only PCM frames cross to the main thread; the microphone is never connected audibly.
class VoiceCapture extends AudioWorkletProcessor {
  constructor() {
    super(); this.buffer = new Float32Array(512); this.offset = 0; this.weight = 0; this.sum = 0;
  }
  process(inputs) {
    const input = inputs[0]?.[0]; if (!input) return true;
    const ratio = sampleRate / 16000;
    for (const sample of input) {
      let left = 1;
      while (left > 0) {
        const take = Math.min(left, ratio - this.weight);
        this.sum += sample * take; this.weight += take; left -= take;
        if (this.weight >= ratio - 1e-8) {
          this.buffer[this.offset++] = this.sum / ratio; this.weight = 0; this.sum = 0;
          if (this.offset == this.buffer.length) {
            this.port.postMessage(this.buffer, [this.buffer.buffer]); this.buffer = new Float32Array(512); this.offset = 0;
          }
        }
      }
    }
    return true;
  }
}
registerProcessor('voice-capture', VoiceCapture);
