// 單字庫：卡片、三軌排程、複習/拼字/造句紀錄，全部存在 localStorage。
// 對應 cli/ielts/repository.py —— 介面層（js/vocab.js）只呼叫這裡，不自己翻資料結構。
const Store = (() => {
  const KEY = 'ielts-vocab-v2';
  const LEGACY_KEY = 'ielts-state';
  const SCHEMA_VERSION = 1;

  const TRACKS = ['recall', 'spelling', 'synonym'];

  //: 每天最多放幾張「沒學過的新卡」進來。複習到期的舊卡不受限制 ——
  //  沒有這個上限，800 張卡會在第一天全部到期，等於沒有排程。
  const NEW_PER_DAY = 20;
  const TRACK_LABELS = { recall: '認讀', spelling: '拼字', synonym: '同義詞' };
  const CORE_FIELDS = ['example', 'collocations', 'root', 'synonyms'];
  const CORE_LABELS = {
    example: '英文例句',
    collocations: '常見搭配詞',
    root: '字根字首拆解',
    synonyms: '同義詞群'
  };

  // 舊版單字表用英文主題名，這裡對回中文，跟種子資料一致。
  const LEGACY_TOPIC_MAP = {
    AWL: '學術通用', Education: '教育', Environment: '環境',
    Technology: '科技', Health: '健康', Work: '工作'
  };

  // 顯示偏好。中文意思只是「校對用」，不是記憶點 —— 所以它固定排在卡片背面
  // 最後一行、用小字；showZh 關掉之後全 App 都不再出現中文（純英文思考模式）。
  const DISPLAY_DEFAULTS = { showZh: true };

  let db = null;

  // ---------------------------------------------------------- 持久化
  function emptyDb() {
    return {
      version: SCHEMA_VERSION,
      nextId: 1,
      cards: [],
      srs: {},          // "cardId:track" -> state
      reviewLog: [],    // { cardId, track, rating, at }
      spelling: [],     // { cardId, input, correct, at }
      productions: [],  // { id, cardId, topic, prompt, sentence, at, feedback }
      prefs: { ...DISPLAY_DEFAULTS },
      seeded: false
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      db = raw ? JSON.parse(raw) : emptyDb();
    } catch (e) {
      console.warn('[store] 讀取失敗，改用空資料庫', e);
      db = emptyDb();
    }
    const base = emptyDb();
    Object.keys(base).forEach(k => { if (db[k] === undefined) db[k] = base[k]; });
    return db;
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(db));
      return true;
    } catch (e) {
      // 容量爆掉時不要靜靜失敗，讓使用者知道要匯出備份
      console.error('[store] 寫入失敗', e);
      alert('儲存失敗：瀏覽器空間可能已滿。建議先用「匯出 CSV」備份。');
      return false;
    }
  }

  const today = () => Dates.todayISO();

  // ---------------------------------------------------------- 顯示偏好
  function getPrefs() {
    return { ...DISPLAY_DEFAULTS, ...((db && db.prefs) || {}) };
  }

  function setPrefs(patch) {
    db.prefs = { ...getPrefs(), showZh: (patch || {}).showZh === true };
    save();
    return getPrefs();
  }

  /** 現在要不要顯示中文。整個 App 只認這一個判斷。 */
  const showZh = () => getPrefs().showZh === true;
  const daysAgo = n => Dates.addDays(today(), -n);

  // ---------------------------------------------------------- 卡片
  const multi = v => (Array.isArray(v) ? v : String(v || '').split(/[;|、]/))
    .map(s => String(s).trim()).filter(Boolean);

  function normaliseCard(input) {
    return {
      id: input.id || 0,
      word: String(input.word || '').trim(),
      pos: String(input.pos || '').trim(),
      example: String(input.example || '').trim(),
      collocations: multi(input.collocations),
      root: String(input.root || '').trim(),
      synonyms: multi(input.synonyms),
      category: String(input.category || '').trim(),
      topic: String(input.topic || '').trim(),
      cardType: input.cardType === 'active' ? 'active' : 'passive',
      zh: String(input.zh || '').trim(),
      exampleZh: String(input.exampleZh || '').trim(),
      phonetic: String(input.phonetic || '').trim(),
      notes: String(input.notes || '').trim(),
      createdAt: input.createdAt || Dates.nowISO()
    };
  }

  function missingCore(card) {
    return CORE_FIELDS.filter(f => {
      const v = card[f];
      return Array.isArray(v) ? v.length === 0 : !String(v || '').trim();
    });
  }

  const isIncomplete = card => missingCore(card).length > 0;
  const cardLabel = card => (card.pos ? `${card.word} (${card.pos})` : card.word);

  function addCard(input) {
    const card = normaliseCard(input);
    if (!card.word) throw new Error('word 不可為空');
    card.id = db.nextId++;
    db.cards.push(card);
    ensureSrs(card.id);
    return card;
  }

  function updateCard(id, fields) {
    const card = getCard(id);
    if (!card) return null;
    Object.keys(fields).forEach(k => {
      if (k === 'collocations' || k === 'synonyms') card[k] = multi(fields[k]);
      else if (k in card && k !== 'id') card[k] = String(fields[k] || '').trim();
    });
    save();
    return card;
  }

  const getCard = id => db.cards.find(c => c.id === Number(id)) || null;

  // 完全比對（word + pos）—— CSV 匯入用，跟 CLI 的 find_card 一致。
  const findCard = (word, pos = '') => db.cards.find(c =>
    c.word.toLowerCase() === String(word).trim().toLowerCase() &&
    c.pos.toLowerCase() === String(pos).trim().toLowerCase()) || null;

  // 只比對單字本身 —— 用在「這個字是不是已經在庫裡」的去重判斷，
  // 避免同一個字因為詞性標法不同（v. / 空白）被建成兩張卡。
  const findByWord = word => db.cards.find(c =>
    c.word.toLowerCase() === String(word).trim().toLowerCase()) || null;

  //: topic 篩選：先試完全比對，找不到才退回子字串。
  //  不這樣做的話，選「Sublist 1」會把 Sublist 10 一起抓進來。
  function topicMatcher(topic) {
    const exact = db.cards.some(c => c.topic === topic);
    return exact ? (c => c.topic === topic) : (c => c.topic.includes(topic));
  }

  function listCards(opts = {}) {
    let rows = db.cards.slice();
    if (opts.topic) rows = rows.filter(topicMatcher(opts.topic));
    if (opts.category) rows = rows.filter(c => c.category.includes(opts.category));
    if (opts.cardType) rows = rows.filter(c => c.cardType === opts.cardType);
    if (opts.incompleteOnly) rows = rows.filter(isIncomplete);
    if (opts.search) {
      const q = opts.search.toLowerCase();
      rows = rows.filter(c => c.word.toLowerCase().includes(q));
    }
    rows.sort((a, b) => a.word.localeCompare(b.word));
    return opts.limit ? rows.slice(0, opts.limit) : rows;
  }

  //: 補完佇列：AWL 依 sublist 由高頻到低頻（1 → 10），其餘排在後面。
  //  Sublist 1、2 已經寫齊，所以實際會從 Sublist 3 開始補。
  function completionQueue(opts = {}) {
    const rank = card => {
      const m = /^Sublist (\d+)$/.exec(card.topic || '');
      return m ? Number(m[1]) : 99;
    };
    const rows = db.cards.filter(isIncomplete);
    rows.sort((a, b) => rank(a) - rank(b) || a.word.localeCompare(b.word));
    return opts.limit ? rows.slice(0, opts.limit) : rows;
  }

  function setCardType(id, cardType) {
    const card = getCard(id);
    if (!card) return;
    card.cardType = cardType === 'active' ? 'active' : 'passive';
    save();
  }

  // ---------------------------------------------------------- 排程
  const srsKey = (cardId, track) => `${cardId}:${track}`;

  function ensureSrs(cardId, state) {
    TRACKS.forEach(track => {
      const k = srsKey(cardId, track);
      if (!db.srs[k]) db.srs[k] = state ? { ...SRS.newState(), ...state } : SRS.newState();
    });
  }

  function getSrs(cardId, track) {
    const k = srsKey(cardId, track);
    if (!db.srs[k]) db.srs[k] = SRS.newState();
    return db.srs[k];
  }

  function grade(cardId, track, rating) {
    const before = getSrs(cardId, track);
    const next = SRS.schedule(before, rating, today());
    db.srs[srsKey(cardId, track)] = next;
    db.reviewLog.push({ cardId: Number(cardId), track, rating, at: Dates.nowISO() });
    save();
    return next;
  }

  const isDue = (cardId, track) => getSrs(cardId, track).due <= today();
  const isNew = (cardId, track) => getSrs(cardId, track).reviews === 0;

  //: 今天已經放行了幾張新卡（某張卡在這個 track 的第一次複習發生在今天）
  function newIntroducedToday(track) {
    const day = today();
    const first = new Map();
    db.reviewLog.forEach(r => {
      if (r.track !== track) return;
      const at = r.at.slice(0, 10);
      if (!first.has(r.cardId) || at < first.get(r.cardId)) first.set(r.cardId, at);
    });
    let n = 0;
    first.forEach(at => { if (at === day) n += 1; });
    return n;
  }

  function shuffle(list) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }

  // 到期卡片：到期日早的排前面，同一天隨機打散。
  function dueItems(track, opts = {}) {
    let rows = db.cards.filter(c => isDue(c.id, track));
    if (opts.cardType) rows = rows.filter(c => c.cardType === opts.cardType);
    if (opts.topic) rows = rows.filter(topicMatcher(opts.topic));
    if (opts.category) rows = rows.filter(c => c.category.includes(opts.category));
    if (opts.requireExample) rows = rows.filter(c => c.example);
    if (opts.requireSynonyms) rows = rows.filter(c => c.synonyms.length >= 2);
    shuffle(rows);
    // 四個維度齊全的卡片先出 —— 複習的重點就是那四個維度，
    // 殘缺的卡排在後面（補完之後自然會回到前段）。
    rows.sort((a, b) => {
      if (opts.preferComplete) {
        const ia = isIncomplete(a) ? 1 : 0, ib = isIncomplete(b) ? 1 : 0;
        if (ia !== ib) return ia - ib;
      }
      return getSrs(a.id, track).due.localeCompare(getSrs(b.id, track).due);
    });

    // 舊卡（複習過的）全部放行；新卡每天有上限，才不會第一天就爆量。
    if (!opts.ignoreDailyLimit) {
      const allowance = Math.max(0, NEW_PER_DAY - newIntroducedToday(track));
      let taken = 0;
      rows = rows.filter(card => {
        if (!isNew(card.id, track)) return true;
        if (taken >= allowance) return false;
        taken += 1;
        return true;
      });
    }
    return opts.limit ? rows.slice(0, opts.limit) : rows;
  }

  function dueCount(track, opts = {}) {
    return dueItems(track, { ...opts, limit: 0 }).length;
  }

  // ---------------------------------------------------------- 拼字
  function recordSpelling(cardId, input, correct) {
    db.spelling.push({ cardId: Number(cardId), input: String(input).slice(0, 200), correct: !!correct, at: Dates.nowISO() });
    save();
  }

  const lastSpellingResult = cardId => {
    for (let i = db.spelling.length - 1; i >= 0; i--) {
      if (db.spelling[i].cardId === Number(cardId)) return db.spelling[i].correct;
    }
    return null;
  };

  //: 拼字題至少要有一個線索（挖空例句／中文提示／英文定義），
  //  否則就是「憑空拼一個字」，答不出來也學不到東西。
  // 拼字題至少要有一個線索，不然就是「憑空拼一個看不到的字」。
  // 關掉中文之後，只靠中文提示的卡片就出不了題了，要一起從佇列拿掉。
  const hasSpellingClue = card => !!(card.example || card.notes || (showZh() && card.zh));

  // onlyWrong 不看到期日：今天剛拼錯的字，當下就要能再練一次。
  function spellingQueue(opts = {}) {
    let rows;
    if (opts.onlyWrong) {
      rows = db.cards.filter(c => lastSpellingResult(c.id) === false);
    } else {
      rows = db.cards.filter(c => c.word && isDue(c.id, 'spelling') && hasSpellingClue(c));
    }
    const spellingAllowance = opts.onlyWrong || opts.ignoreDailyLimit
      ? Infinity
      : Math.max(0, NEW_PER_DAY - newIntroducedToday('spelling'));
    if (opts.topic) rows = rows.filter(topicMatcher(opts.topic));
    shuffle(rows);
    // 排序：拼錯的最優先 → 有「挖空例句 + 中文提示」的完整題目 → 其餘按到期日。
    // 只有英文定義可用的字頭卡排最後，不要淹掉設計好的題型。
    const zhUsable = card => showZh() && !!card.zh;
    const quality = card => (card.example && zhUsable(card) ? 0 : card.example || zhUsable(card) ? 1 : 2);
    rows.sort((a, b) => {
      const wrongA = lastSpellingResult(a.id) === false ? 0 : 1;
      const wrongB = lastSpellingResult(b.id) === false ? 0 : 1;
      if (wrongA !== wrongB) return wrongA - wrongB;
      const qa = quality(a), qb = quality(b);
      if (qa !== qb) return qa - qb;
      return getSrs(a.id, 'spelling').due.localeCompare(getSrs(b.id, 'spelling').due);
    });
    if (spellingAllowance !== Infinity) {
      let taken = 0;
      rows = rows.filter(card => {
        if (!isNew(card.id, 'spelling')) return true;
        if (taken >= spellingAllowance) return false;
        taken += 1;
        return true;
      });
    }
    return opts.limit ? rows.slice(0, opts.limit) : rows;
  }

  function spellingErrorList(limit = 20) {
    const tally = new Map();
    db.spelling.forEach(a => {
      const row = tally.get(a.cardId) || { cardId: a.cardId, wrong: 0, total: 0 };
      row.total += 1;
      if (!a.correct) row.wrong += 1;
      tally.set(a.cardId, row);
    });
    return [...tally.values()]
      .filter(r => r.wrong > 0)
      .map(r => ({ ...r, card: getCard(r.cardId) }))
      .filter(r => r.card)
      .sort((a, b) => b.wrong - a.wrong || b.total - a.total)
      .slice(0, limit);
  }

  function spellingAccuracy(days) {
    const cutoff = days ? daysAgo(days) : null;
    const rows = cutoff ? db.spelling.filter(a => a.at >= cutoff) : db.spelling;
    const total = rows.length;
    const correct = rows.filter(a => a.correct).length;
    return { total, correct, wrong: total - correct, accuracy: total ? correct / total : 0 };
  }

  // ---------------------------------------------------------- 主動輸出
  function addProduction(cardId, topic, prompt, sentence) {
    db.productions.push({
      id: db.productions.length + 1,
      cardId: Number(cardId), topic, prompt,
      sentence: String(sentence).trim(),
      at: Dates.nowISO(), feedback: ''
    });
    save();
  }

  function listProductions(limit) {
    const rows = db.productions.slice().reverse()
      .map(p => ({ ...p, card: getCard(p.cardId) }))
      .filter(p => p.card);
    return limit ? rows.slice(0, limit) : rows;
  }

  function setProductionFeedback(id, feedback) {
    const row = db.productions.find(p => p.id === Number(id));
    if (row) { row.feedback = String(feedback || ''); save(); }
  }

  // active 卡片中，造句次數最少、最久沒用的優先。
  function productionCandidates(opts = {}) {
    const used = new Map();
    db.productions.forEach(p => used.set(p.cardId, (used.get(p.cardId) || 0) + 1));
    let rows = db.cards.filter(c => c.cardType === 'active');
    if (opts.topic) rows = rows.filter(topicMatcher(opts.topic));
    shuffle(rows);
    rows.sort((a, b) => (used.get(a.id) || 0) - (used.get(b.id) || 0));
    return opts.limit ? rows.slice(0, opts.limit) : rows;
  }

  // 認讀已經穩、失誤不多的字才夠格升級成 active。
  function promotionCandidates(opts = {}) {
    const minReviews = opts.minReviews === undefined ? 3 : opts.minReviews;
    let rows = db.cards.filter(c => {
      if (c.cardType !== 'passive' || !c.example) return false;
      return getSrs(c.id, 'recall').reviews >= minReviews;
    });
    if (opts.topic) rows = rows.filter(topicMatcher(opts.topic));
    rows.sort((a, b) => {
      const sa = getSrs(a.id, 'recall'), sb = getSrs(b.id, 'recall');
      return (sb.interval - sb.lapses * 2) - (sa.interval - sa.lapses * 2);
    });
    return opts.limit ? rows.slice(0, opts.limit) : rows;
  }

  // ---------------------------------------------------------- 統計
  function coverage(field) {
    const groups = new Map();
    db.cards.forEach(c => {
      const name = (c[field] || '').trim() || '(未分類)';
      const row = groups.get(name) || { name, total: 0, started: 0, mature: 0, active: 0 };
      const s = getSrs(c.id, 'recall');
      row.total += 1;
      if (s.reviews > 0) row.started += 1;
      if (s.interval >= 21) row.mature += 1;
      if (c.cardType === 'active') row.active += 1;
      groups.set(name, row);
    });
    return [...groups.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  }

  function cardTypeCounts() {
    return {
      passive: db.cards.filter(c => c.cardType === 'passive').length,
      active: db.cards.filter(c => c.cardType === 'active').length
    };
  }

  const incompleteCount = () => db.cards.filter(isIncomplete).length;
  const cardCount = () => db.cards.length;

  // 有學習活動的日期（複習 / 拼字 / 造句都算）
  function activityDays() {
    const days = new Set();
    db.reviewLog.forEach(r => days.add(r.at.slice(0, 10)));
    db.spelling.forEach(a => days.add(a.at.slice(0, 10)));
    db.productions.forEach(p => days.add(p.at.slice(0, 10)));
    return days;
  }

  function streak() {
    const days = activityDays();
    if (!days.size) return 0;
    let cursor = today();
    if (!days.has(cursor)) {
      cursor = Dates.addDays(cursor, -1);
      if (!days.has(cursor)) return 0;
    }
    let n = 0;
    while (days.has(cursor)) { n += 1; cursor = Dates.addDays(cursor, -1); }
    return n;
  }

  function longestStreak() {
    const days = [...activityDays()].sort();
    if (!days.length) return 0;
    let best = 1, run = 1;
    for (let i = 1; i < days.length; i++) {
      run = Dates.diffDays(days[i], days[i - 1]) === 1 ? run + 1 : 1;
      best = Math.max(best, run);
    }
    return best;
  }

  const reviewsSince = since => db.reviewLog.filter(r => r.at.slice(0, 10) >= since).length;
  const reviewsOn = day => db.reviewLog.filter(r => r.at.slice(0, 10) === day).length;
  const productionsSince = since => db.productions.filter(p => p.at.slice(0, 10) >= since).length;
  const cardsAddedSince = since => db.cards.filter(c => (c.createdAt || '').slice(0, 10) >= since).length;
  const distinctWordsUsed = () => new Set(db.productions.map(p => p.cardId)).size;

  // 自 since 起第一次被複習的卡片數 —— 這才是真正的「本週新學」。
  function newCardsLearned(since) {
    const first = new Map();
    db.reviewLog.forEach(r => {
      if (!first.has(r.cardId) || r.at < first.get(r.cardId)) first.set(r.cardId, r.at);
    });
    return [...first.values()].filter(at => at.slice(0, 10) >= since).length;
  }

  function ratingBreakdown(since) {
    const out = { 1: 0, 2: 0, 3: 0, 4: 0 };
    db.reviewLog.forEach(r => {
      if (since && r.at.slice(0, 10) < since) return;
      if (out[r.rating] !== undefined) out[r.rating] += 1;
    });
    return out;
  }

  // ---------------------------------------------------------- CSV
  // 逐字元解析，處理引號內的逗號與換行（Excel 匯出的檔案很常見）。
  function parseCSV(text) {
    const rows = [];
    let row = [], field = '', inQuotes = false;
    const src = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (inQuotes) {
        if (ch === '"') {
          if (src[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === ',' || ch === '\t') { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += ch;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.some(c => String(c).trim()));
  }

  const CSV_COLUMNS = ['word', 'pos', 'example_sentence', 'collocations', 'root_analysis',
    'synonyms', 'category', 'topic', 'card_type', 'zh_hint', 'notes'];

  const HEADER_ALIASES = {
    vocab: 'word', vocabulary: 'word', term: 'word', 單字: 'word',
    part_of_speech: 'pos', partofspeech: 'pos', 詞性: 'pos',
    example: 'example_sentence', sentence: 'example_sentence', 例句: 'example_sentence',
    collocation: 'collocations', 搭配詞: 'collocations', 搭配: 'collocations',
    root: 'root_analysis', roots: 'root_analysis', etymology: 'root_analysis', 字根: 'root_analysis',
    synonym: 'synonyms', 同義詞: 'synonyms',
    類別: 'category', 分類: 'category', 主題: 'topic', 話題: 'topic',
    type: 'card_type', cardtype: 'card_type',
    chinese: 'zh_hint', zh: 'zh_hint', meaning: 'zh_hint', translation: 'zh_hint', 中文: 'zh_hint',
    chinese_meaning: 'zh_hint', chinesemeaning: 'zh_hint', 中文意思: 'zh_hint', 中文解釋: 'zh_hint',
    note: 'notes', 備註: 'notes'
  };

  function normaliseHeader(name) {
    const key = String(name || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (CSV_COLUMNS.includes(key)) return key;
    return HEADER_ALIASES[key] || HEADER_ALIASES[key.replace(/_/g, '')] || key;
  }

  const CSV_TO_CARD = {
    word: 'word', pos: 'pos', example_sentence: 'example', collocations: 'collocations',
    root_analysis: 'root', synonyms: 'synonyms', category: 'category', topic: 'topic',
    card_type: 'cardType', zh_hint: 'zh', notes: 'notes'
  };

  function importCSV(text, opts = {}) {
    const rows = parseCSV(text);
    const result = { added: 0, updated: 0, skipped: 0, incomplete: 0, errors: [] };
    if (!rows.length) { result.errors.push('檔案是空的'); return result; }
    const headers = rows[0].map(normaliseHeader);
    if (!headers.includes('word')) {
      result.errors.push('找不到 word 欄位（第一列要是欄位名稱）');
      return result;
    }
    rows.slice(1).forEach((cells, idx) => {
      const raw = {};
      headers.forEach((h, i) => { raw[h] = (cells[i] || '').trim(); });
      if (!raw.word) { result.skipped += 1; result.errors.push(`第 ${idx + 2} 行：缺少 word，已略過`); return; }
      const input = {};
      Object.keys(CSV_TO_CARD).forEach(k => { if (raw[k] !== undefined) input[CSV_TO_CARD[k]] = raw[k]; });
      try {
        const existing = findCard(input.word, input.pos || '');
        if (!existing) {
          const card = addCard(input);
          result.added += 1;
          if (isIncomplete(card)) result.incomplete += 1;
        } else if (opts.update) {
          const fields = {};
          Object.keys(input).forEach(k => { if (String(input[k] || '').trim()) fields[k] = input[k]; });
          updateCard(existing.id, fields);
          result.updated += 1;
          if (isIncomplete(existing)) result.incomplete += 1;
        } else {
          result.skipped += 1;
        }
      } catch (e) {
        result.skipped += 1;
        result.errors.push(`第 ${idx + 2} 行：${e.message}`);
      }
    });
    save();
    return result;
  }

  const csvCell = v => {
    const s = Array.isArray(v) ? v.join('; ') : String(v || '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  function exportCSV() {
    const lines = [CSV_COLUMNS.join(',')];
    db.cards.forEach(c => {
      // 例句中譯是網頁版才有的欄位，匯出時併進 notes，搬到 CLI 也不會遺失。
      const notes = [c.notes, c.exampleZh ? `例句中譯：${c.exampleZh}` : ''].filter(Boolean).join(' ｜ ');
      lines.push([c.word, c.pos, c.example, c.collocations, c.root, c.synonyms,
        c.category, c.topic, c.cardType, c.zh, notes].map(csvCell).join(','));
    });
    return '﻿' + lines.join('\n');
  }

  function exportProductionsMarkdown() {
    const rows = listProductions();
    const out = [
      '# IELTS 造句紀錄', '',
      `匯出時間：${today()}　共 ${rows.length} 句`, '',
      '> 請幫我批改以下句子：文法、搭配詞是否自然、是否符合雅思學術語域，並針對每句給一個改寫版本。', ''
    ];
    rows.forEach(p => {
      out.push(`## ${p.card.word}`);
      if (p.topic) out.push(`- 主題：${p.topic}`);
      if (p.prompt) out.push(`- 題目：${p.prompt}`);
      out.push(`- 我的句子：${p.sentence}`);
      if (p.feedback) out.push(`- 既有回饋：${p.feedback}`);
      out.push('');
    });
    return out.join('\n');
  }

  // ---------------------------------------------------------- 初始化
  // 舊版的 100 個單字只有中文與例句，沒有字根與同義詞 ——
  // 匯入後會自動變成 incomplete，正好給補完模式處理，資料不會白白丟掉。
  // -ize / -ise 兩種拼法視為同一個字（analyze ↔ analyse）
  //: 美式／英式拼法對得上同一張卡，免得 analyze 和 analyse 變成兩張。
  //  -ize/-yze 對 -ise/-yse，-or 對 -our，-er 對 -re，兩個方向都試。
  function spellingVariants(word) {
    const w = String(word);
    const rules = [
      [/yze\b/i, 'yse'], [/yse\b/i, 'yze'],
      [/ize\b/i, 'ise'], [/ise\b/i, 'ize'],
      [/izing\b/i, 'ising'], [/ising\b/i, 'izing'],
      [/isation\b/i, 'ization'], [/ization\b/i, 'isation'],
      [/our\b/i, 'or'], [/or\b/i, 'our'],
      [/re\b/i, 'er'], [/er\b/i, 're'],
      [/ll/i, 'l'], [/^(.*[aeiou])l(ed|ing)\b/i, '$1ll$2']
    ];
    const out = new Set();
    rules.forEach(([re, to]) => {
      const v = w.replace(re, to);
      if (v !== w) out.add(v);
    });
    return [...out];
  }

  function findLoosely(word) {
    const direct = findByWord(word);
    if (direct) return direct;
    for (const variant of spellingVariants(word)) {
      const hit = findByWord(variant);
      if (hit) return hit;
    }
    return null;
  }

  function importLegacyWords() {
    if (typeof LEGACY_VOCABULARY === 'undefined') return { added: 0, merged: 0 };
    let added = 0, merged = 0;
    LEGACY_VOCABULARY.forEach(w => {
      const existing = findLoosely(w.en);
      if (existing) {
        // AWL 只帶了字頭進來，舊資料剛好有例句與搭配詞 —— 補進去，不要浪費
        const fill = {};
        if (!existing.example && w.example) fill.example = String(w.example).replace(/[{}]/g, '');
        if (!existing.collocations.length && (w.collocations || []).length) fill.collocations = w.collocations;
        if (!existing.root && w.root) fill.root = w.root;
        if (!existing.synonyms.length && (w.synonyms || []).length) fill.synonyms = w.synonyms;
        if (!existing.zh && w.zh) fill.zh = w.zh;
        if (!existing.phonetic && w.phonetic) fill.phonetic = w.phonetic;
        if (!existing.exampleZh && w.exampleZh) fill.exampleZh = w.exampleZh;
        if (Object.keys(fill).length) {
          updateCard(existing.id, fill);
          merged += 1;
        }
        return;
      }
      added += 1;
      addCard({
        word: w.en,
        pos: '',
        example: String(w.example || '').replace(/[{}]/g, ''),
        collocations: w.collocations || [],
        root: w.root || '',
        synonyms: w.synonyms || [],
        category: w.topic === 'AWL' ? 'AWL' : '高頻話題字',
        topic: LEGACY_TOPIC_MAP[w.topic] || w.topic || '',
        cardType: 'passive',
        zh: w.zh || '',
        exampleZh: w.exampleZh || '',
        phonetic: w.phonetic || '',
        notes: ''
      });
    });
    return { added, merged };
  }

  // 舊版已經學過的字不該從零開始，把進度換算成認讀軌的起點。
  function migrateLegacyProgress() {
    let migrated = 0;
    try {
      const old = JSON.parse(localStorage.getItem(LEGACY_KEY) || '{}');
      const vocab = old.vocab || {};
      Object.keys(vocab).forEach(word => {
        const card = findLoosely(word);
        if (!card) return;
        const status = vocab[word].status;
        const s = getSrs(card.id, 'recall');
        if (s.reviews > 0) return;
        if (status === 'known') {
          db.srs[srsKey(card.id, 'recall')] = {
            interval: 6, ease: SRS.DEFAULT_EASE, due: Dates.addDays(today(), 6),
            reviews: 2, lapses: 0, lastReviewed: null
          };
          migrated += 1;
        } else if (status === 'learning') {
          db.srs[srsKey(card.id, 'recall')] = {
            interval: 1, ease: SRS.DEFAULT_EASE, due: Dates.addDays(today(), 1),
            reviews: 1, lapses: 1, lastReviewed: null
          };
          migrated += 1;
        }
      });
    } catch (e) {
      console.warn('[store] 舊進度轉換失敗，略過', e);
    }
    return migrated;
  }

  function init() {
    load();
    if (!db.seeded) {
      SEED_CARDS.forEach(c => { if (!findByWord(c.word)) addCard(c); });
      const legacy = importLegacyWords();
      const migrated = migrateLegacyProgress();
      db.seeded = true;
      save();
      console.log(`[store] 初始化：種子 ${SEED_CARDS.length} 字、舊資料新增 ${legacy.added} 字`
        + `、補進既有卡片 ${legacy.merged} 字、轉換進度 ${migrated} 筆`);
    }
    db.cards.forEach(c => ensureSrs(c.id));
    return db;
  }

  function resetAll() {
    localStorage.removeItem(KEY);
    db = emptyDb();
  }

  return {
    TRACKS, TRACK_LABELS, CORE_FIELDS, CORE_LABELS, CSV_COLUMNS, NEW_PER_DAY,
    newIntroducedToday,
    init, save, resetAll, today, daysAgo,
    addCard, updateCard, getCard, findCard, findByWord, listCards, setCardType,
    missingCore, isIncomplete, cardLabel, cardCount, incompleteCount, completionQueue,
    getSrs, grade, dueItems, dueCount,
    recordSpelling, spellingQueue, spellingErrorList, spellingAccuracy, lastSpellingResult,
    hasSpellingClue, getPrefs, setPrefs, showZh, findLoosely,
    addProduction, listProductions, setProductionFeedback, productionCandidates, promotionCandidates,
    coverage, cardTypeCounts, activityDays, streak, longestStreak,
    reviewsSince, reviewsOn, productionsSince, cardsAddedSince, distinctWordsUsed,
    newCardsLearned, ratingBreakdown,
    importCSV, exportCSV, exportProductionsMarkdown, parseCSV, normaliseHeader
  };
})();
