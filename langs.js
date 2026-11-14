// 지원 언어 표: 음성 인식(입력)·번역(출력)에 쓰는 언어와 각 엔진의 언어 코드
// 팝업·방송 화면·오프스크린·서비스 워커가 함께 씀
(function (g) {
  // code: 확장 안에서 쓰는 코드 (크롬 내장 번역 API 코드와 같음)
  // ws: 크롬 내장 음성 인식(Web Speech) 코드, gt: Google 번역 코드, name: AI 번역 프롬프트용 영어 이름
  // input: 입력(음성) 언어로 고를 수 있는지 — 번체 중국어는 음성으로는 중국어와 같으므로 출력 전용
  const LANGS = [
    { code: 'ko', label: '한국어', ws: 'ko-KR', gt: 'ko', name: 'Korean', input: true, sample: '안녕하세요 여러분' },
    { code: 'ja', label: '日本語', ws: 'ja-JP', gt: 'ja', name: 'Japanese', input: true, sample: 'こんにちは、みなさん' },
    { code: 'en', label: 'English', ws: 'en-US', gt: 'en', name: 'English', input: true, sample: 'Hello, everyone' },
    { code: 'zh', label: '简体中文', ws: 'cmn-Hans-CN', gt: 'zh-CN', name: 'Simplified Chinese', input: true, sample: '大家好' },
    { code: 'zh-Hant', label: '繁體中文', ws: 'cmn-Hant-TW', gt: 'zh-TW', name: 'Traditional Chinese', input: false, sample: '大家好' },
    { code: 'es', label: 'Español', ws: 'es-ES', gt: 'es', name: 'Spanish', input: true, sample: 'Hola a todos' },
    { code: 'fr', label: 'Français', ws: 'fr-FR', gt: 'fr', name: 'French', input: true, sample: 'Bonjour à tous' },
    { code: 'de', label: 'Deutsch', ws: 'de-DE', gt: 'de', name: 'German', input: true, sample: 'Hallo zusammen' },
    { code: 'ru', label: 'Русский', ws: 'ru-RU', gt: 'ru', name: 'Russian', input: true, sample: 'Всем привет' },
    { code: 'vi', label: 'Tiếng Việt', ws: 'vi-VN', gt: 'vi', name: 'Vietnamese', input: true, sample: 'Xin chào mọi người' },
    { code: 'th', label: 'ไทย', ws: 'th-TH', gt: 'th', name: 'Thai', input: true, sample: 'สวัสดีทุกคน' },
    { code: 'id', label: 'Indonesia', ws: 'id-ID', gt: 'id', name: 'Indonesian', input: true, sample: 'Halo semuanya' },
    { code: 'pt', label: 'Português', ws: 'pt-BR', gt: 'pt', name: 'Portuguese', input: true, sample: 'Olá a todos' }
  ];
  const BY = Object.fromEntries(LANGS.map((l) => [l.code, l]));
  const INPUTS = LANGS.filter((l) => l.input).map((l) => l.code);
  // 자막(번역) 언어는 한국어·일본어·영어만
  const OUTPUTS = ['ko', 'ja', 'en'];

  // 자막 위에 붙이는 짧은 표시 (KO, JA, ZH …)
  function tag(code) {
    if (code === 'zh-Hant') return 'ZH-T';
    return String(code || '').toUpperCase();
  }

  // 출력 언어가 원문 언어와 같은지 (같으면 번역하지 않고 원문을 그대로 씀)
  function same(src, tgt) {
    return !!src && src === tgt;
  }

  // '노래 자막'을 켰을 때 알아듣는 언어 (평소에는 한국어로 고정)
  const SONG_LANGS = ['ko', 'ja', 'en'];

  // 노래 자막의 입력 언어: 자동(한국어·영어·일본어 중 알아서) 또는 셋 중 하나로 고정
  function normSongSrc(v) {
    return v === 'ko' || v === 'ja' || v === 'en' ? v : 'auto';
  }

  // 번역 간격(초): 말이 쉬지 않고 이어져도 이 시간마다 끊어 번역
  const INTERVAL = { min: 1, max: 10, def: 3 };
  function normInterval(n) {
    const v = Math.round(Number(n));
    return Number.isFinite(v) ? Math.min(INTERVAL.max, Math.max(INTERVAL.min, v)) : INTERVAL.def;
  }

  // 이전 버전 설정 → 1.7 설정(src/song/interval/targets/showOrig)
  function migrateView(v) {
    const out = { ...(v || {}) };
    if (!Array.isArray(out.targets)) {
      const t = [];
      if (out.showJa !== false) t.push('ja');
      if (out.showEn !== false) t.push('en');
      out.targets = t;
    }
    // 예전에 고른 중국어·스페인어 등 자막 언어는 빠짐 (남는 게 없으면 기본값)
    out.targets = out.targets.filter((c, i, a) => OUTPUTS.includes(c) && a.indexOf(c) === i);
    if (!out.targets.length && Array.isArray(v && v.targets) && v.targets.length) out.targets = ['ja', 'en'];
    if (typeof out.showOrig !== 'boolean') out.showOrig = out.showKo !== false;
    // 1.8: '원문 보기'가 동작하지 않던 문제를 고치면서 한 번 켜 둠 (들리는 대로 적는 원문이 보이도록)
    if (out.cfgVer !== 18) { out.showOrig = true; out.cfgVer = 18; }
    // 듣는 언어·번역 간격은 설정 화면에서 뺐으므로 항상 한국어 · 3초
    out.src = 'ko';
    if (typeof out.song !== 'boolean') out.song = out.fast === true; // 1.6 '노래·빠른 말 모드' → '노래 자막'
    out.interval = INTERVAL.def;
    out.songSrc = normSongSrc(out.songSrc);
    delete out.showKo; delete out.showJa; delete out.showEn; delete out.detect; delete out.fast;
    return out;
  }

  // 노래 자막(테스트)은 아래 치지직 채널을 모두 팔로우한 사용자만 쓸 수 있음
  const SONG_CHANNELS = [
    '2299fad4bebb504b0978e1ec08b2f7d3',
    '49d2c3cf8f0b2843d934ec15e82bb54c',
    'a6c4ddb09cdb160478996007bff35296',
    '8fd39bb8de623317de90654718638b10',
    '4325b1d5bbc321fad3042306646e2e50',
    '792acf9ca28b42918710327e14b06b68',
    'c657aa3592260a2b59669a72ec151936',
    '36ddb9bb4f17593b60f1b63cec86611d',
    '4d812b586ff63f8a2946e64fa860bbf5',
    '516937b5f85cbf2249ce31b0ad046b0f',
    '64d76089fba26b180d9c9e48a32600d9',
    '4515b179f86b67b4981e16190817c580',
    '45e71a76e949e16a34764deb962f9d9f',
    'b5ed5db484d04faf4d150aedd362f34b',
    'b044e3a3b9259246bc92e863e7d3f3b8'
  ];

  // 노래 자막의 브라우저 모델(whisper-large-v3-turbo, 4비트) 내려받기 크기
  const FAST_MODEL_MB = 760;

  g.CLTR_LANGS = { LANGS, BY, INPUTS, OUTPUTS, MAX_TARGETS: 3, FAST_MODEL_MB, SONG_LANGS, SONG_CHANNELS, INTERVAL, tag, same, normInterval, normSongSrc, migrateView };
})(typeof globalThis !== 'undefined' ? globalThis : self);
