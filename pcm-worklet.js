// 탭 오디오를 모노 Float32 블록으로 묶어 메인 스레드로 넘기는 AudioWorklet
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 4096;
    this.buf = new Float32Array(this.size);
    this.pos = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input.length > 0 && input[0]) {
      const chs = input.length;
      const n = input[0].length;
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let c = 0; c < chs; c++) s += input[c][i];
        this.buf[this.pos++] = s / chs;
        if (this.pos === this.size) {
          const out = this.buf;
          this.port.postMessage(out, [out.buffer]);
          this.buf = new Float32Array(this.size);
          this.pos = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCapture);

// 페이지에서 받아 온 16kHz PCM을 다시 오디오 스트림으로 내보내는 재생기
// (크롬 내장 음성 인식에 MediaStreamTrack으로 넘기기 위해 사용)
class PcmPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.cap = sampleRate * 4;
    this.ring = new Float32Array(this.cap);
    this.r = 0;
    this.w = 0;
    this.len = 0;
    this.port.onmessage = (e) => {
      const d = e.data;
      for (let i = 0; i < d.length; i++) {
        this.ring[this.w] = d[i];
        this.w = (this.w + 1) % this.cap;
        if (this.len < this.cap) this.len++;
        else this.r = (this.r + 1) % this.cap;
      }
      // 1초 넘게 밀리면 오래된 소리를 버려 실시간성 유지
      const maxLag = sampleRate;
      if (this.len > maxLag) {
        const drop = this.len - maxLag;
        this.r = (this.r + drop) % this.cap;
        this.len -= drop;
      }
    };
  }

  process(inputs, outputs) {
    const out = outputs[0] && outputs[0][0];
    if (!out) return true;
    for (let i = 0; i < out.length; i++) {
      if (this.len > 0) {
        out[i] = this.ring[this.r];
        this.r = (this.r + 1) % this.cap;
        this.len--;
      } else {
        out[i] = 0;
      }
    }
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);
    return true;
  }
}

registerProcessor('pcm-player', PcmPlayer);
