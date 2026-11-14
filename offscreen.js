// 오프스크린 문서: 탭 오디오 캡처 → 입력 언어 자동 감지 → 음성 인식 → 원하는 언어로 번역
// 기본 동작은 API 키 없이 무료:
//   인식 1순위  크롬 내장 Web Speech (탭 오디오 트랙 직접 입력, Chrome 133+)
//   인식 2순위  브라우저 안에서 돌리는 Whisper (transformers.js, WebGPU/WASM)
//   번역 1순위  크롬 내장 Translator API (온디바이스)
//   번역 2순위  Google 번역 무료 엔드포인트
// 입력 언어 자동 감지:
//   크롬 내장 인식  작은 Whisper(tiny, 약 40MB)가 말소리 구간마다 언어를 판별 → 인식 언어를 바꿔 다시 시작
//   브라우저 Whisper  인식에 쓰는 모델이 구간마다 직접 판별
//   Whisper API  API가 돌려주는 언어(없으면 문장 텍스트로 판별)
'use strict';

const L = globalThis.CLTR_LANGS;
const LID = globalThis.CLTR_LID;
// 2.5초보다 짧은 소리는 판별이 불안정함 (실제 시험에서 1.6초 한국어 조각이 영어 81%로 나옴)
// → 짧은 구간은 이어 붙여 2.5초 이상이 되면 판별
const MIN_LID_SAMPLES = 16000 * 2.5;
const MAX_LID_SAMPLES = 16000 * 10;

const PROVIDERS = {
  groq: {
    stt: 'https://api.groq.com/openai/v1/audio/transcriptions',
    chat: 'https://api.groq.com/openai/v1/chat/completions'
  },
  openai: {
    stt: 'https://api.openai.com/v1/audio/transcriptions',
    chat: 'https://api.openai.com/v1/chat/completions'
  }
};

// Whisper 계열이 무음/잡음에서 자주 지어내는 문장
const HALLUCINATIONS = [
  '시청해주셔서 감사합니다', '시청해 주셔서 감사합니다', '구독과 좋아요 부탁드립니다', '구독과 좋아요', '구독 좋아요',
  '자막 제공', '자막제공', '다음 영상에서 만나요', 'MBC 뉴스', 'KBS 뉴스', '이덕영입니다',
  '한글자막', '영상편집', '감사합니다.',
  'ご視聴ありがとうございました', 'ご視聴ありがとうございます', 'チャンネル登録', '字幕視聴ありがとうございました',
  'Thank you for watching', 'Thanks for watching', 'Please subscribe', 'Subtitles by the Amara.org community',
  '字幕由Amara.org社区提供', '请不吝点赞', '订阅 转发', 'Sous-titres réalisés par la communauté d\'Amara.org',
  'Untertitel der Amara.org-Community', 'Продолжение следует'
];

const OUT_RATE = 16000;
// 노래·빠른 말 모드 모델 정밀도: 4비트(q4, 약 760MB) — 시험에서 8비트(약 1.1GB)와 오류율 차이가 0.6%p뿐
const FAST_DTYPE = { encoder_model: 'q4', decoder_model_merged: 'q4' };
const FRAME = 320; // 20ms @16kHz

let S = null;           // 설정
let stream = null;
let ctx = null;
let src = null;
let workletNode = null;
let running = false;
let sttMode = null;     // 'api' | 'local'
let captionSeq = 0;
let prevText = '';
let queue = [];
let busy = false;
let translateChain = Promise.resolve();
let speech = null;      // Web Speech 컨트롤러
let abortCtl = null;
let playerNode = null;  // 페이지 오디오 재생기 (방송 화면에서 시작한 경우)
let pcmPort = null;
let pendingPcm = [];
let workletLoaded = false;
let asr = null;         // 로컬 Whisper 파이프라인
let TF = null;          // transformers.js 모듈
let tracker = null;     // 입력 언어 추적기
let curTrack = null;    // 방송 소리 트랙 (모드를 바꿀 때 크롬 내장 인식을 다시 시작하는 데 씀)
let vad = null;         // 말소리 구간 분할기
const asrCache = new Map(); // 'normal' | 'fast' → Whisper 파이프라인
const asrLoadingBy = new Map();
let curSrc = 'ko';      // 지금 인식 중인 입력 언어
let segmenterOn = false;
let lidOn = false;      // 크롬 내장 인식용 언어 감지(Whisper tiny) 사용 중
let lidPipe = null;
let lidLoading = null;
let lidPending = null;  // 판별을 기다리는 최신 구간 (밀리면 이전 것은 버림)
let lidBusy = false;

// ---------- 메시지 ----------
function toBackground(msg) {
  return chrome.runtime.sendMessage({ ...msg, target: 'background' }).catch(() => {});
}
const I = globalThis.CLTR_I18N;
// 상태 문구는 번역 키({ key, vars })로 보내고, 화면 쪽에서 사용자가 고른 언어로 표시
const lastWarn = new Map();
function status(msg, level = 'info') {
  if (level === 'warn') {
    const id = JSON.stringify(msg);
    const t = lastWarn.get(id) || 0;
    if (Date.now() - t < 30000) return Promise.resolve(); // 같은 경고 반복 억제
    lastWarn.set(id, Date.now());
  }
  return toBackground({ type: 'status', msg, level });
}
function fatal(msg) { running = false; return toBackground({ type: 'fatal', msg }); }
function caption(c) { return toBackground({ type: 'caption', ...c }); }

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen') return false;
  if (msg.type === 'start') {
    sendResponse({ ok: true });
    start(msg.streamId, msg.settings, msg.source).catch((e) => fatal({ key: 'st.startFail', vars: { err: I.errVal(e) } }));
    return false;
  }
  if (msg.type === 'stop') {
    stop();
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === 'update') {
    // 방송 화면·팝업에서 입력/출력 언어를 바꾸면 번역을 멈추지 않고 바로 반영
    try { applyUpdate(msg.patch || {}); } catch (e) { /* 무시 */ }
    sendResponse({ ok: true });
    return false;
  }
  return false;
});

