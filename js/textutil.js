// 文字處理：挖空例句、拼字比對、同義詞寬鬆比對。
// 與 cli/ielts/textutil.py 同一套規則。
const TextUtil = (() => {
  const MASK = '______';

  // 片語裡不值得挖空的功能詞
  const STOPWORDS = new Set([
    'a', 'an', 'the', 'of', 'to', 'in', 'on', 'its', 'it', 'and', 'or', 'for',
    'at', 'with', 'be', 'is', 'are', 'was', 'were', 'as', 'by', 'from', 'that',
    'this', 'his', 'her', 'their', 'your', 'my', 'one'
  ]);

  const TOKEN_RE = /[A-Za-z][A-Za-z'\-]*/g;
  const VOWELS = 'aeiou';

  // 不規則動詞的過去式與過去分詞。規則式推不出這些形，但例句常用到，
  // 少了就會挖不到空。複合字（overtake → over + took）會自動沿用字尾的變化。
  const IRREGULAR = {
    arise: ['arose', 'arisen'], become: ['became', 'become'],
    begin: ['began', 'begun'], break: ['broke', 'broken'],
    bring: ['brought', 'brought'], build: ['built', 'built'],
    buy: ['bought', 'bought'], choose: ['chose', 'chosen'],
    come: ['came', 'come'], deal: ['dealt', 'dealt'],
    draw: ['drew', 'drawn'], drive: ['drove', 'driven'],
    fall: ['fell', 'fallen'], feel: ['felt', 'felt'],
    find: ['found', 'found'], get: ['got', 'gotten'],
    give: ['gave', 'given'], go: ['went', 'gone'],
    grow: ['grew', 'grown'], hold: ['held', 'held'],
    keep: ['kept', 'kept'], know: ['knew', 'known'],
    lead: ['led', 'led'], leave: ['left', 'left'],
    lose: ['lost', 'lost'], make: ['made', 'made'],
    mean: ['meant', 'meant'], meet: ['met', 'met'],
    pay: ['paid', 'paid'], rise: ['rose', 'risen'],
    run: ['ran', 'run'], see: ['saw', 'seen'],
    seek: ['sought', 'sought'], sell: ['sold', 'sold'],
    send: ['sent', 'sent'], speak: ['spoke', 'spoken'],
    spend: ['spent', 'spent'], stand: ['stood', 'stood'],
    strike: ['struck', 'struck'], take: ['took', 'taken'],
    teach: ['taught', 'taught'], tell: ['told', 'told'],
    think: ['thought', 'thought'], wear: ['wore', 'worn'],
    win: ['won', 'won'], withdraw: ['withdrew', 'withdrawn'],
    write: ['wrote', 'written']
  };

  const tokensOf = text => String(text || '').match(TOKEN_RE) || [];

  function normalise(text) {
    if (!text) return '';
    let v = String(text).normalize('NFKC').replace(/[‘’]/g, "'");
    v = v.replace(/\s+/g, ' ').trim();
    v = v.replace(/^[\s.,;:!?"'()\[\]{}…—-]+/, '').replace(/[\s.,;:!?"'()\[\]{}…—-]+$/, '');
    return v.toLowerCase();
  }

  const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // 產生一個字的常見變化形。刻意只用規則式，寧可漏挖也不要誤挖到不相干的字。
  function inflections(token) {
    const word = String(token || '').trim().toLowerCase();
    const forms = new Set();
    if (!word) return forms;
    [word, word + 's', word + 'es', word + 'ed', word + 'ing', word + 'ly'].forEach(f => forms.add(f));

    if (word.endsWith('e')) {
      const stem = word.slice(0, -1);
      ['ing', 'ed', 'es', 'ion', 'ation'].forEach(s => forms.add(stem + s));
    }
    if (word.endsWith('y') && word.length > 2 && !VOWELS.includes(word[word.length - 2])) {
      const stem = word.slice(0, -1);
      ['ies', 'ied', 'ier', 'iest'].forEach(s => forms.add(stem + s));
    }
    const last = word[word.length - 1], prev = word[word.length - 2], prev2 = word[word.length - 3];
    if (word.length >= 3 && !'aeiouwxy'.includes(last) && VOWELS.includes(prev) && !VOWELS.includes(prev2)) {
      // 重複字尾：plan → planned / planning；dip → dipped / dipping
      forms.add(word + last + 'ed');
      forms.add(word + last + 'ing');
    }
    if (word.endsWith('ate')) {
      const stem = word.slice(0, -1);
      ['ion', 'ions', 'ing', 'ed'].forEach(s => forms.add(stem + s));
    }
    if (word.endsWith('t')) forms.add(word + 'ion');

    // 不規則動詞（含 overtake / withdraw 這類複合字）
    for (const base of Object.keys(IRREGULAR)) {
      if (word === base || (word.endsWith(base) && word.length > base.length)) {
        const prefix = word.slice(0, word.length - base.length);
        IRREGULAR[base].forEach(f => forms.add(prefix + f));
        break;
      }
    }

    return new Set([...forms].filter(f => f.length >= 2));
  }

  // 要挖空的字：單字就是它本身；片語則挑掉功能詞後的實詞。
  function targetTokens(target) {
    const words = tokensOf(target);
    if (words.length <= 1) return words;
    const content = words.filter(w => !STOPWORDS.has(w.toLowerCase()) && w.length > 2);
    return content.length ? content : words;
  }

  function patternFor(target) {
    const forms = new Set();
    targetTokens(target).forEach(tok => inflections(tok).forEach(f => forms.add(f)));
    if (!forms.size) return null;
    const ordered = [...forms].sort((a, b) => b.length - a.length).map(escapeRe);
    return new RegExp(`\\b(?:${ordered.join('|')})\\b`, 'gi');
  }

  // 把例句中的目標字（含變化形）換成底線。回傳 { text, hits }。
  function maskSentence(sentence, target, mask = MASK) {
    if (!sentence || !target) return { text: sentence || '', hits: 0 };
    const re = patternFor(target);
    if (!re) return { text: sentence, hits: 0 };
    let hits = 0;
    const text = sentence.replace(re, () => { hits += 1; return mask; });
    return { text, hits };
  }

  const maskAll = (items, target, mask = MASK) =>
    (items || []).map(item => maskSentence(item, target, mask).text);

  // 複習模式用：把目標字標出來，不依賴顏色也看得到。
  function highlightTarget(sentence, target, open = '《', close = '》') {
    if (!sentence || !target) return sentence || '';
    const re = patternFor(target);
    if (!re) return sentence;
    return sentence.replace(re, m => `${open}${m}${close}`);
  }

  // 首字母與長度提示：mitigate → m _ _ _ _ _ _ _（8 個字母）
  function letterSkeleton(word) {
    const parts = [];
    let total = 0;
    String(word || '').split(/\s+/).forEach(chunk => {
      const letters = [...chunk].filter(c => /[A-Za-z]/.test(c));
      total += letters.length;
      if (!letters.length) { parts.push(chunk); return; }
      const shown = chunk[0] + ' ' + [...chunk.slice(1)].map(c => (/[A-Za-z]/.test(c) ? '_' : c)).join(' ');
      parts.push(shown);
    });
    const body = parts.join('   ');
    return total ? `${body}（${total} 個字母）` : body;
  }

  const spellingCorrect = (expected, actual) => normalise(expected) === normalise(actual);

  function editDistance(a, b) {
    a = normalise(a); b = normalise(b);
    if (a === b) return 0;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) {
        cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] !== b[j - 1] ? 1 : 0)));
      }
      prev = cur;
    }
    return prev[b.length];
  }

  // 用最長共同子序列標出差異，讓「錯在哪個字母」一眼看得到。
  function formatDiff(expected, actual) {
    const exp = String(expected || ''), act = String(actual || '');
    const a = exp.toLowerCase(), b = act.toLowerCase();
    const n = a.length, m = b.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const expParts = [], actParts = [];
    let i = 0, j = 0, expBuf = '', actBuf = '';
    const flush = () => {
      if (expBuf) { expParts.push(`【${expBuf}】`); expBuf = ''; }
      if (actBuf) { actParts.push(`【${actBuf}】`); actBuf = ''; }
    };
    while (i < n && j < m) {
      if (a[i] === b[j]) { flush(); expParts.push(exp[i]); actParts.push(act[j]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { expBuf += exp[i]; i++; }
      else { actBuf += act[j]; j++; }
    }
    while (i < n) { expBuf += exp[i]; i++; }
    while (j < m) { actBuf += act[j]; j++; }
    flush();
    return { expected: expParts.join(''), actual: actParts.join('') };
  }

  // 極簡詞幹化，只為了讓同義詞比對寬鬆一點（reduce / reducing 算同一個）。
  function simpleStem(word) {
    let w = normalise(word);
    for (const suffix of ['ing', 'edly', 'ed', 'es', 's', 'ly']) {
      if (w.length > suffix.length + 3 && w.endsWith(suffix)) { w = w.slice(0, -suffix.length); break; }
    }
    if (w.endsWith('e') && w.length > 4) w = w.slice(0, -1);
    return w;
  }

  // 使用者可能用逗號、頓號、分號或空白分隔答案。
  function splitAnswers(raw) {
    if (!raw) return [];
    let parts = String(raw).split(/[,，、;；/]|\s{2,}/);
    if (parts.length === 1) parts = String(raw).split(/\s+/);
    return parts.map(p => p.trim()).filter(Boolean);
  }

  // 回傳 { matched: [{input, answer}], missed: [], extras: [] }
  function matchSynonyms(answers, expected) {
    const remaining = [...(expected || [])];
    const matched = [], extras = [];
    (answers || []).forEach(raw => {
      const answer = normalise(raw);
      if (!answer) return;
      let idx = remaining.findIndex(c => normalise(c) === answer);
      if (idx < 0) {
        const stem = simpleStem(raw);
        if (stem) idx = remaining.findIndex(c => simpleStem(c) === stem);
      }
      if (idx < 0) extras.push(String(raw).trim());
      else matched.push({ input: String(raw).trim(), answer: remaining.splice(idx, 1)[0] });
    });
    return { matched, missed: remaining, extras };
  }

  return {
    MASK, normalise, inflections, targetTokens, maskSentence, maskAll,
    highlightTarget, letterSkeleton, spellingCorrect, editDistance,
    formatDiff, simpleStem, splitAnswers, matchSynonyms, tokensOf
  };
})();
