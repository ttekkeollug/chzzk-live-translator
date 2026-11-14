importScripts('i18n.js', 'langs.js');
const I = self.CLTR_I18N;
const L = self.CLTR_LANGS;
// 서비스 워커: 오프스크린 문서 수명 관리 + 오프스크린 → 탭 메시지 중계
const OFFSCREEN_URL = 'offscreen.html';

async function hasOffscreen() {
  const url = chrome.runtime.getURL(OFFSCREEN_URL);
  if (chrome.runtime.getContexts) {
    const ctx = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [url]
    });
    return ctx.length > 0;
  }
  return false;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK'],
    justification: '방송 탭 오디오를 받아 음성 인식하고, 음소거된 탭 소리를 다시 재생합니다.'
  });
}

async function closeOffscreen() {
  if (await hasOffscreen()) {
    try { await chrome.offscreen.closeDocument(); } catch (e) { /* 이미 닫힘 */ }
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// 오프스크린 스크립트가 리스너를 등록할 때까지 재시도
async function sendToOffscreen(msg) {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await chrome.runtime.sendMessage({ ...msg, target: 'offscreen' });
      if (res && res.ok) return res;
    } catch (e) { /* 아직 준비 안 됨 */ }
    await wait(100);
  }
  throw I.err('err.offscreen');
}

async function ensureContentScript(tabId) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: 'ping' });
    if (res && res.ok) return;
  } catch (e) { /* 콘텐츠 스크립트 없음 → 주입 */ }
  await chrome.scripting.executeScript({ target: { tabId }, files: ['i18n.js', 'langs.js', 'content.js'] });
}

async function setState(patch) {
  const cur = (await chrome.storage.session.get('state')).state || {};
  const next = { ...cur, ...patch };
  await chrome.storage.session.set({ state: next });
  return next;
}

async function getState() {
  return (await chrome.storage.session.get('state')).state || {};
}

async function relayToTab(msg) {
  const { tabId } = await getState();
  if (tabId == null) return;
  try { await chrome.tabs.sendMessage(tabId, msg); } catch (e) { /* 탭이 닫혔거나 이동 */ }
}

async function startSession({ tabId, streamId, settings, source }) {
  const st = await getState();
  if (st.running) await stopSession();
  await ensureContentScript(tabId);
  await ensureOffscreen();
  // 자동 감지는 지난번에 감지한 언어로 먼저 시작
  if (settings && settings.song && !settings.lastSrc) {
    const { lastSrc } = await chrome.storage.local.get('lastSrc');
    if (lastSrc) settings = { ...settings, lastSrc };
  }
  await setState({ running: true, tabId, status: 'st.starting', lang: null });
  await setState({ source: source || 'tab' });
  await sendToOffscreen({ type: 'start', streamId, settings, source: source || 'tab' });
  await relayToTab({ type: 'settings', settings });
}

