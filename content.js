// 치지직 페이지: 번역 자막 오버레이 + 플레이어 안 실시간 설정 패널
(() => {
  if (window.__chzzkLiveTranslatorLoaded) return;
  window.__chzzkLiveTranslatorLoaded = true;

  const I = globalThis.CLTR_I18N;
  const L = globalThis.CLTR_LANGS;
  const DEFAULT_VIEW = { src: 'ko', song: false, songSrc: 'auto', interval: 3, targets: ['ja', 'en'], showOrig: true, fontSize: 20, maxLines: 3, bgOpacity: 62 };
  let view = { ...DEFAULT_VIEW };
  let running = false;
  let srcInfo = null; // { code, auto, detected } — 지금 인식 중인 입력 언어
  let lang = I.resolveLang('auto');
  let uiPref = 'auto';
  const T = (k, v) => I.t(lang, k, v);
  let lastStatus = { msg: 'st.off', level: 'info' };
  let starting = false;

  let host = null;
  let root = null;
  let wrap = null;
  let listEl = null;
  let statusEl = null;
  let panel = null;
  let ctrlBtn = null;
  const blocks = new Map(); // id → element

  const CSS = `
    :host { all: initial; }
    .wrap {
      --bg: rgba(0,0,0,.62);
      position: fixed; z-index: 2147483646; width: min(720px, 90vw);
      font-family: "Pretendard", "Noto Sans KR", "Noto Sans JP", system-ui, sans-serif;
      color: #fff; pointer-events: auto; user-select: none;
    }
    .wrap.empty { pointer-events: none; }
    .bar {
      display: flex; align-items: center; gap: 8px; height: 24px; padding: 0 8px;
      background: rgba(0,0,0,.55); border-radius: 8px 8px 0 0; font-size: 12px;
      opacity: 0; transition: opacity .15s; cursor: move;
    }
    .wrap:hover .bar { opacity: 1; }
    .wrap.empty .bar { display: none; }
    .status { flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: #cfe; }
    .status.warn { color: #ffd479; }
    .status.error { color: #ff8a8a; }
    .ibtn { cursor: pointer; background: none; border: 0; color: #fff; font-size: 13px; padding: 0 2px; }
    .list { display: flex; flex-direction: column; gap: 6px; }
    .blk {
      background: var(--bg); border-radius: 10px; padding: 6px 12px;
      line-height: 1.35; text-shadow: 0 1px 2px #000; transition: opacity .3s;
    }
    .ln .tag { display: inline-block; margin-right: 6px; padding: 0 4px; border-radius: 3px; font-size: .62em; line-height: 1.5;
      font-weight: 700; letter-spacing: .02em; vertical-align: .18em; background: rgba(255,255,255,.16); color: #e8e8e8; text-shadow: none; font-style: normal; }
    .orig { color: #c8c8c8; font-size: .72em; }
    .tr { color: #fff; }
    .tr.c1 { color: #9fe7ff; font-size: .9em; }
    .tr.c2 { color: #ffe59f; font-size: .9em; }
    .orig.live { color: #e6e6e6; font-style: italic; font-size: .8em; }
    /* 노래 자막: 원문(위층, 크게) + 번역(아래층)을 한 덩어리로, 가운데 정렬 + 글자 테두리 (영상 위에 바로 얹은 노래 자막처럼) */
    .blk.song { background: transparent; text-align: center; padding: 2px 8px; line-height: 1.25; }
    .song .ln { color: #fff; -webkit-text-stroke: .14em rgba(0,0,0,.92); paint-order: stroke fill;
      text-shadow: 0 2px 6px rgba(0,0,0,.75); font-style: normal; }
    .song .orig { font-size: 1.3em; font-weight: 500; margin: 1px 0 2px; }
    .song .tr { font-size: 1.05em; font-weight: 600; }
    .song .tr.c1, .song .tr.c2 { font-size: .9em; color: #e8f6ff; }
    .blk.song + .blk.song { margin-top: 10px; } /* 원문+번역 묶음끼리는 띄워서 한 덩어리로 보이게 */
    .blk.song.writing .ln { opacity: .72; }
    .blk.song.writing .orig::after { content: '…'; opacity: .6; }
    .src { flex: none; color: #00ffa3; font-weight: 700; font-size: 11px; letter-spacing: .02em; }
    .pending { opacity: .6; }
    .hidden { display: none !important; }

    /* 실시간 설정 패널 — 치지직 플레이어 설정 메뉴와 같은 톤 */
    .panel {
      position: fixed; z-index: 2147483647; width: 280px; box-sizing: border-box; max-height: calc(100vh - 16px); overflow-y: auto;
      background: rgba(18,18,18,.94); border-radius: 10px; padding: 12px 14px 14px;
      box-shadow: 0 6px 24px rgba(0,0,0,.45); color: #fff; font-size: 13px;
      font-family: "Pretendard", "Noto Sans KR", system-ui, sans-serif; user-select: none;
    }
    .p-head { display: flex; align-items: center; margin-bottom: 10px; }
    .p-title { flex: 1; font-weight: 700; font-size: 14px; }
    .p-close { cursor: pointer; background: none; border: 0; color: #aaa; font-size: 16px; line-height: 1; padding: 2px 4px; }
    .p-close:hover { color: #fff; }
    .p-state { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 8px;
      background: rgba(255,255,255,.06); margin-bottom: 12px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #666; flex: none; }
    .dot.on { background: #00ffa3; box-shadow: 0 0 6px #00ffa3; }
    .p-state-text { flex: 1; font-size: 12px; color: #ccc; line-height: 1.35; }
    .p-stop, .p-start { cursor: pointer; border: 0; border-radius: 6px; padding: 5px 10px; font-size: 12px;
      font-weight: 600; font-family: inherit; flex: none; }
    .p-stop { background: #ff5c5c; color: #fff; }
    .p-start { background: #00ffa3; color: #04130c; }
    .p-start:disabled { opacity: .5; cursor: default; }
    .row { margin: 10px 0; }
    .row-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; color: #ddd; }
    .val { color: #00ffa3; font-variant-numeric: tabular-nums; }
    .sz { display: flex; align-items: center; gap: 8px; }
    .step { cursor: pointer; width: 26px; height: 26px; border-radius: 6px; border: 0; flex: none;
      background: rgba(255,255,255,.1); color: #fff; font-size: 15px; line-height: 1; font-family: inherit; }
    .step:hover { background: rgba(255,255,255,.18); }
    input[type=range] { flex: 1; width: 100%; accent-color: #00ffa3; margin: 0; }
    .chips { display: flex; gap: 6px; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
    .grid .chip { flex: none; padding: 5px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .chip .ord { font-size: 10px; margin-left: 3px; opacity: .8; }
    .sel { width: 100%; box-sizing: border-box; background: rgba(255,255,255,.06); color: #fff; font: inherit; font-size: 12px;
      border: 1px solid rgba(255,255,255,.18); border-radius: 6px; padding: 6px 8px; outline: none; }
    .sel:focus { border-color: #00ffa3; }
    .sel option { background: #1b1b1b; color: #fff; }
    .row-sub { color: #888; font-size: 11px; }
    .gate { margin-top: 8px; padding: 8px 10px; border-radius: 8px; background: rgba(255,212,121,.08); border: 1px solid rgba(255,212,121,.35); }
    .g-msg { color: #ffd479; font-size: 12px; line-height: 1.4; }
    .g-list { display: flex; flex-wrap: wrap; gap: 4px 6px; margin: 6px 0; max-height: 120px; overflow-y: auto; }
    .g-list a { color: #00ffa3; font-size: 12px; text-decoration: none; padding: 2px 6px; border-radius: 5px; background: rgba(0,255,163,.08); }
    .g-list a:hover { text-decoration: underline; }
    .g-re { width: 100%; margin-top: 4px; padding: 5px 0; }
    .g-diag { margin-top: 6px; color: #888; font-size: 10px; line-height: 1.35; word-break: break-all; user-select: text; }
    .chip { cursor: pointer; flex: 1; border-radius: 6px; padding: 6px 0; font-size: 12px; font-family: inherit;
      border: 1px solid rgba(255,255,255,.18); background: transparent; color: #aaa; }
    .chip.on { border-color: #00ffa3; color: #00ffa3; background: rgba(0,255,163,.08); }
    .chip.song { padding: 8px 0; font-size: 13px; font-weight: 700; }
    .chip.song.on { background: rgba(0,255,163,.16); }
    .sel:disabled { opacity: .45; }
    .p-foot { display: flex; gap: 6px; margin-top: 12px; }
    .p-link { cursor: pointer; flex: 1; border-radius: 6px; padding: 6px 0; font-size: 12px; font-family: inherit;
      border: 0; background: rgba(255,255,255,.08); color: #ccc; }
    .p-link:hover { background: rgba(255,255,255,.15); color: #fff; }
    .preview { margin-top: 10px; padding: 6px 10px; border-radius: 8px; background: var(--bg);
      text-shadow: 0 1px 2px #000; line-height: 1.35; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  `;

  // ---------- 오버레이 생성 ----------
  function build() {
    if (host) return;
    host = document.createElement('div');
    host.id = 'chzzk-live-translator-host';
    root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}</style>
      <div class="wrap empty">
        <div class="bar"><span class="src"></span><span class="status"></span>
          <button class="ibtn" data-act="settings">⚙</button>
          <button class="ibtn" data-act="clear">⌫</button>
          <button class="ibtn" data-act="hide">✕</button>
        </div>
        <div class="list"></div>
      </div>
      <div class="panel hidden"></div>`;
    wrap = root.querySelector('.wrap');
    listEl = root.querySelector('.list');
    statusEl = root.querySelector('.status');
    panel = root.querySelector('.panel');
    root.querySelector('[data-act="clear"]').onclick = clearCaptions;
    root.querySelector('[data-act="hide"]').onclick = () => { wrap.classList.add('hidden'); };
    root.querySelector('[data-act="settings"]').onclick = () => togglePanel(root.querySelector('[data-act="settings"]'));

    // 전체화면에서는 오버레이가 플레이어 안에 들어가므로 클릭이 영상 재생/정지로 새지 않게 막음
    ['click', 'dblclick', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'keydown', 'wheel'].forEach((t) =>
      host.addEventListener(t, (e) => e.stopPropagation()));

    setupPanelEvents();
    buildPanel();
    labelBar();
    enableDrag(wrap, root.querySelector('.bar'));
    restorePosition(wrap);
    attach();
    applyView();
    setStatus(lastStatus.msg, lastStatus.level);
  }

  function labelBar() {
    if (!root) return;
    root.querySelector('[data-act="settings"]').title = T('ui.settings');
    root.querySelector('[data-act="clear"]').title = T('ui.clear');
    root.querySelector('[data-act="hide"]').title = T('ui.hide');
  }

  // 설정 언어 바꾸기: 패널·버튼·상태 문구를 모두 다시 그림
  function setLang(pref) {
    uiPref = pref || 'auto';
    lang = I.resolveLang(uiPref);
    if (root) {
      const wasOpen = !panel.classList.contains('hidden');
      buildPanel();
      labelBar();
      setStatus(lastStatus.msg, lastStatus.level);
      if (wasOpen) panel.classList.remove('hidden');
    }
    if (ctrlBtn) {
      ctrlBtn.setAttribute('aria-label', T('ui.title'));
      const tip = ctrlBtn.querySelector('.cltr-tip');
      if (tip) tip.textContent = T('ui.title');
    }
    syncNativeItem();
  }

  function attach() {
    if (!host) return;
    const fs = document.fullscreenElement;
    const parent = fs && fs.tagName !== 'VIDEO' ? fs : document.body;
    if (host.parentNode !== parent) parent.appendChild(host);
    if (panel && !panel.classList.contains('hidden')) closePanel();
  }
  document.addEventListener('fullscreenchange', attach);

  function clearCaptions() {
    if (!listEl) return;
    listEl.textContent = '';
    blocks.clear();
    wrap.classList.add('empty');
  }

  // ---------- 드래그 ----------
  function enableDrag(el, handle) {
    let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
    handle.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.ibtn')) return;
      if (el.style.transform !== 'none') {
        const r0 = el.getBoundingClientRect();
        el.style.transform = 'none';
        place(el, r0.left, r0.top);
      }
      dragging = true;
      const r = el.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove', (e) => {
      if (dragging) place(el, ox + e.clientX - sx, oy + e.clientY - sy);
    });
    handle.addEventListener('pointerup', () => {
      if (!dragging) return;
      dragging = false;
      const r = el.getBoundingClientRect();
      chrome.storage.local.set({ overlayPos: { x: r.left / innerWidth, y: r.top / innerHeight } }).catch(() => {});
    });
  }

  function place(el, x, y) {
    const r = el.getBoundingClientRect();
    const maxX = Math.max(0, innerWidth - r.width);
    const maxY = Math.max(0, innerHeight - 40);
    el.style.left = Math.min(maxX, Math.max(0, x)) + 'px';
    el.style.top = Math.min(maxY, Math.max(0, y)) + 'px';
    el.style.bottom = 'auto';
  }

  function defaultPosition(el) {
    el.style.left = '50%';
    el.style.top = 'auto';
    el.style.transform = 'translateX(-50%)';
    el.style.bottom = '90px';
  }

  function restorePosition(el) {
    defaultPosition(el);
    chrome.storage.local.get('overlayPos').then(({ overlayPos }) => {
      if (!overlayPos) return;
      el.style.transform = 'none';
      place(el, overlayPos.x * innerWidth, overlayPos.y * innerHeight);
    }).catch(() => {});
  }

  // ---------- 표시 설정 적용 ----------
  function applyView() {
    if (!root) return;
    wrap.style.fontSize = view.fontSize + 'px';
    const bg = `rgba(0,0,0,${(view.bgOpacity / 100).toFixed(2)})`;
    wrap.style.setProperty('--bg', bg);
    panel.style.setProperty('--bg', bg);
    for (const el of blocks.values()) applyBlockView(el);
    renderSrc();
    while (blocks.size > view.maxLines) {
      const [oldId, oldEl] = blocks.entries().next().value;
      oldEl.remove();
      blocks.delete(oldId);
    }
    syncPanel();
    syncNativeItem();
  }

  // 한 자막 블록 그리기
  //  - 일반: 들리는 대로 적은 원문(원문 보기를 켰을 때) → 자막 언어별 번역
  //  - 노래 자막: 원문(위층)과 번역(아래층)을 한 자막으로 묶어 가운데 정렬 (표시 줄 수에서 한 줄로 셈)
  //  - 말하는 중(중간 결과): 지금 들리는 대로 적고 있는 글자를 그대로 보여 줌
  function addLine(box, cls, tag, text, lang) {
    const d = document.createElement('div');
    d.className = 'ln ' + cls;
    if (lang) d.lang = lang;
    if (tag) {
      const t = document.createElement('span');
      t.className = 'tag';
      t.textContent = tag;
      d.appendChild(t);
    }
    const x = document.createElement('span');
    x.className = 'tx';
    x.textContent = text;
    d.appendChild(x);
    box.appendChild(d);
  }

  function applyBlockView(el) {
    const c = el.__c || {};
    const interim = el.classList.contains('interim');
    const box = el.querySelector('.lines');
    box.textContent = '';
    el.classList.toggle('song', !!c.song);
    el.classList.toggle('writing', !!c.song && interim);
    const srcTag = c.src ? L.tag(c.src) : '';
    if (c.song) {
      // 노래 자막: 원문(위층, 크게)과 번역(아래층)을 한 자막으로 묶어 가운데 정렬 — '표시 줄 수'에서도 한 줄로 셈
      // 받아 적는 중에는 원문만 흐리게 보여 주다가, 완성되면 아래층에 번역이 붙음
      // 입력 언어와 같은 자막 언어가 있으면 원문을 따로 두 번 쓰지 않고 그 자막 줄 하나로만 보여 줌
      if (interim) { if (c.orig) addLine(box, 'orig', '', c.orig, c.src); return; }
      const srcIsTarget = view.targets.some((t) => L.same(c.src, t));
      if (c.orig && !srcIsTarget) addLine(box, 'orig', '', c.orig, c.src);
      view.targets.forEach((t, i) => {
        const tx = L.same(c.src, t) ? c.orig : (c.tr && c.tr[t]);
        if (tx) addLine(box, 'tr c' + i, '', tx, t);
      });
      return;
    }
    if (interim) {
      if (c.orig) addLine(box, 'orig live', srcTag, c.orig, c.src);
      return;
    }
    if (view.showOrig && c.orig) addLine(box, 'orig', srcTag, c.orig, c.src);
    view.targets.forEach((t, i) => {
      // 자막 언어가 원문과 같으면: 원문 보기를 켰을 땐 위 원문 줄로 충분, 껐을 땐 이 줄에 원문을 보여 줌
      if (L.same(c.src, t)) { if (!view.showOrig && c.orig) addLine(box, 'tr c' + i, '', c.orig, t); return; }
      const tx = c.tr && c.tr[t];
      if (tx) addLine(box, 'tr c' + i, '', tx, t);
    });
  }

  let saveTimer = null;
  function updateView(patch) {
    view = { ...view, ...patch };
    applyView();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { chrome.storage.sync.set({ view }).catch(() => {}); }, 300);
  }

  // ---------- 자막 ----------
  function upsert(c) {
    build();
    let el = blocks.get(c.id);
    if (c.remove) {
      if (el) { el.remove(); blocks.delete(c.id); }
      if (!blocks.size) wrap.classList.add('empty');
      return;
    }
    if (!el) {
      el = document.createElement('div');
      el.className = 'blk';
      el.innerHTML = '<div class="lines"></div>';
      el.__c = { src: null, orig: '', tr: {}, song: false };
      listEl.appendChild(el);
      blocks.set(c.id, el);
      while (blocks.size > view.maxLines) {
        const [oldId, oldEl] = blocks.entries().next().value;
        oldEl.remove();
        blocks.delete(oldId);
      }
    }
    wrap.classList.remove('empty');
    el.classList.toggle('interim', !!c.interim);
    el.classList.toggle('pending', !!c.pending && !c.interim);
    if (c.src) el.__c.src = c.src;
    if (c.orig != null) el.__c.orig = c.orig;
    if (c.tr) el.__c.tr = { ...el.__c.tr, ...c.tr };
    if (c.song != null) el.__c.song = !!c.song;
    applyBlockView(el);
  }

  function setStatus(msg, level) {
    lastStatus = { msg, level };
    if (statusEl) {
      statusEl.textContent = T(msg);
      statusEl.className = 'status' + (level === 'warn' ? ' warn' : level === 'error' ? ' error' : '');
    }
    syncPanel();
  }

  // 상태 막대 왼쪽: 지금 입력 언어 → 출력 언어 (예: AUTO·JA → KO·EN)
  function renderSrc() {
    if (!root) return;
    const el = root.querySelector('.src');
    if (!running || !srcInfo || !srcInfo.code) { el.textContent = ''; el.title = ''; return; }
    const outs = view.targets.map(L.tag).join('·');
    el.textContent = (srcInfo.auto ? '♪ ' : '') + L.tag(srcInfo.code) + (outs ? ' → ' + outs : '');
    el.title = T(srcInfo.auto ? 'ui.srcAutoTip' : 'ui.srcFixedTip', { lang: L.BY[srcInfo.code] ? L.BY[srcInfo.code].label : srcInfo.code });
  }

  function setRunning(on) {
    running = on;
    if (!on) srcInfo = null;
    renderSrc();
    if (ctrlBtn) ctrlBtn.classList.toggle('cltr-on', on);
    syncPanel();
    syncNativeItem();
  }

  // ---------- 노래 자막(테스트) 팔로우 확인 ----------
  // 치지직에 로그인한 상태로 각 채널 정보를 조회해 '내가 팔로우 중인지'(personalData.following)를 봄
  // 결과: { ok, reason: 'ok' | 'missing' | 'login' | 'error', missing: [{ id, name }] }
  const FOLLOW_TTL = 5 * 60 * 1000;
  let followCache = null;
  let followChecking = null;
  let gate = null; // 패널에 보여 줄 마지막 확인 결과 (통과하면 null)

  // 조회는 치지직 페이지 자신의 실행 환경(MAIN)에서 함 — 사이트가 쓰는 것과 똑같은 로그인 쿠키·요청으로 보내기 위해
  // (확장 쪽에서 직접 보내면 로그인 상태가 실리지 않는 경우가 있었음)
  function checkFollows(force) {
    if (!force && followCache && followCache.ok && Date.now() - followCache.at < FOLLOW_TTL) return Promise.resolve(followCache);
    if (followChecking) return followChecking;
    followChecking = (async () => {
      let raw = null;
      try {
        const res = await chrome.runtime.sendMessage({ target: 'background', type: 'followCheck', ids: L.SONG_CHANNELS });
        raw = res && res.ok ? res.data : null;
        if (!raw) throw new Error((res && res.error) || 'no result');
      } catch (e) {
        const r = { ok: false, reason: 'error', missing: [], diag: String(e && e.message || e), at: Date.now() };
        followCache = r;
        return r;
      }
      const r = decideFollows(raw);
      r.at = Date.now();
      followCache = r;
      return r;
    })().finally(() => { followChecking = null; });
    return followChecking;
  }

  // 판단 순서: 팔로우 목록 → 채널별 내 팔로우 정보 → 로그인 상태
  function decideFollows(raw) {
    const names = new Map((raw.rows || []).map((x) => [x.id, x.name || x.id]));
    const diag = (raw.diag || []).join(' · ');
    if (raw.loggedIn === false) return { ok: false, reason: 'login', missing: [], diag };
    let following = null;
    if (Array.isArray(raw.follow)) following = new Set(raw.follow);
    else if ((raw.rows || []).length && raw.rows.every((x) => typeof x.pd === 'boolean')) {
      following = new Set(raw.rows.filter((x) => x.pd).map((x) => x.id));
    }
    if (!following) return { ok: false, reason: raw.loggedIn === true ? 'error' : 'login', missing: [], diag };
    const missing = L.SONG_CHANNELS.filter((id) => !following.has(id)).map((id) => ({ id, name: names.get(id) || id }));
    return missing.length ? { ok: false, reason: 'missing', missing, diag } : { ok: true, reason: 'ok', missing: [], diag };
  }

  // 노래 자막 켜기 요청: 팔로우가 확인되면 켜고, 아니면 패널에 안내를 띄움
  async function requestSong(force) {
    gate = { reason: 'checking', missing: [] };
    syncPanel();
    const r = await checkFollows(force);
    gate = r.ok ? null : r;
    if (r.ok) updateView({ song: true });
    else syncPanel();
    return r;
  }

  // ---------- 실시간 설정 패널 ----------
  function buildPanel() {
    const uiChip = (v, label) => `<button class="chip ui" data-ui="${v}">${label}</button>`;
    panel.innerHTML = `
      <div class="p-head"><span class="p-title">${T('ui.title')}</span><button class="p-close" title="${T('ui.close')}">✕</button></div>
      <div class="p-state"><span class="dot"></span><span class="p-state-text"></span><button class="p-start">${T('ui.start')}</button><button class="p-stop">${T('ui.stop')}</button></div>
      <div class="row">
        <div class="row-top"><span>${T('ui.size')}</span><span class="val" data-v="size"></span></div>
        <div class="sz">
          <button class="step" data-step="-2" title="${T('ui.smaller')}">−</button>
          <input type="range" min="12" max="48" step="1" data-k="fontSize">
          <button class="step" data-step="2" title="${T('ui.bigger')}">+</button>
        </div>
      </div>
      <div class="row">
        <div class="row-top"><span>${T('ui.bg')}</span><span class="val" data-v="bg"></span></div>
        <input type="range" min="0" max="100" step="5" data-k="bgOpacity">
      </div>
      <div class="row">
        <div class="row-top"><span>${T('ui.lines')}</span><span class="val" data-v="lines"></span></div>
        <input type="range" min="1" max="6" step="1" data-k="maxLines">
      </div>
      <div class="row">
        <div class="chips"><button class="chip song" data-song="1">${T('ui.song')}</button></div>
        <div class="gate hidden"></div>
        <div class="song-src hidden">
          <div class="row-top" style="margin-top:8px"><span>${T('ui.songSrc')}</span></div>
          <div class="chips">
            <button class="chip" data-ssrc="auto">${T('ui.songSrcAuto')}</button>${L.SONG_LANGS.map((c) => `<button class="chip" data-ssrc="${c}">${L.BY[c].label}</button>`).join('')}
          </div>
        </div>
        <div class="row-sub" style="margin-top:5px">${T('ui.songSub', { langs: L.SONG_LANGS.map((c) => L.BY[c].label).join('·'), mb: L.FAST_MODEL_MB })}</div>
      </div>

      <div class="row">
        <div class="row-top"><span>${T('ui.tgtLang')}</span><span class="row-sub">${T('ui.tgtMax', { n: L.MAX_TARGETS })}</span></div>
        <div class="grid">
          ${L.OUTPUTS.map((c) => L.BY[c]).map((l) => `<button class="chip" data-tgt="${l.code}" title="${l.label}">${l.label}</button>`).join('')}
        </div>
      </div>
      <div class="row">
        <div class="chips"><button class="chip" data-orig="1">${T('ui.showOrig')}</button></div>
      </div>
      <div class="preview"></div>
      <div class="row">
        <div class="row-top"><span>${T('lang.label')}</span></div>
        <div class="chips">
          ${uiChip('auto', T('lang.autoShort'))}${uiChip('ko', '한국어')}${uiChip('ja', '日本語')}${uiChip('en', 'English')}
        </div>
      </div>
      <div class="p-foot">
        <button class="p-link" data-act="show">${T('ui.showAgain')}</button>
        <button class="p-link" data-act="reset-pos">${T('ui.resetPos')}</button>
      </div>`;

    panel.querySelector('.p-close').onclick = closePanel;
    panel.querySelector('.p-stop').onclick = () => {
      chrome.runtime.sendMessage({ target: 'background', type: 'stop' }).catch(() => {});
    };
    panel.querySelector('.p-start').onclick = startFromPage;

    panel.querySelectorAll('input[type=range]').forEach((inp) => {
      inp.addEventListener('input', () => updateView({ [inp.dataset.k]: Number(inp.value) }));
    });
    panel.querySelectorAll('.step').forEach((b) => {
      b.onclick = () => updateView({ fontSize: Math.min(48, Math.max(12, view.fontSize + Number(b.dataset.step))) });
    });
    panel.querySelectorAll('.chip[data-tgt]').forEach((b) => {
      b.onclick = () => {
        const code = b.dataset.tgt;
        let t = view.targets.slice();
        if (t.includes(code)) t = t.filter((c) => c !== code);
        else if (t.length < L.MAX_TARGETS) t.push(code);
        else return;
        updateView({ targets: t });
        primeTranslators([code]); // 클릭 안에서 크롬 내장 번역 모델을 미리 내려받기
      };
    });
    panel.querySelector('.chip[data-orig]').onclick = () => updateView({ showOrig: !view.showOrig });
    panel.querySelectorAll('.chip[data-ssrc]').forEach((b) => { b.onclick = () => updateView({ songSrc: b.dataset.ssrc }); });
    panel.querySelector('.chip[data-song]').onclick = () => {
      if (view.song) { gate = null; updateView({ song: false }); return; }
      primeTranslators(view.targets, L.SONG_LANGS); // 클릭 안에서 세 언어 → 자막 언어 번역 모델 미리 받기
      requestSong(false);
    };
    panel.querySelectorAll('.chip[data-ui]').forEach((b) => {
      b.onclick = () => {
        setLang(b.dataset.ui);
        chrome.storage.sync.set({ uiLang: b.dataset.ui }).catch(() => {});
      };
    });
    panel.querySelector('[data-act="show"]').onclick = () => wrap.classList.remove('hidden');
    panel.querySelector('[data-act="reset-pos"]').onclick = () => {
      defaultPosition(wrap);
      wrap.classList.remove('hidden');
      chrome.storage.local.remove('overlayPos').catch(() => {});
    };
    syncPanel();
  }

  // 마우스가 패널을 벗어나면 자동으로 닫힘 (슬라이더를 끄는 중에는 유지) — 한 번만 등록
  function setupPanelEvents() {
    panel.addEventListener('pointerenter', () => { panelEntered = true; clearTimeout(leaveTimer); });
    panel.addEventListener('pointerleave', () => { if (!pressing) scheduleClose(350); });
    panel.addEventListener('pointerdown', () => { pressing = true; });
    window.addEventListener('pointerup', (e) => {
      if (!pressing) return;
      pressing = false;
      if (panel.classList.contains('hidden')) return;
      const r = panel.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) scheduleClose(350);
    }, true);
  }

  function syncPanel() {
    if (!panel || !panel.firstElementChild) return;
    panel.querySelector('.dot').classList.toggle('on', running);
    panel.querySelector('.p-state-text').textContent = running ? T(lastStatus.msg)
      : (starting ? T('st.starting') : (lastStatus.level === 'error' ? T(lastStatus.msg) : T('st.off')));
    panel.querySelector('.p-stop').classList.toggle('hidden', !running);
    const sb = panel.querySelector('.p-start');
    sb.classList.toggle('hidden', running);
    sb.disabled = starting;
    panel.querySelector('[data-k="fontSize"]').value = view.fontSize;
    panel.querySelector('[data-k="bgOpacity"]').value = view.bgOpacity;
    panel.querySelector('[data-k="maxLines"]').value = view.maxLines;
    panel.querySelector('[data-v="size"]').textContent = view.fontSize + 'px';
    panel.querySelector('[data-v="bg"]').textContent = view.bgOpacity + '%';
    panel.querySelector('[data-v="lines"]').textContent = T('ui.linesVal', { n: view.maxLines });
    panel.querySelectorAll('.chip[data-tgt]').forEach((b) => {
      const i = view.targets.indexOf(b.dataset.tgt);
      b.classList.toggle('on', i >= 0);
      const label = L.BY[b.dataset.tgt].label;
      b.innerHTML = '';
      b.append(label);
      if (i >= 0 && view.targets.length > 1) {
        const o = document.createElement('span');
        o.className = 'ord';
        o.textContent = String(i + 1);
        b.appendChild(o);
      }
    });
    panel.querySelector('.chip[data-orig]').classList.toggle('on', !!view.showOrig);
    panel.querySelector('.chip[data-song]').classList.toggle('on', !!view.song);
    panel.querySelector('.song-src').classList.toggle('hidden', !view.song);
    panel.querySelectorAll('.chip[data-ssrc]').forEach((b) => b.classList.toggle('on', b.dataset.ssrc === view.songSrc));
    renderGate();
    panel.querySelectorAll('.chip[data-ui]').forEach((b) => b.classList.toggle('on', b.dataset.ui === uiPref));
    const pv = panel.querySelector('.preview');
    pv.style.fontSize = Math.min(view.fontSize, 26) + 'px';
    const first = view.targets[0] && L.BY[view.targets[0]];
    pv.textContent = first ? first.sample : L.BY.ko.sample;
  }

  // 팔로우 안내: 아직 팔로우하지 않은 채널을 링크로 보여 주고 '다시 확인' 버튼을 둠
  function renderGate() {
    const box = panel && panel.querySelector('.gate');
    if (!box) return;
    box.classList.toggle('hidden', !gate);
    if (!gate) { box.textContent = ''; return; }
    box.textContent = '';
    const p = document.createElement('div');
    p.className = 'g-msg';
    p.textContent = T(gate.reason === 'checking' ? 'gate.checking' : gate.reason === 'login' ? 'gate.login'
      : gate.reason === 'error' ? 'gate.error' : 'gate.missing', { n: gate.missing.length, total: L.SONG_CHANNELS.length });
    box.appendChild(p);
    if (gate.reason === 'checking') return;
    if (gate.missing.length) {
      const ul = document.createElement('div');
      ul.className = 'g-list';
      for (const m of gate.missing) {
        const a = document.createElement('a');
        a.href = 'https://chzzk.naver.com/' + m.id;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = m.name;
        ul.appendChild(a);
      }
      box.appendChild(ul);
    }
    if (gate.diag && gate.reason !== 'missing') {
      const d = document.createElement('div');
      d.className = 'g-diag';
      d.textContent = T('gate.diag') + ' ' + gate.diag;
      box.appendChild(d);
    }
    const b = document.createElement('button');
    b.className = 'p-link g-re';
    b.textContent = T('gate.recheck');
    b.onclick = () => requestSong(true);
    box.appendChild(b);
  }

  let leaveTimer = null;
  let panelEntered = false;
  let pressing = false;
  function scheduleClose(ms) {
    clearTimeout(leaveTimer);
    leaveTimer = setTimeout(() => { if (!pressing) closePanel(); }, ms);
  }

  function openPanel(anchor) {
    build();
    panel.classList.remove('hidden');
    const r = anchor && anchor.getBoundingClientRect && anchor.getBoundingClientRect();
    const pw = panel.offsetWidth || 280;
    const ph = panel.offsetHeight || 420;
    let left, top;
    if (r && r.width) {
      left = r.right - pw;
      top = r.top - ph - 10;
      if (top < 8) top = r.bottom + 10;
    } else {
      left = innerWidth - pw - 24;
      top = innerHeight - ph - 80;
    }
    panel.style.left = Math.max(8, Math.min(innerWidth - pw - 8, left)) + 'px';
    panel.style.top = Math.max(8, Math.min(innerHeight - ph - 8, top)) + 'px';
    setTimeout(() => document.addEventListener('pointerdown', outsideClose, true), 0);
    // 열어 놓고 패널로 마우스를 옮기지 않으면 잠시 뒤 닫힘
    panelEntered = false;
    clearTimeout(leaveTimer);
    leaveTimer = setTimeout(() => { if (!panelEntered && !pressing) closePanel(); }, 2500);
  }

  function closePanel() {
    clearTimeout(leaveTimer);
    pressing = false;
    if (panel) panel.classList.add('hidden');
    document.removeEventListener('pointerdown', outsideClose, true);
  }

  function outsideClose(e) {
    const path = e.composedPath();
    if (path.includes(panel) || (ctrlBtn && path.includes(ctrlBtn)) || path.some((n) => n && n.dataset && n.dataset.cltr)) return;
    closePanel();
  }

  function togglePanel(anchor) {
    build();
    if (panel.classList.contains('hidden')) openPanel(anchor); else closePanel();
  }

  // ---------- 방송 화면에서 바로 시작: 영상 요소의 소리를 직접 받아 보냄 ----------
  // 크롬은 페이지 안 버튼으로 탭 캡처를 허용하지 않으므로 video.captureStream()을 사용
  const cap = { ctx: null, proc: null, src: null, video: null, track: null, port: null,
    resampler: null, acc: new Int16Array(4000), accLen: 0, watch: null, active: false };

  class Resampler {
    constructor(inRate, outRate) { this.ratio = inRate / outRate; this.pos = 0; this.last = 0; }
    process(input) {
      const n = input.length;
      const out = new Float32Array(Math.ceil(n / this.ratio) + 2);
      let k = 0;
      while (this.pos < n - 1 && k < out.length) {
        const i = Math.floor(this.pos);
        const f = this.pos - i;
        const a = i < 0 ? this.last : input[i];
        out[k++] = a + (input[i + 1] - a) * f;
        this.pos += this.ratio;
      }
      this.pos -= n;
      this.last = input[n - 1];
      return out.subarray(0, k);
    }
  }

  function findVideo() {
    const vids = Array.from(document.querySelectorAll('video'));
    const main = vids.find((v) => v.classList.contains('webplayer-internal-video'));
    if (main) return main;
    return vids.sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight))[0] || null;
  }

  function sendPcm() {
    if (!cap.port || cap.accLen === 0) { cap.accLen = 0; return; }
    const bytes = new Uint8Array(cap.acc.buffer, 0, cap.accLen * 2);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x2000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x2000));
    try { cap.port.postMessage({ pcm: btoa(bin) }); } catch (e) { /* 연결 끊김 */ }
    cap.accLen = 0;
  }

  function attachVideo(video) {
    const ms = video.captureStream();
    const at = ms.getAudioTracks()[0];
    if (!at) throw I.err('err.noAudio');
    if (cap.src) { try { cap.src.disconnect(); } catch (e) { /* 무시 */ } }
    cap.src = cap.ctx.createMediaStreamSource(new MediaStream([at]));
    cap.src.connect(cap.proc);
    cap.video = video;
    cap.track = at;
  }

  // 크롬 내장 번역 모델은 사용자 클릭 안에서만 내려받을 수 있으므로, 클릭할 때 쓸 법한 언어 쌍을 미리 준비
  // (노래 자막이면 한국어·영어·일본어 → 자막 언어 모두, 모델이 없는 쌍은 Google 번역으로 대체)
  function primeTranslators(targets, sources) {
    try {
      if (!('Translator' in window)) return;
      const srcs = sources || (view.song ? L.SONG_LANGS : [view.src]);
      for (const src of srcs) {
        targets.filter((t) => !L.same(src, t)).forEach((t) => {
          Translator.create({ sourceLanguage: src, targetLanguage: t })
            .then((tr) => { try { tr.destroy(); } catch (e) { /* 무시 */ } }).catch(() => {});
        });
      }
    } catch (e) { /* 무시 */ }
  }

  async function startFromPage() {
    if (starting || running) return;
    starting = true;
    setStatus('st.starting', 'info');
    // 클릭 안에서 크롬 내장 번역 모델 내려받기를 미리 시작 (실패해도 Google 번역으로 대체됨)
    primeTranslators(view.targets);
    try {
      const video = findVideo();
      if (!video) throw I.err('err.noVideo');
      cap.ctx = new AudioContext();
      if (cap.ctx.state === 'suspended') await cap.ctx.resume();
      cap.resampler = new Resampler(cap.ctx.sampleRate, 16000);
      cap.proc = cap.ctx.createScriptProcessor(4096, 1, 1);
      cap.proc.onaudioprocess = (e) => {
        if (!cap.active) return;
        const r = cap.resampler.process(e.inputBuffer.getChannelData(0));
        for (let i = 0; i < r.length; i++) {
          const v = Math.max(-1, Math.min(1, r[i]));
          cap.acc[cap.accLen++] = v < 0 ? v * 0x8000 : v * 0x7fff;
          if (cap.accLen === cap.acc.length) sendPcm();
        }
      };
      const mute = cap.ctx.createGain();
      mute.gain.value = 0;
      cap.proc.connect(mute);
      mute.connect(cap.ctx.destination);
      attachVideo(video);

      const res = await chrome.runtime.sendMessage({ target: 'background', type: 'startPage' });
      if (!res || !res.ok) throw new Error((res && res.error) || 'err.startFailed');

      cap.port = chrome.runtime.connect({ name: 'cltr-pcm' });
      cap.port.onDisconnect.addListener(() => { cap.port = null; stopPageCapture(); });
      cap.active = true;
      // 화질 변경·방송 이동 등으로 영상 요소나 소리 트랙이 바뀌면 다시 연결
      cap.watch = setInterval(() => {
        if (!cap.active) return;
        const v = findVideo();
        if (!v) return;
        if (v !== cap.video || !cap.track || cap.track.readyState === 'ended') {
          try { attachVideo(v); } catch (e) { /* 재생 시작 전이면 다음에 다시 시도 */ }
        }
      }, 2000);
    } catch (e) {
      stopPageCapture();
      setStatus({ key: 'st.startFail', vars: { err: I.errVal(e) } }, 'error');
    } finally {
      starting = false;
      syncPanel();
    }
  }

  function stopPageCapture() {
    cap.active = false;
    if (cap.watch) { clearInterval(cap.watch); cap.watch = null; }
    if (cap.port) { const p = cap.port; cap.port = null; try { p.disconnect(); } catch (e) { /* 무시 */ } }
    if (cap.src) { try { cap.src.disconnect(); } catch (e) { /* 무시 */ } cap.src = null; }
    if (cap.proc) { cap.proc.onaudioprocess = null; try { cap.proc.disconnect(); } catch (e) { /* 무시 */ } cap.proc = null; }
    if (cap.ctx) { cap.ctx.close().catch(() => {}); cap.ctx = null; }
    cap.video = null;
    cap.track = null;
    cap.accLen = 0;
  }

  // ---------- 치지직 플레이어 연동 ----------
  const ICON = `<svg class="pzp-ui-icon__svg" width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="7" y="10" width="22" height="16" rx="3" stroke="currentColor" stroke-width="2"/>
    <path d="M11 17.5h5M18.5 17.5h6.5M11 21.5h8M21 21.5h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </svg>`;

  function injectPageStyle() {
    if (document.getElementById('cltr-page-style')) return;
    const st = document.createElement('style');
    st.id = 'cltr-page-style';
    st.textContent = `
      .cltr-btn { color: #fff; position: relative; transition: opacity .2s ease; }
      .cltr-btn .pzp-ui-icon { display: inline-flex; }
      .cltr-btn .cltr-tip {
        position: absolute; left: 50%; bottom: 100%; transform: translateX(-50%); margin-bottom: 6px;
        padding: 4px 8px; border-radius: 4px; background: rgba(0,0,0,.8); color: #fff;
        font-size: 12px; line-height: 1.3; white-space: nowrap; pointer-events: none;
        opacity: 0; transition: opacity .15s ease;
      }
      .cltr-btn:hover .cltr-tip { opacity: 1; }
      .cltr-btn.cltr-away { opacity: 0 !important; pointer-events: none !important; }
      .cltr-btn.cltr-on .pzp-ui-icon__svg { color: #00ffa3; filter: drop-shadow(0 0 3px rgba(0,255,163,.6)); }
    `;
    (document.head || document.documentElement).appendChild(st);
  }

  // 컨트롤 바 오른쪽에 '번역 자막' 버튼
  function ensureControlButton() {
    const right = document.querySelector('.pzp-pc__bottom-buttons-right');
    if (!right) return;
    if (ctrlBtn && right.contains(ctrlBtn)) return;
    injectPageStyle();
    ctrlBtn = document.createElement('button');
    ctrlBtn.type = 'button';
    ctrlBtn.className = 'pzp-button pzp-pc-ui-button cltr-btn' + (running ? ' cltr-on' : '');
    ctrlBtn.setAttribute('aria-label', T('ui.title'));
    ctrlBtn.innerHTML = `<span class="cltr-tip">${T('ui.title')}</span><span class="pzp-ui-icon">${ICON}</span>`;
    ctrlBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      ctrlBtn.blur(); // 포커스가 남아 있으면 컨트롤 바가 숨겨져도 버튼이 보이는 문제 방지
      togglePanel(ctrlBtn);
    });
    right.prepend(ctrlBtn);
  }

  // 마우스를 치워 치지직 컨트롤 바가 사라지면 우리 버튼도 같이 숨김
  // (옆에 있는 치지직 기본 버튼이 실제로 보이는지를 따라감)
  function isShown(el) {
    let op = 1;
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      op *= parseFloat(cs.opacity || '1');
      if (op < 0.05) return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
  }

  // 다른 확장이 넣은 버튼(예: 앰비언트 모드)이 아니라 치지직 원래 버튼을 기준으로 삼음
  function nativeRef(right) {
    const icon = document.querySelector('.pzp-pc-setting-button__icon');
    const sbtn = icon && icon.closest('button');
    if (sbtn && sbtn.isConnected) return sbtn;
    const kids = Array.from(right.children).reverse();
    // 다른 확장 버튼은 보통 앞쪽에 끼워 넣으므로 맨 뒤의 원래 버튼을 사용
    return kids.find((c) => c !== ctrlBtn && !c.classList.contains('cltr-btn')) || null;
  }

  // 보조 판단: 영상 재생 중 마우스가 플레이어 밖에 있거나 2.5초 이상 움직이지 않으면 컨트롤이 숨는 것으로 봄
  let lastMove = Date.now();
  let pointerInPlayer = false;
  function playerBox() {
    const v = findVideo();
    return v ? v.getBoundingClientRect() : null;
  }
  document.addEventListener('pointermove', (e) => {
    lastMove = Date.now();
    const r = playerBox();
    pointerInPlayer = !!r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  }, { passive: true, capture: true });
  document.addEventListener('pointerleave', () => { pointerInPlayer = false; }, true);
  document.documentElement.addEventListener('mouseleave', () => { pointerInPlayer = false; });

  function syncControlVisibility() {
    if (!ctrlBtn || !ctrlBtn.isConnected) return;
    const right = ctrlBtn.parentElement;
    const panelOpen = panel && !panel.classList.contains('hidden');
    const hovering = ctrlBtn.matches(':hover');
    const ref = right && nativeRef(right);
    const nativeShown = ref ? isShown(ref) : true;
    const v = findVideo();
    const playing = !!v && !v.paused;
    const idleHidden = playing && (!pointerInPlayer || Date.now() - lastMove > 2500);
    const shown = panelOpen || hovering || (nativeShown && !idleHidden);
    ctrlBtn.classList.toggle('cltr-away', !shown);
    if (!shown && document.activeElement === ctrlBtn) ctrlBtn.blur();
  }
  setInterval(syncControlVisibility, 200);

  // 플레이어 톱니바퀴 설정 메뉴 안에도 '번역 자막' 항목 추가 (기존 항목을 복제해 같은 모양 유지)
  let nativeItem = null;
  function ensureNativeItem() {
    const tpl = document.querySelector('.pzp-pc-ui-setting-intro-panel:not([data-cltr])');
    if (!tpl || !tpl.parentElement) return;
    if (nativeItem && tpl.parentElement.contains(nativeItem)) return;
    const item = tpl.cloneNode(true);
    item.dataset.cltr = '1';
    item.removeAttribute('id');
    item.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
    item.className = Array.from(tpl.classList).filter((c) => !/^pzp-pc-setting-intro-/.test(c)).join(' ');
    const texts = [];
    const tw = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
    while (tw.nextNode()) if (tw.currentNode.nodeValue.trim()) texts.push(tw.currentNode);
    if (!texts.length) return;
    texts.forEach((t, i) => { if (i > 1) t.nodeValue = ''; });
    item.__cltrLabel = texts[0];
    item.__cltrValue = texts[1] || null;
    const open = (e) => {
      e.preventDefault();
      e.stopPropagation();
      // 플레이어 설정 메뉴를 닫고 번역 자막 패널을 엶
      const sbtn = document.querySelector('.pzp-pc-setting-button__icon');
      const sbutton = sbtn && sbtn.closest('button');
      const anchor = ctrlBtn || sbutton;
      if (sbutton) sbutton.click();
      setTimeout(() => openPanel(anchor), 0);
    };
    item.addEventListener('click', open, true);
    item.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') open(e); }, true);
    tpl.parentElement.appendChild(item);
    nativeItem = item;
    syncNativeItem();
  }

  function syncNativeItem() {
    if (!nativeItem || !nativeItem.isConnected) return;
    if (nativeItem.__cltrLabel) nativeItem.__cltrLabel.nodeValue = T('ui.title');
    if (nativeItem.__cltrValue) nativeItem.__cltrValue.nodeValue = running ? T('ui.nativeOn', { px: view.fontSize }) : `${view.fontSize}px`;
  }

  // 치지직은 방송 이동·화면 전환 때 플레이어를 다시 그리므로 계속 확인
  let scheduled = false;
  const mo = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      try { ensureControlButton(); ensureNativeItem(); } catch (e) { /* 플레이어 구조 변경 시 무시 */ }
    });
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
  try { ensureControlButton(); } catch (e) { /* 무시 */ }

  // ---------- 저장된 설정 ----------
  chrome.storage.sync.get(['view', 'uiLang']).then(({ view: v, uiLang }) => {
    view = { ...DEFAULT_VIEW, ...L.migrateView(v || {}) };
    applyView();
    if (uiLang && uiLang !== uiPref) setLang(uiLang);
    if (view.song) checkFollows(false).then((r) => { if (!r.ok) { gate = r; updateView({ song: false }); } }).catch(() => {});
  }).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.uiLang && changes.uiLang.newValue !== uiPref) setLang(changes.uiLang.newValue);
    if (area === 'sync' && changes.view) {
      view = { ...DEFAULT_VIEW, ...L.migrateView(changes.view.newValue || {}) };
      applyView();
    }
  });

  chrome.runtime.sendMessage({ target: 'background', type: 'getState' }).then((res) => {
    if (res && res.ok && res.running) {
      setRunning(true);
      if (res.lang) { srcInfo = res.lang; renderSrc(); }
      if (res.status) setStatus(res.status, 'info');
    }
  }).catch(() => {});

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg) return false;
    switch (msg.type) {
      case 'ping': sendResponse({ ok: true }); break;
      case 'checkSongGate':
        checkFollows(!!msg.force).then((r) => { gate = r.ok ? null : r; syncPanel(); sendResponse(r); })
          .catch(() => sendResponse({ ok: false, reason: 'error', missing: [] }));
        return true;
      case 'settings': setRunning(true); setStatus('st.starting', 'info'); build(); wrap.classList.remove('hidden'); break;
      case 'caption': if (!running) setRunning(true); upsert(msg); break;
      case 'lang': srcInfo = { code: msg.code, auto: !!msg.auto, detected: !!msg.detected }; build(); renderSrc(); syncPanel(); break;
      case 'status': build(); setStatus(msg.msg || msg.text, msg.level); break;
      case 'stopped': if (!starting) stopPageCapture(); setRunning(false); if (lastStatus.level !== 'error') setStatus('st.stopped', 'info'); break;
      default: break;
    }
    return false;
  });
})();