const errText = (e) => String((e && e.message) || e);

// ---------- 시작 / 정지 ----------
async function start(streamId, settings, source) {
  S = settings;
  running = true;
  captionSeq = 0;
  prevText = '';
  queue = [];
  workletLoaded = false;
  segmenterOn = false;
  lidOn = false;
  lidPending = null;
  S.targets = (Array.isArray(S.targets) ? S.targets : []).filter((c) => L.OUTPUTS.includes(c));
  // 듣는 언어는 기본 한국어 고정. '노래 자막'을 켜면 한국어·영어·일본어 중에서 자동으로 알아들음
  if (!(L.BY[S.src] && L.BY[S.src].input)) S.src = 'ko';
  S.song = !!S.song;
  S.songSrc = L.normSongSrc(S.songSrc);
  S.interval = L.normInterval(S.interval);
  S.detect = L.SONG_LANGS;
  // 자동 감지는 지난번에 감지한 언어(없으면 한국어)로 먼저 시작해 곧바로 자막이 나오게 함
  const guess = !S.song ? S.src : S.songSrc !== 'auto' ? S.songSrc : (S.detect.includes(S.lastSrc) ? S.lastSrc : S.detect[0]);
  tracker = new LID.LangTracker({ initial: guess, ...trackerParams() });
  if (!songAuto()) tracker.lock(guess);
  curSrc = guess;
  toBackground({ type: 'lang', code: curSrc, auto: songAuto(), detected: false });

  let track;
  if (source === 'page') {
    // 방송 화면의 영상에서 직접 받아 온 16kHz 소리 (탭 소리는 그대로 재생 중이므로 여기선 재생하지 않음)
    ctx = new AudioContext({ sampleRate: OUT_RATE });
    if (ctx.state === 'suspended') { try { await ctx.resume(); } catch (e) { /* 무시 */ } }
    await loadWorklet();
    playerNode = new AudioWorkletNode(ctx, 'pcm-player', { outputChannelCount: [1] });
    src = playerNode;
    const dest = ctx.createMediaStreamDestination();
    src.connect(dest);
    const silent = ctx.createGain();
    silent.gain.value = 0;
    src.connect(silent);
    silent.connect(ctx.destination);
    track = dest.stream.getAudioTracks()[0];
    for (const p of pendingPcm) playerNode.port.postMessage(p, [p.buffer]);
    pendingPcm = [];
  } else {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
      video: false
    });
    // 탭 캡처 시 원래 탭 소리가 꺼지므로 여기서 다시 재생
    ctx = new AudioContext();
    if (ctx.state === 'suspended') { try { await ctx.resume(); } catch (e) { /* 무시 */ } }
    src = ctx.createMediaStreamSource(stream);
    src.connect(ctx.destination);
    track = stream.getAudioTracks()[0];
  }

  curTrack = track;
  prepareLocalTranslators();
  await startRecognition();
}

// 인식 경로 선택 — 노래·빠른 말 모드면 고성능 Whisper, 아니면 사용자가 고른 엔진
async function startRecognition() {
  if (S.song) {
    // 노래 자막: 시험 결과(1.6배속 말 + 반주): 인식 오류율 whisper-base 53% · small 46% · large-v3-turbo 27%
    // → API 키가 있으면 Whisper API(large-v3-turbo), 없으면 브라우저에서 large-v3-turbo(GPU)
    await startChunked(S.apiKey ? 'api' : 'local');
    return;
  }
  switch (S.engine) {
    case 'api':
      if (!S.apiKey) { fatal('st.apiKeyMissing'); return; }
      await startChunked('api');
      return;
    case 'local':
      await startChunked('local');
      return;
    default: // 'auto' | 'webspeech'
      startSpeechPath();
  }
}

function startSpeechPath() {
  if (speech) return;
  sttMode = null;
  queue = [];
  speech = startWebSpeech(curTrack, (why) => {
    if (!running) return;
    if (S.engine === 'webspeech') { fatal({ key: 'st.wsFailFatal', vars: { why: { key: why } } }); return; }
    status({ key: 'st.wsFallback', vars: { why: { key: why } } }, 'warn');
    startChunked('local').catch((e) => fatal({ key: 'st.localFail', vars: { err: I.errVal(e) } }));
  });
  if (songAuto()) ensureLid();
}

// 노래 자막에서 입력 언어를 자동으로 알아듣는 중인지 (한국어·영어·일본어 중 하나로 고정하면 false)
function songAuto() {
  return !!S.song && S.songSrc === 'auto';
}

// ---------- 입력 언어 ----------
// 판별은 어느 인식 엔진이든 작은 Whisper(tiny)로 함 — 실제 음성 표본 시험에서 base보다 확신 있는 오판이 적었음
// 전환 기준 (한국어·일본어·영어 실제 음성 표본 + 브라우저 시험에서 나온 애매한 한국어 구간으로 맞춤):
//  - 95% 이상 확실한 문장은 그 문장에서 바로 전환 (실제 언어 전환의 90%가 첫 문장에서 따라감, 평균 1.1문장)
//  - 그보다 애매하면 여러 문장의 근거를 모아서 전환 — 영어 단어가 많이 섞인 한국어 한 문장(영어 80%)으로는 바뀌지 않음
//  - 70% 미만으로 애매한 구간은 근거로 쓰지 않음
function trackerParams() {
  return { decay: 0.5, margin: 0.8, minConf: 0.7, fastConf: 0.95 };
}

