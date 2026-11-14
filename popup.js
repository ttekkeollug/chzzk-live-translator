'use strict';

const MODEL_DEFAULTS = {
  groq: { sttModel: 'whisper-large-v3-turbo', llmModel: 'llama-3.3-70b-versatile' },
  openai: { sttModel: 'gpt-4o-mini-transcribe', llmModel: 'gpt-4o-mini' }
};
const ENGINE_HINT = { auto: 'p.hint.auto', webspeech: 'p.hint.webspeech', local: 'p.hint.local', api: 'p.hint.api' };
const KEY_HINT = { groq: 'p.key.groq', openai: 'p.key.openai' };
const I = globalThis.CLTR_I18N;
const L = globalThis.CLTR_LANGS;
let uiPref = 'auto';
let lang = I.resolveLang('auto');
const T = (k, v) => I.t(lang, k, v);
let lastStatus = { msg: '', level: '' };
const DEFAULT_CFG = {
  engine: 'auto', provider: 'groq', translator: 'auto', showApi: false,
  sttModel: MODEL_DEFAULTS.groq.sttModel, llmModel: MODEL_DEFAULTS.groq.llmModel,
  pauseMs: 600, maxSegSec: 8
};
const DEFAULT_VIEW = { src: 'ko', song: false, songSrc: 'auto', interval: 3, targets: ['ja', 'en'], showOrig: true, fontSize: 20, maxLines: 3, bgOpacity: 62 };

const $ = (id) => document.getElementById(id);
let cfg = { ...DEFAULT_CFG };
let view = { ...DEFAULT_VIEW };
let keys = {};
let running = false;

function setStatus(msg, level) {
  lastStatus = { msg, level };
  const el = $('status');
  el.textContent = msg ? T(msg) : '';
  el.className = level || '';
}

// 화면 문구를 고른 언어로 채움
function applyI18n() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = T(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = T(el.dataset.i18nHtml); });
  document.querySelectorAll('[data-i18n-alt]').forEach((el) => { el.alt = T(el.dataset.i18nAlt); });
  $('engine-hint').textContent = T(ENGINE_HINT[cfg.engine] || '');
  $('key-hint').textContent = T(KEY_HINT[cfg.provider]);
  $('main-btn').textContent = running ? T('ui.stopFull') : T('ui.start');
  $('uiLang').value = uiPref;
  $('tgt-max').textContent = T('ui.tgtMax', { n: L.MAX_TARGETS });
  $('song-sub').textContent = T('ui.songSub', { langs: L.SONG_LANGS.map((c) => L.BY[c].label).join('·'), mb: L.FAST_MODEL_MB });
  renderLangs();
  setStatus(lastStatus.msg, lastStatus.level);
}

function setLang(pref) {
  uiPref = pref || 'auto';
  lang = I.resolveLang(uiPref);
  applyI18n();
}

function setRunning(on) {
  running = on;
  $('dot').classList.toggle('on', on);
  const btn = $('main-btn');
  btn.textContent = on ? T('ui.stopFull') : T('ui.start');
  btn.classList.toggle('stop', on);
}

function render() {
  $('engine').value = cfg.engine;
  $('provider').value = cfg.provider;
  $('translator').value = cfg.translator;
  $('sttModel').value = cfg.sttModel;
  $('llmModel').value = cfg.llmModel;
  $('pauseMs').value = cfg.pauseMs;
  $('maxSegSec').value = cfg.maxSegSec;
  $('apiKey').value = keys[cfg.provider] || '';
  $('key-hint').textContent = T(KEY_HINT[cfg.provider]);
  renderLangs();
  $('fontSize').value = view.fontSize;
  $('maxLines').value = view.maxLines;
  $('showApi').checked = !!cfg.showApi;
  $('engine-hint').textContent = T(ENGINE_HINT[cfg.engine] || '');
  $('api-block').classList.toggle('hidden', !(cfg.engine === 'api' || cfg.translator === 'llm' || cfg.showApi));
}

const clampNum = (v, min, max, def) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

async function save() {
  cfg.engine = $('engine').value;
  const newProvider = $('provider').value;
  if (newProvider !== cfg.provider) {
    cfg.provider = newProvider;
    Object.assign(cfg, MODEL_DEFAULTS[newProvider]);
  }
  cfg.translator = $('translator').value;
  cfg.showApi = $('showApi').checked;
  cfg.sttModel = $('sttModel').value.trim() || MODEL_DEFAULTS[cfg.provider].sttModel;
  cfg.llmModel = $('llmModel').value.trim() || MODEL_DEFAULTS[cfg.provider].llmModel;
  cfg.pauseMs = clampNum($('pauseMs').value, 300, 2000, 600);
  cfg.maxSegSec = clampNum($('maxSegSec').value, 3, 20, 8);
  view = {
    ...view,
    showOrig: $('showOrig').checked,
    fontSize: clampNum($('fontSize').value, 12, 48, 20),
    maxLines: clampNum($('maxLines').value, 1, 6, 3)
  };
  await chrome.storage.sync.set({ cfg, view });
  render();
}