async function stopSession() {
  try { await chrome.runtime.sendMessage({ type: 'stop', target: 'offscreen' }); } catch (e) { /* 없음 */ }
  await closeOffscreen();
  await relayToTab({ type: 'stopped' });
  await setState({ running: false, status: 'st.stopped' });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== 'background') return false;

  (async () => {
    try {
      switch (msg.type) {
        case 'start':
          await startSession(msg);
          sendResponse({ ok: true });
          break;
        case 'stop':
          await stopSession();
          sendResponse({ ok: true });
          break;
        case 'caption':
          await relayToTab(msg);
          sendResponse({ ok: true });
          break;
        case 'lang': {
          // 오프스크린이 알려 준 현재 입력 언어 → 방송 화면 표시, 소리로 감지한 언어는 다음 시작 때 먼저 씀
          const lang = { code: msg.code, auto: !!msg.auto, detected: !!msg.detected };
          await setState({ lang });
          if (msg.detected && L.BY[msg.code]) await chrome.storage.local.set({ lastSrc: msg.code });
          await relayToTab({ type: 'lang', ...lang });
          sendResponse({ ok: true });
          break;
        }
        case 'status':
          await setState({ status: msg.msg });
          await relayToTab(msg);
          sendResponse({ ok: true });
          break;
        case 'fatal':
          await setState({ status: msg.msg });
          await relayToTab({ type: 'status', msg: msg.msg, level: 'error' });
          await stopSession();
          await setState({ status: msg.msg });
          sendResponse({ ok: true });
          break;
        case 'startPage': {
          // 방송 화면의 '번역 시작' 버튼: 탭 캡처 대신 페이지가 영상 소리를 직접 보내 줌
          if (!sender.tab || !sender.tab.id) throw I.err('err.noTab');
          await startSession({ tabId: sender.tab.id, streamId: null, settings: await buildSettings(), source: 'page' });
          sendResponse({ ok: true });
          break;
        }
        case 'followCheck': {
          // 노래 자막(테스트) 팔로우 확인: 치지직 탭의 페이지 환경에서 사이트와 같은 방식으로 조회
          if (!sender.tab || !sender.tab.id) throw I.err('err.noTab');
          const ids = (Array.isArray(msg.ids) ? msg.ids : []).filter((x) => /^[0-9a-f]{32}$/.test(x));
          const [res] = await chrome.scripting.executeScript({ target: { tabId: sender.tab.id }, world: 'MAIN', func: followCheckInPage, args: [ids] });
          sendResponse({ ok: true, data: res && res.result });
          break;
        }
        case 'getState': {
          const st = await getState();
          const mine = !!(sender.tab && st.running && st.tabId === sender.tab.id);
          sendResponse({ ok: true, running: mine, status: mine ? st.status : '', lang: mine ? st.lang : null });
          break;
        }
        case 'settings':
          await relayToTab({ type: 'settings', settings: msg.settings });
          sendResponse({ ok: true });
          break;
        default:
          sendResponse({ ok: false });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e && e.message || e) });
    }
  })();
  return true;
});

// 치지직 페이지 안에서 실행되는 함수 (밖의 변수를 쓰지 않도록 혼자 완결되어 있어야 함)
// - 로그인 상태: 네이버 게임 공용 사용자 상태
// - 팔로우 목록: 내가 팔로우한 채널 목록 (가장 확실)
// - 채널별 내 팔로우 정보: 목록을 못 받을 때의 대안, 채널 이름도 여기서 얻음
async function followCheckInPage(ids) {
  const diag = [];
  const get = async (url, tag) => {
    try {
      const r = await fetch(url, { credentials: 'include' });
      let d = null;
      try { d = await r.json(); } catch (e) { d = null; }
      if (tag) diag.push(tag + ' ' + r.status + (d && d.code != null ? '/' + d.code : ''));
      return { status: r.status, d };
    } catch (e) {
      if (tag) diag.push(tag + ' ERR');
      return { status: 0, d: null };
    }
  };
  let loggedIn = null;
  const us = await get('https://comm-api.game.naver.com/nng_main/v1/user/getUserStatus', 'user');
  if (us.d && us.d.content && typeof us.d.content.loggedIn === 'boolean') loggedIn = us.d.content.loggedIn;
  let follow = null;
  const fl = await get('https://api.chzzk.naver.com/service/v1/channels/followings?page=0&size=505&sortType=FOLLOW', 'follow');
  const c = fl.d && fl.d.content;
  const list = c && (c.followingList || c.data || c.list);
  if (Array.isArray(list)) {
    follow = list.map((x) => x && (x.channelId || (x.channel && x.channel.channelId))).filter(Boolean);
  }
  const rows = await Promise.all(ids.map(async (id, i) => {
    const r = await get('https://api.chzzk.naver.com/service/v1/channels/' + id, i === 0 ? 'channel' : '');
    const ch = r.d && r.d.content;
    let pd;
    if (ch && ch.personalData && ch.personalData.following && typeof ch.personalData.following.following === 'boolean') {
      pd = ch.personalData.following.following;
    } else {
      pd = ch ? null : undefined;
    }
    return { id, name: (ch && ch.channelName) || id, pd };
  }));
  if (rows.length && rows[0].pd === null) diag.push('personalData 없음');
  return { loggedIn, follow, rows, diag };
}