function setSrc(code, detected) {
  if (!L.BY[code]) return;
  const changed = code !== curSrc;
  curSrc = code;
  if (changed && speech) speech.setLang(code);
  if (changed) { prevText = ''; prepareLocalTranslators(); }
  toBackground({ type: 'lang', code, auto: songAuto(), detected: !!detected });
  if (changed && detected) status({ key: 'st.langSwitch', vars: { lang: L.BY[code].label } });
}

function onProbs(probs) {
  if (!running || !songAuto()) return;
  const changed = tracker.update(probs);
  if (changed) setSrc(changed, true);
}

function applyUpdate(p) {
  if (!S) return;
  if (Array.isArray(p.targets)) {
    S.targets = p.targets.filter((c) => L.OUTPUTS.includes(c));
    prepareLocalTranslators();
  }
  if (p.interval != null) {
    S.interval = L.normInterval(p.interval);
    tuneSegmenter();
  }
  if (typeof p.src === 'string' && L.BY[p.src] && L.BY[p.src].input && p.src !== S.src) {
    S.src = p.src;
    if (!S.song) { tracker.lock(S.src); setSrc(S.src, false); }
  }
  if (typeof p.songSrc === 'string' && L.normSongSrc(p.songSrc) !== S.songSrc) {
    S.songSrc = L.normSongSrc(p.songSrc);
    if (S.song && typeof p.song !== 'boolean') applySongSrc();
    else if (S.song && p.song === S.song) applySongSrc();
  }
  if (typeof p.song === 'boolean' && p.song !== S.song) {
    // 노래 자막은 번역을 멈추지 않고 인식 경로와 듣는 언어만 바꿈
    S.song = p.song;
    queue = [];
    if (S.song) {
      applySongSrc();
      startRecognition().catch((e) => fatal({ key: 'st.localFail', vars: { err: I.errVal(e) } }));
    } else {
      lidOn = false;
      lidPending = null;
      tracker.lock(S.src);
      setSrc(S.src, false);
      if (S.engine === 'auto' || S.engine === 'webspeech') startSpeechPath();
      else startRecognition().catch((e) => fatal({ key: 'st.localFail', vars: { err: I.errVal(e) } }));
    }
  }
}

// 노래 자막의 입력 언어 적용: 자동이면 다시 알아듣기 시작, 고정이면 그 언어로만 받아씀
function applySongSrc() {
  if (S.songSrc === 'auto') {
    tracker.reset(curSrc);
    toBackground({ type: 'lang', code: curSrc, auto: true, detected: false });
  } else {
    tracker.lock(S.songSrc);
    setSrc(S.songSrc, false);
  }
}

// 크롬 내장 인식은 언어를 스스로 판별하지 못하므로, 같은 소리를 작은 Whisper로 판별해 인식 언어를 바꿔 줌
function ensureLid() {
  if (!running || lidOn) return;
  lidOn = true;
  startSegmenter().catch((e) => lidFail(e));
  loadLid().then(() => { if (running && lidOn && speech) status('st.listenWebspeech'); pumpLid(); })
    .catch((e) => lidFail(e));
}

function lidFail(e) {
  lidOn = false;
  lidPending = null;
  if (!running) return;
  status({ key: 'st.lidFail', vars: { lang: L.BY[curSrc].label, err: I.errVal(e) } }, 'warn');
}

function loadLid() {
  if (lidPipe) return Promise.resolve(lidPipe);
  if (lidLoading) return lidLoading;
  lidLoading = (async () => {
    status('st.lidPrep');
    const { pipeline } = await loadTF();
    lidPipe = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-tiny',
      { device: 'wasm', dtype: 'q8', progress_callback: progressTo('st.lidDl') });
    if (running && sttMode === 'local') status('st.listenLocal');
    return lidPipe;
  })();
  lidLoading.catch(() => { lidLoading = null; });
  return lidLoading;
}

let lidBuf = [];
let lidBufLen = 0;
let lidBufAt = 0;
function enqueueLid(samples) {
  // 오래전(6초 넘게 쉰 뒤) 조각과는 이어 붙이지 않음 — 그사이 언어가 바뀌었을 수 있음
  if (Date.now() - lidBufAt > 6000) { lidBuf = []; lidBufLen = 0; }
  lidBufAt = Date.now();
  lidBuf.push(samples);
  lidBufLen += samples.length;
  if (lidBufLen < MIN_LID_SAMPLES) return;
  let seg = concat(lidBuf);
  if (seg.length > MAX_LID_SAMPLES) seg = seg.subarray(seg.length - MAX_LID_SAMPLES);
  lidBuf = [];
  lidBufLen = 0;
  lidPending = seg;
  pumpLid();
}

async function pumpLid() {
  if (lidBusy) return;
  const pipe = lidPipe;
  if (!pipe) return;
  lidBusy = true;
  try {
    while (running && lidOn && lidPending) {
      const seg = lidPending;
      lidPending = null;
      try {
        onProbs(await LID.whisperLangProbs(pipe, TF.Tensor, seg, S.detect));
      } catch (e) {
        lidFail(e);
        break;
      }
    }
  } finally {
    lidBusy = false;
  }
}

async function loadWorklet() {
  if (workletLoaded) return;
  await ctx.audioWorklet.addModule('pcm-worklet.js');
  workletLoaded = true;
}