// 입력 언어 목록과 출력 언어 버튼 (번호 = 자막에 표시되는 순서)
function buildLangControls() {

  $('song').addEventListener('click', async () => {
    if (view.song) { view = { ...view, song: false }; showGate(null); save(); return; }
    prepareTranslators(view.targets, L.SONG_LANGS); // 클릭 안에서 세 언어 → 자막 언어 번역 모델 미리 받기
    // 노래 자막(테스트)은 지정 채널을 모두 팔로우해야 켜짐 — 치지직 탭에서 로그인 상태로 확인
    showGate({ reason: 'checking', missing: [] });
    let r = null;
    try {
      const tab = await getActiveTab();
      if (tab && tab.url && tab.url.startsWith('https://chzzk.naver.com/')) {
        r = await chrome.tabs.sendMessage(tab.id, { type: 'checkSongGate', force: true });
      }
    } catch (e) { r = null; }
    if (!r) { showGate({ reason: 'notChzzk', missing: [] }); return; }
    if (!r.ok) { showGate(r); return; }
    showGate(null);
    view = { ...view, song: true };
    save();
  });
  for (const code of ['auto', ...L.SONG_LANGS]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tgt';
    b.dataset.ssrc = code;
    b.addEventListener('click', () => { view = { ...view, songSrc: code }; save(); });
    $('song-src').appendChild(b);
  }
  const box = $('tgts');
  for (const l of L.OUTPUTS.map((c) => L.BY[c])) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tgt';
    b.dataset.tgt = l.code;
    b.title = l.label;
    b.addEventListener('click', () => {
      let t = view.targets.slice();
      if (t.includes(l.code)) t = t.filter((c) => c !== l.code);
      else if (t.length < L.MAX_TARGETS) t.push(l.code);
      else return;
      view = { ...view, targets: t };
      prepareTranslators([l.code]); // 클릭 안에서 크롬 내장 번역 모델 미리 받기
      save();
    });
    box.appendChild(b);
  }
}

function renderLangs() {
  $('showOrig').checked = !!view.showOrig;
  $('song').classList.toggle('on', !!view.song);
  $('song-src-block').classList.toggle('hidden', !view.song);
  document.querySelectorAll('.tgt[data-ssrc]').forEach((b) => {
    b.classList.toggle('on', b.dataset.ssrc === view.songSrc);
    b.textContent = b.dataset.ssrc === 'auto' ? T('ui.songSrcAuto') : L.BY[b.dataset.ssrc].label;
  });
  $('song').textContent = (view.song ? '♪ ' : '') + T('ui.song') + (view.song ? ' · ON' : '');
  document.querySelectorAll('.tgt[data-tgt]').forEach((b) => {
    const i = view.targets.indexOf(b.dataset.tgt);
    b.classList.toggle('on', i >= 0);
    b.textContent = L.BY[b.dataset.tgt].label;
    if (i >= 0 && view.targets.length > 1) {
      const o = document.createElement('span');
      o.className = 'ord';
      o.textContent = String(i + 1);
      b.appendChild(o);
    }
  });
}

function showGate(g) {
  const box = $('gate');
  box.classList.toggle('hidden', !g);
  box.textContent = '';
  if (!g) return;
  const key = { checking: 'gate.checking', login: 'gate.login', error: 'gate.error', notChzzk: 'gate.notChzzk' }[g.reason] || 'gate.missing';
  const p = document.createElement('div');
  p.textContent = T(key, { n: (g.missing || []).length, total: L.SONG_CHANNELS.length });
  box.appendChild(p);
  if (g.missing && g.missing.length) {
    const list = document.createElement('div');
    list.className = 'g-list';
    for (const m of g.missing) {
      const a = document.createElement('a');
      a.href = 'https://chzzk.naver.com/' + m.id;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = m.name;
      list.appendChild(a);
    }
    box.appendChild(list);
  }
}

async function saveKey() {
  keys[cfg.provider] = $('apiKey').value.trim();
  await chrome.storage.local.set({ apiKeys: keys });
}

