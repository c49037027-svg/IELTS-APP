// 發音：用瀏覽器內建的語音合成（Web Speech API），不下載音檔、不連任何外部服務。
// iOS / Android 的英語語音是裝在系統裡的，所以加到主畫面、離線也念得出來。
//
// 介面層不要直接碰 speechSynthesis，一律走 Speech.say / Speech.button，
// 這樣「不支援語音的瀏覽器」只會少一顆喇叭按鈕，不會讓整個練習流程壞掉。
const Speech = (() => {
  'use strict';

  const PREFS_KEY = 'ielts-speech';
  const DEFAULTS = { accent: 'en-GB', rate: 0.9, autoExample: false };
  const ACCENTS = [
    { value: 'en-GB', label: '英式' },
    { value: 'en-US', label: '美式' }
  ];

  let prefs = loadPrefs();
  let voices = [];

  // ------------------------------------------------------------ 偏好設定
  function normalisePrefs(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const accent = ACCENTS.some(a => a.value === src.accent) ? src.accent : DEFAULTS.accent;
    // 語速太慢會變得很不自然，太快對拼字聽寫沒幫助，夾在 0.6–1.2
    let rate = Number(src.rate);
    if (!isFinite(rate)) rate = DEFAULTS.rate;
    rate = Math.min(1.2, Math.max(0.6, rate));
    return { accent, rate, autoExample: src.autoExample === true };
  }

  function loadPrefs() {
    try {
      return normalisePrefs(JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'));
    } catch (e) {
      return { ...DEFAULTS };
    }
  }

  function getPrefs() {
    return { ...prefs };
  }

  function setPrefs(patch) {
    prefs = normalisePrefs({ ...prefs, ...patch });
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch (e) {
      // 無痕模式寫不進去也沒關係，這一輪還是照設定念
    }
    return getPrefs();
  }

  // ------------------------------------------------------------ 語音挑選
  function langOf(voice) {
    // 有些平台回 en_GB，有些回 en-GB
    return String((voice && voice.lang) || '').replace('_', '-');
  }

  /**
   * 從瀏覽器給的語音清單裡挑一個。純函式，好測試。
   * 順序：本機的同口音 → 任何同口音 → 本機的其他英語 → 任何英語 → null。
   * 優先本機語音（localService）是因為雲端語音在飛航模式會失敗。
   */
  function pickVoice(list, accent) {
    const all = Array.isArray(list) ? list.filter(Boolean) : [];
    const want = String(accent || DEFAULTS.accent).toLowerCase();
    const isEnglish = v => langOf(v).toLowerCase().startsWith('en');
    const sameAccent = v => langOf(v).toLowerCase() === want;
    const local = v => v.localService === true;

    return all.find(v => sameAccent(v) && local(v))
      || all.find(sameAccent)
      || all.find(v => isEnglish(v) && local(v))
      || all.find(isEnglish)
      || null;
  }

  function supported() {
    return typeof window !== 'undefined'
      && typeof window.speechSynthesis !== 'undefined'
      && typeof window.SpeechSynthesisUtterance === 'function';
  }

  function refreshVoices() {
    if (!supported()) { voices = []; return voices; }
    try {
      voices = window.speechSynthesis.getVoices() || [];
    } catch (e) {
      voices = [];
    }
    return voices;
  }

  function currentVoice() {
    if (!voices.length) refreshVoices();
    return pickVoice(voices, prefs.accent);
  }

  // ------------------------------------------------------------ 念出來
  function say(text) {
    const words = String(text || '').trim();
    if (!words || !supported()) return false;
    try {
      const synth = window.speechSynthesis;
      synth.cancel();          // 連按兩顆喇叭時，後面那顆蓋掉前面那顆
      synth.resume();          // iOS 從背景回來有時會卡在 paused
      const utter = new window.SpeechSynthesisUtterance(words);
      const voice = currentVoice();
      if (voice) utter.voice = voice;
      utter.lang = voice ? langOf(voice) : prefs.accent;
      utter.rate = prefs.rate;
      synth.speak(utter);
      return true;
    } catch (e) {
      // 念不出來就算了，絕對不能讓它中斷正在進行的練習
      return false;
    }
  }

  /** 只有在使用者把「自動念例句」打開時才出聲。 */
  function autoSay(text) {
    if (!prefs.autoExample) return false;
    return say(text);
  }

  function stop() {
    if (!supported()) return;
    try { window.speechSynthesis.cancel(); } catch (e) { /* 忽略 */ }
  }

  // ------------------------------------------------------------ 按鈕
  function escAttr(value) {
    return String(value)
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /**
   * 產生一顆喇叭按鈕。不支援語音的瀏覽器回空字串，版面自動少一顆按鈕。
   * 文字放在 data-speak，用事件代理接 —— 例句裡有引號和撇號，
   * 塞進 onclick="" 會炸掉。
   */
  function button(text, opts) {
    const words = String(text || '').trim();
    if (!words || !supported()) return '';
    const o = opts || {};
    const cls = 'speak-btn' + (o.className ? ' ' + o.className : '');
    const label = o.label ? `<span class="speak-label">${escAttr(o.label)}</span>` : '';
    return `<button type="button" class="${cls}" data-speak="${escAttr(words)}"
      aria-label="念出 ${escAttr(words.length > 40 ? words.slice(0, 40) + '…' : words)}"
      title="念一次">🔊${label}</button>`;
  }

  // ------------------------------------------------------------ 初始化
  function init() {
    if (!supported()) return;
    refreshVoices();
    // 語音清單是非同步載入的，Safari 第一次幾乎一定是空的
    try {
      window.speechSynthesis.addEventListener('voiceschanged', refreshVoices);
    } catch (e) {
      window.speechSynthesis.onvoiceschanged = refreshVoices;
    }
    // 事件代理：整頁只掛一個 listener，之後每次重畫都不用重掛
    document.addEventListener('click', e => {
      const btn = e.target.closest && e.target.closest('[data-speak]');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();     // 喇叭常常疊在會翻面的卡片上
      say(btn.getAttribute('data-speak'));
    });
  }

  return {
    ACCENTS, DEFAULTS,
    supported, init, say, autoSay, stop, button,
    getPrefs, setPrefs, pickVoice, refreshVoices,
    _normalisePrefs: normalisePrefs
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Speech;