// 방송 화면(콘텐츠 스크립트)에서 보내는 PCM 수신
function decodePcm(b64) {
  const bin = atob(b64);
  const n = bin.length >> 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8);
    if (v >= 0x8000) v -= 0x10000;
    out[i] = v / 0x8000;
  }
  return out;
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'cltr-pcm') return;
  if (pcmPort) { try { pcmPort.disconnect(); } catch (e) { /* 무시 */ } }
  pcmPort = port;
  port.onMessage.addListener((m) => {
    if (!m || typeof m.pcm !== 'string' || !running) return;
    const data = decodePcm(m.pcm);
    if (playerNode) playerNode.port.postMessage(data, [data.buffer]);
    else if (pendingPcm.length < 40) pendingPcm.push(data);
  });
  port.onDisconnect.addListener(() => {
    if (pcmPort !== port) return;
    pcmPort = null;
    if (running && playerNode) fatal('st.pageDisconnected');
  });
});

function stop() {
  running = false;
  queue = [];
  pendingPcm = [];
  lidOn = false;
  lidPending = null;
  segmenterOn = false;
  if (pcmPort) { const p = pcmPort; pcmPort = null; try { p.disconnect(); } catch (e) { /* 무시 */ } }
  if (playerNode) { try { playerNode.disconnect(); } catch (e) { /* 무시 */ } playerNode = null; }
  if (abortCtl) { try { abortCtl.abort(); } catch (e) { /* 무시 */ } }
  if (speech) { speech.stop(); speech = null; }
  if (workletNode) {
    try { workletNode.port.onmessage = null; workletNode.disconnect(); } catch (e) { /* 무시 */ }
    workletNode = null;
  }
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  if (ctx) { ctx.close().catch(() => {}); ctx = null; }
  src = null;
}

// ---------- 구간 단위 인식 (API / 로컬 Whisper 공용) ----------
async function startChunked(mode) {
  if (speech) { speech.stop(); speech = null; }
  lidOn = false;          // 이제부터는 인식 경로가 언어를 직접 판별
  lidPending = null;
  sttMode = mode;
  if (songAuto()) loadLid().catch(() => {}); // 판별 모델은 인식과 별도로 준비
  if (mode === 'local') {
    await loadLocalASR(S.song);
    if (!running) return;
  }
  await startSegmenter();
  if (!running) return;
  tuneSegmenter();
  if (S.song) status(mode === 'local' ? (asr && asr.__fast ? 'st.listenFast' : 'st.listenLocal') : 'st.listenFastApi');
  else status(mode === 'local' ? 'st.listenLocal' : 'st.listenApi');
}

// 번역 간격: 말이 쉬지 않고 이어져도 이 시간마다 끊어 번역 (말이 쉬면 그 전에 바로 번역)
// Whisper는 2초보다 짧은 소리를 잘 못 알아들어서 Whisper 경로는 최소 2초로 자름
function tuneSegmenter() {
  if (!vad) return;
  vad.pauseMs = S.song ? 400 : (S.pauseMs || 600);
  vad.maxMs = Math.max(2, S.interval) * 1000;
}

// 말소리 구간 분할기: 인식 엔진이 Whisper 계열이면 인식 큐로, 크롬 내장 인식이면 언어 감지로 보냄
async function startSegmenter() {
  if (segmenterOn) return;
  segmenterOn = true;
  await loadWorklet();
  if (!running || !ctx) { segmenterOn = false; return; }
  workletNode = new AudioWorkletNode(ctx, 'pcm-capture');
  const mute = ctx.createGain();
  mute.gain.value = 0;
  src.connect(workletNode);
  workletNode.connect(mute);
  mute.connect(ctx.destination);

  const resampler = new Resampler(ctx.sampleRate, OUT_RATE);
  vad = new Segmenter({
    pauseMs: S.pauseMs || 600,
    maxMs: Math.max(2, S.interval) * 1000,
    onSegment: (seg) => {
      if (sttMode) enqueueSegment(seg);
      else if (lidOn) enqueueLid(seg);
    }
  });
  workletNode.port.onmessage = (e) => {
    if (!running) return;
    vad.push(resampler.process(e.data));
  };
}

// transformers.js를 한 번만 불러와 공용으로 씀
async function loadTF() {
  if (TF) return TF;
  const T = await import(chrome.runtime.getURL('lib/transformers.min.js'));
  const { env } = T;
  env.allowLocalModels = false;
  if (env.backends && env.backends.onnx && env.backends.onnx.wasm) {
    env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('lib/');
    env.backends.onnx.wasm.numThreads = 1;
  }
  TF = T;
  return TF;
}

// 모델 내려받기 진행률 → 상태 문구
function progressTo(key) {
  let lastShown = 0;
  return (p) => {
    if (!p || p.status !== 'progress_total') return;
    const now = Date.now();
    if (now - lastShown < 800) return;
    lastShown = now;
    const pct = Math.max(0, Math.min(100, Math.round(p.progress || 0)));
    status({ key, vars: { pct } });
  };
}