// 크롬 내장 번역 모델을 클릭(사용자 활성화) 안에서 미리 내려받음
// 자동 감지면 지난번 감지 언어(없으면 한국어) 기준 — 방송 중 다른 언어가 감지되면 그 쌍은 Google 번역으로 대체
// 노래 자막이 켜져 있으면 한국어·영어·일본어 각각에서 자막 언어로 가는 모델을 모두 준비
async function prepareTranslators(targets, sources) {
  if (cfg.translator !== 'auto' && cfg.translator !== 'local') return true;
  if (!('Translator' in self)) return false;
  const srcs = sources || (view.song ? L.SONG_LANGS : [view.src]);
  const pairs = [];
  for (const src of srcs) for (const t of targets) if (!L.same(src, t)) pairs.push([src, t]);
  const progress = {};
  const tasks = pairs.map(([src, lang]) =>
    Translator.create({
      sourceLanguage: src,
      targetLanguage: lang,
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          progress[src + '>' + lang] = Math.round(e.loaded * 100);
          setStatus({ key: 'st.transDl', vars: { list: pairs.map(([a, b]) => `${a}→${b} ${progress[a + '>' + b] || 0}%`).join(' · ') } });
        });
      }
    }).then((t) => { try { t.destroy(); } catch (e) { /* 무시 */ } return true; })
      .catch(() => false)
  );
  return (await Promise.all(tasks)).every(Boolean);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function onMainClick() {
  const btn = $('main-btn');
  btn.disabled = true;
  try {
    if (running) {
      await chrome.runtime.sendMessage({ target: 'background', type: 'stop' });
      setRunning(false);
      setStatus('st.stopped');
      return;
    }

    const targets = view.targets.slice();
    // 사용자 활성화가 살아 있을 때 번역 모델 생성을 먼저 시작
    const prep = targets.length ? prepareTranslators(targets) : Promise.resolve(true);

    await save();
    await saveKey();
    const tab = await getActiveTab();
    if (!tab || !tab.url || !tab.url.startsWith('https://chzzk.naver.com/')) {
      setStatus('st.notChzzk', 'error');
      return;
    }
    const apiKey = keys[cfg.provider] || '';
    if ((cfg.engine === 'api' || cfg.translator === 'llm') && !apiKey) {
      setStatus('st.needKey', 'error');
      $('apiKey').focus();
      return;
    }
    if (!targets.length && !view.showOrig) {
      setStatus('st.needLang', 'error');
      return;
    }

    const localOk = await prep;
    if (!localOk && cfg.translator === 'local') {
      setStatus('st.noLocalTrans', 'error');
      return;
    }

    setStatus('st.connecting');
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
    const settings = { ...cfg, apiKey, src: view.src, song: view.song, songSrc: view.songSrc, interval: view.interval, targets };
    const res = await chrome.runtime.sendMessage({
      target: 'background', type: 'start', tabId: tab.id, streamId, settings
    });
    if (!res || !res.ok) throw new Error(res && res.error || 'err.startFailed');
    setRunning(true);
    setStatus('st.listening');
  } catch (e) {
    const m = String(e && e.message || e);
    setStatus(m.includes('active stream') ? 'st.alreadyCaptured' : { key: 'st.error', vars: { err: I.errVal(e) } }, 'error');
  } finally {
    btn.disabled = false;
  }
}

async function init() {
  const [{ cfg: c, view: v, uiLang }, { apiKeys }, { state }] = await Promise.all([
    chrome.storage.sync.get(['cfg', 'view', 'uiLang']),
    chrome.storage.local.get('apiKeys'),
    chrome.storage.session.get('state')
  ]);
  cfg = { ...DEFAULT_CFG, ...(c || {}) };
  if (cfg.engine === 'whisper') cfg.engine = 'auto'; // 1.0.0 설정 → 무료 기본값으로 이전
  if (!ENGINE_HINT[cfg.engine]) cfg.engine = 'auto';
  view = { ...DEFAULT_VIEW, ...L.migrateView(v || {}) };
  keys = apiKeys || {};
  buildLangControls();
  uiPref = uiLang || 'auto';
  lang = I.resolveLang(uiPref);
  render();
  setRunning(!!(state && state.running));
  applyI18n();
  if (state && state.status) setStatus(state.status);
  $('uiLang').addEventListener('change', () => {
    setLang($('uiLang').value);
    chrome.storage.sync.set({ uiLang: uiPref }).catch(() => {});
  });

  ['engine', 'provider', 'translator', 'showApi', 'sttModel', 'llmModel', 'pauseMs', 'maxSegSec',
    'showOrig', 'fontSize', 'maxLines'].forEach((id) => {
    $(id).addEventListener('change', save);
  });
  $('apiKey').addEventListener('change', saveKey);
  $('reset-models').addEventListener('click', () => {
    $('sttModel').value = MODEL_DEFAULTS[cfg.provider].sttModel;
    $('llmModel').value = MODEL_DEFAULTS[cfg.provider].llmModel;
    save();
  });
  $('main-btn').addEventListener('click', onMainClick);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.target !== 'background') return false;
  if (msg.type === 'status') setStatus(msg.msg || msg.text, msg.level === 'info' ? '' : msg.level);
  if (msg.type === 'fatal') { setStatus(msg.msg || msg.text, 'error'); setRunning(false); }
  return false;
});

init();
