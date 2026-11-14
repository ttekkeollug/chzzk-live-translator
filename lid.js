// 입력 언어 자동 감지 (오프스크린 문서에서 사용)
//  - whisperLangProbs: Whisper 디코더의 첫 토큰(언어 토큰) 확률로 말소리의 언어를 판별
//  - LangTracker: 구간별 판별을 누적해 언어가 실제로 바뀌었을 때만 전환 (오판 한 번에 흔들리지 않게)
//  - textLang: 인식된 문장 텍스트로 언어를 추정 (API 엔진처럼 소리 판별이 없을 때)
(function (g) {
  // Whisper 언어 토큰 확률 → { ko: 0.9, ja: 0.05, … } (후보 언어만 정규화)
  // pipe: transformers.js 'automatic-speech-recognition' 파이프라인, Tensor: transformers.js Tensor 클래스
  async function whisperLangProbs(pipe, Tensor, samples, cands) {
    const gc = pipe.model.generation_config || {};
    const map = gc.lang_to_id || {};
    const list = cands.filter((c) => map['<|' + c + '|>'] != null);
    if (!list.length || gc.decoder_start_token_id == null) throw new Error('no language tokens');
    const inputs = await pipe.processor(samples);
    const ids = new Tensor('int64', BigInt64Array.from([BigInt(gc.decoder_start_token_id)]), [1, 1]);
    let out = null;
    try {
      out = await pipe.model({ input_features: inputs.input_features, decoder_input_ids: ids });
      const L = out.logits.data;
      const vocab = out.logits.dims[out.logits.dims.length - 1];
      const base = L.length - vocab; // 마지막 위치
      const vals = list.map((c) => Number(L[base + map['<|' + c + '|>']]));
      const m = Math.max(...vals);
      const ex = vals.map((v) => Math.exp(v - m));
      const sum = ex.reduce((a, b) => a + b, 0);
      const probs = {};
      list.forEach((c, i) => { probs[c] = ex[i] / sum; });
      return probs;
    } finally {
      // GPU에 남는 캐시 텐서를 바로 해제
      const free = (t) => { try { if (t && typeof t.dispose === 'function') t.dispose(); } catch (e) { /* 무시 */ } };
      if (out) for (const k of Object.keys(out)) free(out[k]);
      free(inputs.input_features);
      free(ids);
    }
  }

  // 지수 감쇠 누적: 실제 방송 음성 표본으로 시험해 정한 값 (오전환 약 0.5회/100구간, 전환까지 약 3구간)
  class LangTracker {
    constructor({ decay = 0.6, margin = 0.8, minConf = 0, fastConf = 1.01, initial = null } = {}) {
      this.fastConf = fastConf; // 이만큼 확실한 구간은 한 번에 전환 (실제 언어 전환은 첫 문장부터 99% 이상으로 나옴)
      this.decay = decay;
      this.margin = margin;
      this.minConf = minConf; // 이보다 애매한 구간(외래어가 섞인 문장 등)은 근거로 쓰지 않음
      this.acc = {};
      this.cur = initial;
      this.settled = false; // 소리로 한 번이라도 확정했는지
    }
    // probs: 언어별 확률. 반환: 언어가 바뀌었으면 새 언어, 아니면 null
    update(probs) {
      let best = null, bp = 0;
      for (const [l, v] of Object.entries(probs)) if (v > bp) { bp = v; best = l; }
      if (bp < this.minConf) return null;
      for (const [l, v] of Object.entries(probs)) this.acc[l] = (this.acc[l] || 0) * this.decay + v;
      for (const l of Object.keys(this.acc)) if (!(l in probs)) this.acc[l] *= this.decay;
      if (!this.settled) {
        // 처음에는 한 구간만으로도 어느 정도 확실하면 바로 정함 (방송 시작 직후 지연을 줄임)
        if (bp < Math.max(0.8, this.minConf)) return null;
        this.settled = true;
        if (best === this.cur) return null;
        this.cur = best;
        return best;
      }
      if (best !== this.cur && bp >= this.fastConf) {
        this.cur = best;
        return best;
      }
      let a = null, av = -1;
      for (const [l, v] of Object.entries(this.acc)) if (v > av) { av = v; a = l; }
      if (a && a !== this.cur && av - (this.acc[this.cur] || 0) >= this.margin) {
        this.cur = a;
        return a;
      }
      return null;
    }
    // 사용자가 입력 언어를 직접 고정했을 때
    lock(code) {
      this.cur = code;
      this.acc = {};
      this.settled = true;
    }
    reset(initial) {
      this.cur = initial || null;
      this.acc = {};
      this.settled = false;
    }
  }

  // 문장 텍스트로 언어 추정 — 문자 체계로 확실히 구분되는 언어만 판단하고, 나머지는 null
  function scriptLang(text) {
    const t = String(text || '');
    const count = (re) => (t.match(re) || []).length;
    const hangul = count(/[가-힣ㄱ-ㆎ]/g);
    const kana = count(/[぀-ヿ]/g);
    const han = count(/[一-鿿]/g);
    const thai = count(/[฀-๿]/g);
    const cyr = count(/[Ѐ-ӿ]/g);
    const letters = count(/\p{L}/gu) || 1;
    if (hangul / letters > 0.3) return 'ko';
    if (kana > 0 && (kana + han) / letters > 0.3) return 'ja';
    if (han / letters > 0.3) return 'zh';
    if (thai / letters > 0.3) return 'th';
    if (cyr / letters > 0.3) return 'ru';
    if (/[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i.test(t)) return 'vi';
    return null;
  }

  // 크롬 내장 LanguageDetector(Chrome 138+)가 있으면 쓰고, 없으면 문자 체계로 추정
  let detector = null;
  let detectorTried = false;
  async function textLang(text, cands) {
    const s = scriptLang(text);
    if (s && cands.includes(s)) return s;
    if (!detectorTried) {
      detectorTried = true;
      try {
        if ('LanguageDetector' in g) {
          const av = await g.LanguageDetector.availability();
          if (av === 'available') detector = await g.LanguageDetector.create();
        }
      } catch (e) { detector = null; }
    }
    if (detector && String(text).length >= 8) {
      try {
        const r = await detector.detect(text);
        const top = r && r[0];
        if (top && top.confidence >= 0.6) {
          const code = String(top.detectedLanguage || '').split('-')[0];
          if (cands.includes(code)) return code;
        }
      } catch (e) { /* 무시 */ }
    }
    return s;
  }

  // Whisper API가 돌려주는 언어 이름(korean, japanese …) 또는 코드 → 확장 코드
  const WHISPER_NAMES = {
    korean: 'ko', japanese: 'ja', english: 'en', chinese: 'zh', mandarin: 'zh', cantonese: 'zh', spanish: 'es',
    french: 'fr', german: 'de', russian: 'ru', vietnamese: 'vi', thai: 'th', indonesian: 'id', portuguese: 'pt'
  };
  function fromWhisperName(n) {
    const k = String(n || '').toLowerCase().trim();
    if (WHISPER_NAMES[k]) return WHISPER_NAMES[k];
    const c = k.split(/[-_]/)[0];
    return Object.values(WHISPER_NAMES).includes(c) ? c : null;
  }

  // 쉬지 않고 이어지는 말(노래·빠른 말)의 중간 결과에서 이미 굳은 앞부분을 어디까지 자막으로 확정할지
  // 끝의 몇 글자(띄어 쓰는 언어는 두 단어)는 인식기가 아직 고칠 수 있으므로 남겨 둠
  // 문장부호가 있으면 그 뒤에서, 없으면 띄어쓰기에서, 둘 다 없으면(일본어·중국어) 글자 단위로 자름
  function stableCut(text) {
    const t = String(text || '');
    const spaced = (t.match(/ /g) || []).length >= 2;
    let limit;
    if (spaced) {
      const words = t.trimEnd().split(' ');
      if (words.length <= 3) return 0;
      limit = t.trimEnd().length - words.slice(-2).join(' ').length;
    } else {
      limit = t.length - 4;
    }
    const minLen = spaced ? 12 : 6;
    if (limit < minLen) return 0;
    const head = t.slice(0, limit);
    let cut = -1;
    const punct = /[。、！？!?.,，…]/g;
    let m;
    while ((m = punct.exec(head))) if (m.index + 1 >= minLen) cut = m.index + 1;
    if (cut < 0 && spaced) { const sp = head.lastIndexOf(' '); if (sp >= minLen) cut = sp + 1; }
    if (cut < 0) cut = spaced ? 0 : limit;
    return cut;
  }

  g.CLTR_LID = { whisperLangProbs, LangTracker, scriptLang, textLang, fromWhisperName, stableCut };
})(typeof globalThis !== 'undefined' ? globalThis : self);