// ---------- 로컬 Whisper (transformers.js) ----------
function loadLocalASR(fast) {
  const key = fast ? 'fast' : 'normal';
  if (asrCache.has(key)) { asr = asrCache.get(key); return Promise.resolve(asr); }
  if (asrLoadingBy.has(key)) return asrLoadingBy.get(key);
  const loading = (async () => {
    status('st.modelPrep');
    const { pipeline } = await loadTF();
    let progress_callback = progressTo('st.modelDl');

    // WebGPU가 있으면 정확도 높은 small, 없으면 가벼운 base
    let plan = { device: 'wasm', model: 'onnx-community/whisper-base', dtype: 'q8' };
    let adapter = null;
    try { if (navigator.gpu) adapter = await navigator.gpu.requestAdapter(); } catch (e) { adapter = null; }
    if (adapter) {
      plan = {
        device: 'webgpu',
        model: 'onnx-community/whisper-small',
        dtype: {
          encoder_model: adapter.features.has('shader-f16') ? 'fp16' : 'fp32',
          decoder_model_merged: 'q4'
        }
      };
    }
    // 노래·빠른 말 모드: GPU가 있으면 large-v3-turbo (CPU로는 실시간이 안 되어 기본 모델로 대체)
    if (fast && adapter) {
      plan = { device: 'webgpu', model: 'onnx-community/whisper-large-v3-turbo', dtype: FAST_DTYPE, fast: true };
      progress_callback = progressTo('st.fastDl');
    } else if (fast) {
      status('st.fastNoGpu', 'warn');
    }

    let pipe;
    try {
      pipe = await pipeline('automatic-speech-recognition', plan.model,
        { device: plan.device, dtype: plan.dtype, progress_callback });
      pipe.__fast = !!plan.fast;
    } catch (e) {
      if (plan.device !== 'webgpu') throw e;
      status('st.gpuFallback', 'warn');
      pipe = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-base',
        { device: 'wasm', dtype: 'q8', progress_callback: progressTo('st.modelDl') });
    }
    // 첫 실행 시 셰이더/그래프 컴파일을 미리 끝내 둠
    try { await pipe(new Float32Array(OUT_RATE), { language: curSrc, task: 'transcribe' }); } catch (e) { /* 무시 */ }
    asrCache.set(key, pipe);
    return pipe;
  })();
  asrLoadingBy.set(key, loading);
  loading.then((p) => { asr = p; }, () => {}).finally(() => asrLoadingBy.delete(key));
  return loading.then((p) => { asr = p; return p; });
}

// ---------- 리샘플러 (선형 보간, 블록 경계 연속) ----------
class Resampler {
  constructor(inRate, outRate) {
    this.ratio = inRate / outRate;
    this.pos = 0;
    this.last = 0;
  }
  process(input) {
    const n = input.length;
    if (n === 0) return new Float32Array(0);
    const est = Math.ceil(n / this.ratio) + 2;
    const out = new Float32Array(est);
    let k = 0;
    while (this.pos < n - 1 && k < est) {
      const i = Math.floor(this.pos);
      const f = this.pos - i;
      const a = i < 0 ? this.last : input[i];
      const b = input[i + 1];
      out[k++] = a + (b - a) * f;
      this.pos += this.ratio;
    }
    this.pos -= n;
    this.last = input[n - 1];
    return out.subarray(0, k);
  }
}

// ---------- 발화 분할기: 배경음에 적응하는 임계값 ----------
class Segmenter {
  constructor({ pauseMs, maxMs, onSegment }) {
    this.pauseMs = pauseMs;
    this.maxMs = maxMs;
    this.onSegment = onSegment;
    this.frame = new Float32Array(FRAME);
    this.fpos = 0;
    this.history = [];      // 최근 5초 RMS
    this.threshold = 0.012;
    this.sinceUpdate = 0;
    this.preroll = [];      // 말 시작 직전 300ms
    this.reset();
  }
  reset() {
    this.speaking = false;
    this.chunks = [];
    this.segMs = 0;
    this.silenceMs = 0;
    this.voicedMs = 0;
  }
  push(samples) {
    for (let i = 0; i < samples.length; i++) {
      this.frame[this.fpos++] = samples[i];
      if (this.fpos === FRAME) {
        this.onFrame(this.frame);
        this.frame = new Float32Array(FRAME);
        this.fpos = 0;
      }
    }
  }
  updateThreshold(rms) {
    this.history.push(rms);
    if (this.history.length > 250) this.history.shift();
    if (++this.sinceUpdate >= 25 && this.history.length >= 25) {
      this.sinceUpdate = 0;
      const sorted = [...this.history].sort((a, b) => a - b);
      const floor = sorted[Math.floor(sorted.length * 0.1)];
      // 반주·배경음악이 계속 깔리면 바닥 소음이 높아 2.2배 기준으로는 목소리의 절반을 놓쳤음 (시험: 소리 47~53%만 인식)
      // 1.4배로 낮추면 같은 시험에서 77~92%를 받아 인식 오류율이 61% → 53%로 줄어듦
      this.threshold = Math.max(0.008, floor * 1.4);
    }
  }
  onFrame(frame) {
    let sum = 0;
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
    const rms = Math.sqrt(sum / frame.length);
    this.updateThreshold(rms);
    const voiced = rms > this.threshold;

    if (!this.speaking) {
      this.preroll.push(frame);
      if (this.preroll.length > 15) this.preroll.shift();
      if (voiced) {
        this.speaking = true;
        this.chunks = this.preroll.slice();
        this.segMs = this.chunks.length * 20;
        this.preroll = [];
        this.voicedMs = 20;
        this.silenceMs = 0;
      }
      return;
    }

    this.chunks.push(frame);
    this.segMs += 20;
    if (voiced) { this.voicedMs += 20; this.silenceMs = 0; } else { this.silenceMs += 20; }

    const pauseEnd = this.silenceMs >= this.pauseMs && this.segMs >= 1000;
    const tooLong = this.segMs >= this.maxMs;
    if (pauseEnd || tooLong) {
      if (this.voicedMs >= 300) this.onSegment(concat(this.chunks));
      const keepSpeaking = tooLong && !pauseEnd && voiced;
      this.reset();
      if (keepSpeaking) { this.speaking = true; this.voicedMs = 0; }
    }
  }
}