// 방송 탭이 닫히거나 치지직을 벗어나면 자동 정지
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const st = await getState();
  if (st.running && st.tabId === tabId) await stopSession();
});

chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (!info.url) return;
  const st = await getState();
  if (st.running && st.tabId === tabId && !info.url.startsWith('https://chzzk.naver.com/')) {
    await stopSession();
  }
});

// ---------- 단축키(Alt+Shift+T)로 켜기/끄기 ----------
// 단축키도 확장 호출로 인정되어 팝업 없이 탭 오디오를 캡처할 수 있음
const MODEL_DEFAULTS = {
  groq: { sttModel: 'whisper-large-v3-turbo', llmModel: 'llama-3.3-70b-versatile' },
  openai: { sttModel: 'gpt-4o-mini-transcribe', llmModel: 'gpt-4o-mini' }
};
const DEFAULT_CFG = {
  engine: 'auto', provider: 'groq', translator: 'auto', showApi: false,
  sttModel: MODEL_DEFAULTS.groq.sttModel, llmModel: MODEL_DEFAULTS.groq.llmModel,
  pauseMs: 600, maxSegSec: 8
};
const DEFAULT_VIEW = { src: 'ko', song: false, songSrc: 'auto', interval: 3, targets: ['ja', 'en'], showOrig: true, fontSize: 20, maxLines: 3, bgOpacity: 62 };

async function buildSettings() {
  const [{ cfg: c, view: v }, { apiKeys }] = await Promise.all([
    chrome.storage.sync.get(['cfg', 'view']),
    chrome.storage.local.get('apiKeys')
  ]);
  const cfg = { ...DEFAULT_CFG, ...(c || {}) };
  if (!['auto', 'webspeech', 'local', 'api'].includes(cfg.engine)) cfg.engine = 'auto';
  const view = { ...DEFAULT_VIEW, ...L.migrateView(v || {}) };
  const apiKey = (apiKeys || {})[cfg.provider] || '';
  // 키가 필요한 방식인데 키가 없으면 무료 방식으로 대체
  if (cfg.engine === 'api' && !apiKey) cfg.engine = 'auto';
  if (cfg.translator === 'llm' && !apiKey) cfg.translator = 'auto';
  return { ...cfg, apiKey, src: view.src, targets: view.targets, song: view.song, songSrc: view.songSrc, interval: view.interval };
}

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'toggle-translate') return;
  try {
    if (!tab || !tab.id) [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || !tab.url.startsWith('https://chzzk.naver.com/')) return;
    const st = await getState();
    if (st.running && st.tabId === tab.id) { await stopSession(); return; }
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
    await startSession({ tabId: tab.id, streamId, settings: await buildSettings() });
  } catch (e) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'status', level: 'error', msg: { key: 'st.startFail', vars: { err: I.errVal(e) } } });
    } catch (e2) { /* 무시 */ }
  }
});

// 번역 중에 입력·출력 언어를 바꾸면 멈추지 않고 바로 반영
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'sync' || !changes.view) return;
  const st = await getState();
  if (!st.running) return;
  const v = { ...DEFAULT_VIEW, ...L.migrateView(changes.view.newValue || {}) };
  try {
    await chrome.runtime.sendMessage({ target: 'offscreen', type: 'update', patch: { src: v.src, targets: v.targets, song: v.song, songSrc: v.songSrc, interval: v.interval } });
  } catch (e) { /* 오프스크린 없음 */ }
});