function concat(chunks) {
  let len = 0;
  for (const c of chunks) len += c.length;
  const out = new Float32Array(len);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

function encodeWav(samples, rate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const w = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVE');
  w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

// ---------- 인식 큐 ----------
function enqueueSegment(samples) {
  if (!running) return;
  queue.push(samples);
  if (queue.length > 3) {
    queue.shift(); // 실시간성을 위해 밀린 구간은 버림
    status(sttMode === 'local' ? 'st.skipLocal' : 'st.skipNet', 'warn');
  }
  pump();
}

async function pump() {
  if (busy) return;
  busy = true;
  try {
    while (running && queue.length) {
      const seg = queue.shift();
      // 노래 자막: 받아 적는 동안의 글자를 같은 자막 칸에 실시간으로 보여 주다가 완성되면 번역을 붙임
      const cid = ++captionSeq;
      let shown = false;
      let r = null;
      try {
        r = sttMode === 'local'
          ? await transcribeLocal(seg, S.song ? (partial, lang) => { shown = true; showWriting(cid, partial, lang); } : null)
          : await transcribeApi(encodeWav(seg, OUT_RATE));
      } catch (e) {
        if (shown) caption({ id: cid, remove: true });
        if (!running) break;
        if (e && e.code === 401) { fatal('st.apiKey401'); break; }
        status({ key: 'st.recogErr', vars: { err: errText(e) } }, 'warn');
        continue;
      }
      const text = cleanText(r.text);
      if (!text) { if (shown) caption({ id: cid, remove: true }); continue; }
      prevText = (prevText + ' ' + text).slice(-200);
      emitFinal(text, cid, r.lang);
    }
  } finally {
    busy = false;
  }
}

// 브라우저 Whisper. 노래 자막이면 구간마다 한국어·일본어·영어 중 어느 언어인지 매번 확인함
//  - 이 구간 판별이 80% 이상 확실하면 이 구간은 그 언어로 받아씀 (노래 중간에 영어 가사가 섞여도 바로 따라감)
//  - 애매하면 지금까지 이어진 언어로 받아씀
async function transcribeLocal(samples, onPartial) {
  let lang = curSrc;
  if (songAuto() && samples.length >= MIN_LID_SAMPLES) {
    if (!lidPipe) loadLid().catch(() => {});
    try {
      // 판별 모델이 아직 준비 중이면 인식 모델로 판별
      const probs = await LID.whisperLangProbs(lidPipe || asr, TF.Tensor, samples, S.detect);
      onProbs(probs);
      lang = curSrc;
      const [best, bp] = Object.entries(probs).sort((a, b) => b[1] - a[1])[0] || [];
      if (best && bp >= 0.8) lang = best;
    } catch (e) { /* 판별 실패 시 지금 언어 유지 */ }
  }
  // 짧은 구간에서 Whisper가 같은 말을 끝없이 반복하는 일이 있어 길이에 맞춰 출력 길이를 제한
  // (시험: 2초 간격에서 인식 오류율 195% → 71%, 1.6배속 말에서도 정상 문장은 잘리지 않음)
  const max_new_tokens = Math.ceil(samples.length / OUT_RATE * 12) + 8;
  const opts = { language: lang, task: 'transcribe', max_new_tokens };
  if (onPartial && TF.WhisperTextStreamer) {
    let partial = '';
    let last = 0;
    opts.streamer = new TF.WhisperTextStreamer(asr.tokenizer, {
      skip_prompt: true,
      callback_function: (t) => {
        partial += t;
        const now = Date.now();
        if (now - last >= 120) { last = now; onPartial(partial, lang); } // 너무 잦은 갱신은 묶어서
      }
    });
  }
  const out = await asr(samples, opts);
  return { text: (out && out.text) || '', lang };
}

// 받아 적는 중인 글자 표시 (번역 전)
function showWriting(id, partial, lang) {
  const t = String(partial || '').replace(/[♪♫♬♩]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || !/[\p{L}\p{N}]/u.test(t)) return;
  caption({ id, src: lang, orig: t, song: true, interim: true, pending: true });
}

// Whisper API: 자동 감지면 언어를 지정하지 않고 API가 판별하게 함
async function transcribeApi(blob) {
  const p = PROVIDERS[S.provider] || PROVIDERS.groq;
  const auto = songAuto();
  // verbose_json은 감지한 언어를 함께 돌려줌 (gpt-4o 계열 인식 모델은 json만 지원)
  const verbose = auto && (S.provider !== 'openai' || /^whisper/i.test(S.sttModel || ''));
  const form = new FormData();
  form.append('file', blob, 'audio.wav');
  form.append('model', S.sttModel);
  if (!auto) form.append('language', curSrc);
  form.append('response_format', verbose ? 'verbose_json' : 'json');
  form.append('temperature', '0');
  if (prevText) form.append('prompt', prevText);

  abortCtl = new AbortController();
  const timer = setTimeout(() => abortCtl.abort(), 20000);
  let data;
  try {
    const res = await fetch(p.stt, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + S.apiKey },
      body: form,
      signal: abortCtl.signal
    });
    if (!res.ok) {
      const err = new Error('HTTP ' + res.status + ' ' + (await res.text()).slice(0, 120));
      err.code = res.status;
      throw err;
    }
    data = await res.json();
  } finally {
    clearTimeout(timer);
  }
  const text = (data && data.text) || '';
  if (!auto) return { text, lang: curSrc };
  // 이 구간은 API가 판별한 언어로 적힌 문장이므로 그 언어로 번역하고, 표시 언어도 서서히 따라가게 함
  // API는 모든 언어 중에서 판별하므로, 고른 후보에 없는 언어면 문장 텍스트로 후보 안에서 다시 판별
  let lang = LID.fromWhisperName(data && data.language);
  if (!S.detect.includes(lang)) lang = await LID.textLang(text, S.detect);
  if (!S.detect.includes(lang)) lang = curSrc;
  if (L.BY[lang]) onProbs({ [lang]: 0.9 });
  if (L.BY[lang] && lang !== curSrc && prevText) prevText = '';
  return { text, lang: L.BY[lang] ? lang : curSrc };
}

function cleanText(t) {
  // 노래 구간에서 Whisper가 붙이는 음표와 [음악]·(音楽)·(Music) 같은 소리 표시는 지움
  t = (t || '').replace(/[♪♫♬♩🎵🎶]/g, ' ')
    .replace(/[\[(（【]\s*(음악|노래|박수|웃음|音楽|音樂|拍手|笑|music|applause|laughter|singing|instrumental)[^\])）】]{0,12}[\])）】]/gi, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (!/[\p{L}\p{N}]/u.test(t)) return '';
  const low = t.toLowerCase();
  if (HALLUCINATIONS.some((h) => {
    const hl = h.toLowerCase();
    return low === hl || (low.length < hl.length + 6 && low.includes(hl));
  })) return '';
  if (/(.{1,4})\1{6,}/.test(t)) return ''; // 같은 음절 반복 환각
  t = t.replace(/(.{2,16}?)\1{2,}/gu, '$1').trim(); // 같은 구절이 3번 넘게 이어지면 한 번만 남김
  return t;
}

// ---------- 결과 전송 + 번역 ----------
function emitFinal(text, id, src) {
  const cid = id || ++captionSeq;
  const lang = src || curSrc;
  // 노래 자막이면 원문과 번역을 한 자막(두 층)으로 묶어 보여 줌
  const song = !!S.song;
  const base = { id: cid, src: lang, orig: text, song, interim: false };
  caption({ ...base, pending: true });
  translateChain = translateChain
    .then(() => translateAll(text, lang))
    .then((tr) => caption({ ...base, tr, pending: false }))
    .catch((e) => {
      caption({ ...base, pending: false });
      status({ key: 'st.transErr', vars: { err: errText(e) } }, 'warn');
    });
}

// 크롬 내장 번역기: 언어 쌍마다 하나씩 만들어 재사용
const localTr = new Map();      // 'ko>ja' → Translator
const localFailedAt = new Map(); // 'ko>ja' → 실패 시각

async function getLocal(src, tgt) {
  const key = src + '>' + tgt;
  if (localTr.has(key)) return localTr.get(key);
  if (!('Translator' in self)) return null;
  if (Date.now() - (localFailedAt.get(key) || 0) < 60000) return null;
  try {
    const av = await Translator.availability({ sourceLanguage: src, targetLanguage: tgt });
    if (av === 'unavailable') { localFailedAt.set(key, Date.now()); return null; }
    const tr = await Translator.create({ sourceLanguage: src, targetLanguage: tgt });
    localTr.set(key, tr);
    return tr;
  } catch (e) {
    // 모델이 아직 내려받아지지 않았으면 사용자 클릭 없이 생성이 거부됨 → Google 번역으로 대체
    localFailedAt.set(key, Date.now());
    return null;
  }
}

function prepareLocalTranslators() {
  if (!S || (S.translator !== 'auto' && S.translator !== 'local')) return;
  for (const t of S.targets) if (!L.same(curSrc, t)) getLocal(curSrc, t);
}

async function viaChrome(text, src, tgt) {
  const tr = await getLocal(src, tgt);
  if (!tr) return null;
  try { return await tr.translate(text); } catch (e) { localTr.delete(src + '>' + tgt); return null; }
}

// Google 번역 무료 엔드포인트 (키 불필요)
async function viaGoogle(text, src, tgt) {
  const sl = (L.BY[src] && L.BY[src].gt) || 'auto';
  const tl = (L.BY[tgt] && L.BY[tgt].gt) || tgt;
  const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=' + encodeURIComponent(sl) +
    '&tl=' + encodeURIComponent(tl) + '&dt=t&q=' + encodeURIComponent(text);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || !Array.isArray(data[0])) return null;
    const out = data[0].map((seg) => (Array.isArray(seg) && typeof seg[0] === 'string') ? seg[0] : '').join('').trim();
    return out || null;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// 원문 언어(src) → 고른 출력 언어들. 원문과 같은 언어는 번역하지 않음 (화면에서 원문을 그대로 보여 줌)
async function translateAll(text, src) {
  const want = S.targets.filter((t) => !L.same(src, t));
  const result = {};
  if (!want.length) return result;

  const mode = S.translator;
  const canLLM = !!S.apiKey;

  if (mode === 'llm' && canLLM) {
    return translateLLM(text, src, want);
  }

  await Promise.all(want.map(async (t) => {
    if (mode === 'auto' || mode === 'local') result[t] = await viaChrome(text, src, t);
    if (!result[t] && (mode === 'auto' || mode === 'google' || (mode === 'llm' && !canLLM))) {
      result[t] = await viaGoogle(text, src, t);
    }
  }));

  const missing = want.filter((t) => !result[t]);
  if (missing.length && mode === 'auto' && canLLM) {
    const llm = await translateLLM(text, src, missing);
    for (const t of missing) result[t] = llm[t] || null;
  } else if (missing.length) {
    status(mode === 'local' ? 'st.transLocalMissing' : 'st.transNet', 'warn');
  }
  return result;
}

async function translateLLM(text, src, want) {
  const p = PROVIDERS[S.provider] || PROVIDERS.groq;
  const srcName = (L.BY[src] && L.BY[src].name) || 'the original language';
  const lines = want.map((t) => `${t}: <${L.BY[t].name}>`).join('\n');
  const res = await fetch(p.chat, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + S.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: S.llmModel,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: `You translate live-stream speech transcripts (spoken in ${srcName}) into subtitles. ` +
            'Keep it natural, short and faithful; keep streamer slang casual; keep names as-is. ' +
            `Reply with exactly ${want.length} line(s) in this format and nothing else:\n${lines}`
        },
        { role: 'user', content: text }
      ]
    })
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  const out = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
  const result = {};
  for (const t of want) {
    const re = new RegExp('^\\s*' + t.replace(/[-]/g, '\\-') + '\\s*[:：]\\s*(.+)$', 'mi');
    const m = out.match(re);
    result[t] = m ? m[1].trim() : null;
  }
  return result;
}

// ---------- 크롬 내장 Web Speech: 탭 오디오 트랙을 직접 인식 (무료) ----------
// onFail(이유): 이 크롬에서 쓸 수 없다고 판단되면 한 번만 호출
function startWebSpeech(track, onFail) {
  const SR = self.SpeechRecognition || self.webkitSpeechRecognition;
  let stopped = false;
  let failed = false;
  let rec = null;
  let gotResult = false;
  let interimId = null;
  const endTimes = [];
  const startedAt = Date.now();
  let meter = null;
  let watchdog = null;
  let lang = curSrc;
  let switching = false; // 언어를 바꾸려고 일부러 끊은 경우 (불안정 판단에서 제외)

  const ctl = {
    stop() {
      stopped = true;
      if (watchdog) clearInterval(watchdog);
      if (meter) { try { meter.disconnect(); } catch (e) { /* 무시 */ } }
      if (rec) { try { rec.abort(); } catch (e) { /* 무시 */ } }
    },
    // 입력 언어가 바뀌면 인식을 그 언어로 다시 시작
    setLang(code) {
      if (stopped || failed || code === lang) return;
      lang = code;
      if (interimId) { caption({ id: interimId, remove: true }); interimId = null; }
      if (rec) {
        switching = true;
        try { rec.abort(); } catch (e) { switching = false; }
      }
    }
  };

  const fail = (why) => {
    if (failed || stopped) return;
    failed = true;
    ctl.stop();
    onFail(why);
  };

  if (!SR) { setTimeout(() => fail('why.noSR'), 0); return ctl; }

  // 소리가 계속 나는데 한 번도 결과가 없으면 트랙 입력이 무시되는 것으로 판단
  let loudMs = 0;
  const buf = new Float32Array(2048);
  try {
    meter = ctx.createAnalyser();
    meter.fftSize = 2048;
    src.connect(meter);
  } catch (e) { meter = null; }
  watchdog = setInterval(() => {
    if (stopped || gotResult || !meter) return;
    meter.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    if (Math.sqrt(sum / buf.length) > 0.02) loudMs += 500;
    if (loudMs >= 25000 && Date.now() - startedAt > 30000) {
      fail('why.noResponse');
    }
  }, 500);

  const launch = () => {
    if (stopped || !running) return;
    rec = new SR();
    rec.lang = (L.BY[lang] && L.BY[lang].ws) || 'ko-KR';
    const recLang = lang;
    rec.continuous = true;
    rec.interimResults = true;

    rec.onstart = () => { if (!gotResult) status('st.listenWebspeech'); };

    // 노래·빠른 말처럼 쉬지 않고 이어지면 크롬 인식은 문장을 끝내지 않아 자막이 번역되지 않고 계속 길어짐
    // → 번역 간격(기본 3초)보다 오래 확정이 없으면 이미 굳은 앞부분을 먼저 자막으로 확정해 번역하고, 나머지만 이어서 보여 줌
    let committed = 0;              // 지금 문장에서 이미 확정한 글자 수
    let lastCommitAt = Date.now();
    rec.onresult = (e) => {
      gotResult = true;
      const now = Date.now();
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const full = ((r[0] && r[0].transcript) || '');
        if (committed > full.length) committed = full.length; // 인식기가 앞부분을 짧게 고친 경우
        const t = full.slice(committed).trim();
        if (r.isFinal) {
          committed = 0;
          lastCommitAt = now;
          const id = interimId || ++captionSeq;
          interimId = null;
          const clean = cleanText(t);
          if (clean) emitFinal(clean, id, recLang);
          else caption({ id, remove: true });
          continue;
        }
        if (!t) continue;
        let rest = t;
        if (now - lastCommitAt >= S.interval * 1000) {
          const cut = LID.stableCut(t);
          const head = cleanText(t.slice(0, cut));
          if (cut > 0 && head) {
            emitFinal(head, interimId || ++captionSeq, recLang);
            interimId = null;
            const lead = full.slice(committed).length - full.slice(committed).trimStart().length;
            committed += lead + cut;
            rest = t.slice(cut).trim();
            lastCommitAt = now;
          }
        }
        if (!rest) continue;
        if (!interimId) interimId = ++captionSeq;
        caption({ id: interimId, src: recLang, orig: rest, interim: true, pending: true });
      }
    };

    rec.onerror = (e) => {
      if (e.error === 'language-not-supported') {
        fail('why.langUnsupported'); // 이 언어는 크롬 내장 인식이 지원하지 않음 → 브라우저 Whisper로 전환
      } else if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(e.error)) {
        fail('why.unsupported');
      } else if (e.error === 'network') {
        status('st.wsNetwork', 'warn');
      }
    };

    rec.onend = () => {
      if (stopped || failed || !running) return;
      if (switching) { switching = false; launch(); return; }
      const now = Date.now();
      endTimes.push(now);
      while (endTimes.length && now - endTimes[0] > 10000) endTimes.shift();
      if (endTimes.length > 6) {
        fail('why.unstable');
        return;
      }
      setTimeout(launch, 250);
    };

    try {
      rec.start(track);
    } catch (e) {
      fail('why.startFail');
    }
  };

  launch();
  return ctl;
}
