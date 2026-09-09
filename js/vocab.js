// 單字模組的介面層：五種學習模式 + 升級 / 匯入匯出 / 卡片清單。
// 只呼叫 Store 與 TextUtil，不自己碰 localStorage。
const Vocab = (() => {
  let topicFilter = '';
  let session = null;   // 進行中的練習

  // ---------------------------------------------------------- 小工具
  const el = id => document.getElementById(id);
  const esc = s => String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const home = () => el('vocab-home');
  const stage = () => el('vocab-stage');

  function showHome() {
    session = null;
    Speech.stop();   // 念到一半就退出模式時，別讓聲音繼續
    stage().innerHTML = '';
    stage().style.display = 'none';
    home().style.display = '';
    renderHome();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function showStage(html) {
    home().style.display = 'none';
    stage().style.display = '';
    stage().innerHTML = html;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // 每答一題就同步一次連續學習紀錄與活動熱圖（沿用原本的機制）
  function logStudy() {
    if (typeof markStudiedToday === 'function') markStudiedToday();
    if (typeof logActivity === 'function') logActivity('vocab');
  }

  const filterOpts = extra => ({ topic: topicFilter || undefined, ...extra });

  function modeHeader(title, progress) {
    return `<div class="mode-bar">
      <button class="back-btn" onclick="Vocab.showHome()">回單字首頁</button>
      <div class="mode-title">${esc(title)}</div>
      <div class="mode-progress">${esc(progress || '')}</div>
    </div>`;
  }

  function emptyState(message, hint) {
    return `<div class="card center-card">
      <div class="big-emoji">🎉</div>
      <div class="empty-title">${esc(message)}</div>
      ${hint ? `<div class="empty-hint">${esc(hint)}</div>` : ''}
      <button class="btn btn-primary" onclick="Vocab.showHome()">回單字首頁</button>
    </div>`;
  }

  // ---------------------------------------------------------- 首頁
  function renderHome() {
    const t = Store.today();
    const dueRecall = Store.dueCount('recall', filterOpts({ cardType: 'passive', requireContent: true }));
    const dueSpell = Store.spellingQueue(filterOpts({})).length;
    const dueSyn = Store.dueItems('synonym', filterOpts({ requireSynonyms: true })).length;
    const wrongList = Store.spellingQueue({ onlyWrong: true }).length;
    const types = Store.cardTypeCounts();
    const incomplete = Store.incompleteCount();

    // 篩選順序：全部 → 七個雅思話題 → Task 1 / 口說的功能分組 → AWL Sublist 1..10
    const TOPIC_ORDER = ['環境', '教育', '科技', '健康', '都市化', '犯罪', '媒體'];
    const rank = name => {
      const idx = TOPIC_ORDER.indexOf(name);
      if (idx >= 0) return [0, idx, name];
      const sublist = /^Sublist (\d+)$/.exec(name);
      if (sublist) return [2, Number(sublist[1]), name];
      return [1, 0, name];
    };
    const names = Store.coverage('topic').map(r => r.name).filter(n => n !== '(未分類)');
    names.sort((a, b) => {
      const ra = rank(a), rb = rank(b);
      return ra[0] - rb[0] || ra[1] - rb[1] || ra[2].localeCompare(rb[2]);
    });
    const topics = ['', ...names];
    const topicBtns = topics.map(name => {
      const active = (topicFilter === name) ? ' active' : '';
      const label = name === '' ? '全部' : name;
      return `<button class="topic-btn${active}" data-topic="${esc(name || 'all')}"
        onclick="Vocab.setTopic('${esc(name)}')">${esc(label)}</button>`;
    }).join('');

    const modeCard = (icon, title, desc, due, onclick, disabled) => `
      <button class="mode-card${disabled ? ' disabled' : ''}" ${disabled ? 'disabled' : `onclick="${onclick}"`}>
        <span class="mode-icon">${icon}</span>
        <span class="mode-text">
          <span class="mode-name">${esc(title)}</span>
          <span class="mode-desc">${esc(desc)}</span>
        </span>
        ${due !== null ? `<span class="mode-badge${due > 0 ? ' hot' : ''}">${due}</span>` : ''}
      </button>`;

    home().innerHTML = `
      <div class="today-card">
        <div class="today-head">今天要練的量　<span class="today-date">${esc(t)}</span></div>
        <div class="today-nums">
          <div class="today-num"><b>${dueRecall}</b><span>認讀</span></div>
          <div class="today-num"><b>${dueSpell}</b><span>拼字</span></div>
          <div class="today-num"><b>${dueSyn}</b><span>同義詞</span></div>
          <div class="today-num"><b>${types.active}</b><span>主動字</span></div>
        </div>
      </div>

      <div class="topic-filter">${topicBtns}</div>

      <div class="mode-list">
        ${modeCard('🚇', '通勤複習', '看單字 → 翻例句 → 評分，一路按到底', dueRecall, 'Vocab.startReview()')}
        ${modeCard('✍️', '拼字練習', '例句挖空 + 中文提示，打出完整拼字', dueSpell, 'Vocab.startSpell()')}
        ${modeCard('🔁', '同義詞測驗', '列出 2 個以上同義詞，練同義替換', dueSyn, 'Vocab.startSyn()')}
        ${modeCard('🗣️', '主動輸出', '用 active 字 + 雅思話題造句', types.active, 'Vocab.startProduce()')}
        ${modeCard('🧩', '寫例句', '搭配／字根／同義詞都備好了，例句自己寫', incomplete, 'Vocab.startComplete()')}
      </div>

      ${wrongList > 0 ? `<button class="btn btn-error wide-btn" onclick="Vocab.startSpell(true)">
        只練今天拼錯的 ${wrongList} 個字</button>` : ''}

      <div class="tool-row">
        <button class="tool-btn" onclick="Vocab.showPromote()">⬆ 升級 active</button>
        <button class="tool-btn" onclick="Vocab.showLibrary()">📇 卡片清單</button>
        <button class="tool-btn" onclick="Vocab.showTools()">📥 匯入匯出</button>
      </div>`;
  }

  function setTopic(name) {
    topicFilter = name || '';
    renderHome();
  }

  /** 在設定裡切換顯示偏好之後，讓眼前這一頁立刻跟著變。 */
  function refresh() {
    if (!session) { renderHome(); return; }
    // 只重畫「重畫了不會弄丟作答狀態」的畫面，其餘等下一題自然套用
    if (session.mode === 'review') renderReview();
    else if (session.mode === 'spell' && session.phase === 'ask') renderSpell();
  }

  // ---------------------------------------------------------- 卡片標題
  // 單字 + 喇叭 + 音標 / 詞性 / 分類，五個模式共用同一個寫法。
  function wordHead(card) {
    const meta = [card.phonetic, card.pos, card.category, card.topic].filter(Boolean).join(' · ');
    return `<div class="word-line"><span class="card-word">${esc(card.word)}</span>${Speech.button(card.word)}</div>
      ${meta ? `<div class="card-meta">${esc(meta)}</div>` : ''}`;
  }

  // ---------------------------------------------------------- 卡片背面
  // 順序固定：例句 → 搭配詞 → 字根 → 同義詞 →（筆記）→ 中文意思。
  // 中文永遠排最後而且是小字，因為它只是「校對用」，不是記憶點 ——
  // 先從英文語境理解，看完四個維度之後才用中文確認自己有沒有想歪。
  // Store.showZh() 關掉之後整張卡完全沒有中文（純英文思考模式）。
  function backLines(card) {
    const rows = [];
    if (card.example) {
      rows.push(['例句', esc(TextUtil.highlightTarget(card.example, card.word)) + Speech.button(card.example), '']);
    }
    if (card.collocations.length) rows.push(['搭配', esc(card.collocations.join(' · ')), '']);
    if (card.root) rows.push(['字根', esc(card.root), '']);
    if (card.synonyms.length) rows.push(['同義', esc(card.synonyms.join(' / ')), '']);
    if (card.notes) rows.push(['筆記', esc(card.notes), '']);
    if (Store.showZh() && card.zh) rows.push(['中文', esc(card.zh), ' zh-row']);
    // 句譯只跟著上面那一句例句走。沒顯示例句就不顯示句譯 ——
    // 翻譯配錯句子比沒有翻譯更糟，會把錯的語意記進去。
    if (Store.showZh() && card.example && card.exampleZh) {
      rows.push(['句譯', esc(card.exampleZh), ' zh-row']);
    }
    if (!rows.length) rows.push(['', '這張卡還沒有內容，用「補完卡片」補上', '']);
    return rows.map(([k, v, cls]) =>
      `<div class="dim-row${cls}"><span class="dim-key">${k}</span><span class="dim-val">${v}</span></div>`).join('');
  }

  // ---------------------------------------------------------- 模式 A：通勤複習
  function startReview() {
    const items = Store.dueItems('recall', filterOpts({
      cardType: 'passive', requireContent: true, preferComplete: true, limit: 40
    }));
    if (!items.length) {
      showStage(modeHeader('通勤複習') + emptyState('今天沒有到期的卡片了', '過幾小時或明天再回來，排程會自己安排。'));
      return;
    }
    session = { mode: 'review', items, index: 0, done: 0, again: 0, revealed: false };
    renderReview();
  }

  function renderReview() {
    const s = session;
    if (s.index >= s.items.length) return finishReview();
    const card = s.items[s.index];
    showStage(modeHeader('通勤複習', `${s.index + 1} / ${s.items.length}`) + `
      <div class="card study-card">
        ${wordHead(card)}
        ${s.revealed ? `<div class="dim-box">${backLines(card)}</div>` : ''}
        ${s.revealed && !card.example ? `<div class="missing-tag">
          這張還沒有你自己的例句　·　回首頁的「✍️ 寫例句」補一句，會更好記</div>` : ''}
      </div>
      ${s.revealed ? `
        <div class="rating-grid">
          <button class="btn rate-1" onclick="Vocab.rate(1)">Again<span>忘了</span></button>
          <button class="btn rate-2" onclick="Vocab.rate(2)">Hard<span>吃力</span></button>
          <button class="btn rate-3" onclick="Vocab.rate(3)">Good<span>想得起來</span></button>
          <button class="btn rate-4" onclick="Vocab.rate(4)">Easy<span>太簡單</span></button>
        </div>
        <div class="key-hint">鍵盤：1 / 2 / 3 / 4　·　p 念一次</div>`
      : `
        <button class="btn btn-primary wide-btn" onclick="Vocab.reveal()">看例句與同義詞</button>
        <button class="btn btn-secondary wide-btn" onclick="Vocab.skip()">跳過這張</button>
        <div class="key-hint">鍵盤：空白鍵翻面　·　p 念一次</div>`}`);
  }

  function reveal() {
    if (!session || session.mode !== 'review') return;
    const card = session.items[session.index];
    session.revealed = true;
    renderReview();
    // 翻面才念，而且只在使用者打開「自動念例句」時。
    // 這裡是點擊／按鍵之後才跑的，所以 iOS 的「語音必須由使用者動作觸發」也滿足。
    Speech.autoSay(card.example || card.word);
  }

  function skip() {
    if (!session) return;
    session.index += 1;
    session.revealed = false;
    renderReview();
  }

  function rate(rating) {
    if (!session || session.mode !== 'review' || !session.revealed) return;
    const card = session.items[session.index];
    Store.grade(card.id, 'recall', rating);
    logStudy();
    session.done += 1;
    if (rating === SRS.AGAIN) session.again += 1;
    session.index += 1;
    session.revealed = false;
    renderReview();
  }

  function finishReview() {
    const s = session;
    showStage(modeHeader('通勤複習') + `
      <div class="card center-card">
        <div class="big-emoji">✅</div>
        <div class="empty-title">複習 ${s.done} 張</div>
        <div class="empty-hint">${s.again ? `其中 ${s.again} 張忘記了，明天會再出現。` : '全部都想得起來，狀態不錯。'}</div>
        <button class="btn btn-primary" onclick="Vocab.startReview()">再來一輪</button>
        <button class="btn btn-secondary" onclick="Vocab.showHome()">回單字首頁</button>
      </div>`);
    session = null;
  }

  // ---------------------------------------------------------- 模式 B：拼字練習
  function startSpell(onlyWrong) {
    const items = Store.spellingQueue(filterOpts({ onlyWrong: !!onlyWrong, limit: 25 }));
    if (!items.length) {
      showStage(modeHeader('拼字練習') + emptyState(
        onlyWrong ? '錯誤清單是空的' : '今天沒有到期的拼字練習了',
        onlyWrong ? '拼字目前沒有欠帳。' : ''));
      return;
    }
    session = { mode: 'spell', items, index: 0, correct: 0, wrong: 0, phase: 'ask', hinted: false };
    renderSpell();
  }

  function renderSpell(feedback) {
    const s = session;
    if (s.index >= s.items.length) return finishSpell();
    const card = s.items[s.index];
    // 自己寫的例句優先；還沒寫的用參考例句頂著，兩者都會挖空
    const sentence = Store.spellingSentence(card);
    const masked = TextUtil.maskSentence(sentence, card.word);
    const rows = [];
    const sentenceZh = Store.spellingSentenceZh(card);
    if (sentence && masked.hits) rows.push(['例句', esc(masked.text)]);
    else if (sentence) rows.push(['例句', '（例句直接含目標字，先不顯示）']);
    // 句譯不會洩漏拼法，但能補上挖空之後失去的語境
    if (Store.showZh() && sentence && masked.hits && sentenceZh) {
      rows.push(['句譯', esc(sentenceZh)]);
    }
    if (Store.showZh() && card.zh) rows.push(['中文', esc(card.zh)]);
    if (card.pos) rows.push(['詞性', esc(card.pos)]);
    if (card.collocations.length) rows.push(['搭配', esc(TextUtil.maskAll(card.collocations, card.word).join(' · '))]);
    if (card.root) rows.push(['字根', esc(TextUtil.maskSentence(card.root, card.word).text)]);
    // AWL 字頭卡還沒補完時，英文定義就是唯一的線索（一樣要遮掉目標字）
    if (!card.example && card.notes) rows.push(['定義', esc(TextUtil.maskSentence(card.notes, card.word).text)]);
    if (s.hinted) rows.push(['提示', esc(TextUtil.letterSkeleton(card.word))]);

    showStage(modeHeader('拼字練習', `${s.index + 1} / ${s.items.length}`) + `
      <div class="card study-card">
        <div class="dim-box">
          ${rows.map(([k, v]) => `<div class="dim-row"><span class="dim-key">${k}</span><span class="dim-val">${v}</span></div>`).join('')}
        </div>
      </div>
      ${feedback || ''}
      ${s.phase === 'ask' ? `
        <input class="spell-input" id="spell-input" type="text" autocomplete="off"
          autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="打出完整拼字">
        <button class="btn btn-primary wide-btn" onclick="Vocab.submitSpell()">送出</button>
        <div class="sub-actions">
          <button class="tool-btn" onclick="Vocab.spellHint()">看提示</button>
          ${Speech.supported() ? `<button class="tool-btn" onclick="Vocab.spellSay()">🔊 聽發音</button>` : ''}
          <button class="tool-btn" onclick="Vocab.spellSkip()">跳過</button>
        </div>`
      : `<button class="btn btn-primary wide-btn" onclick="Vocab.nextSpell()">下一題</button>`}`);

    const input = el('spell-input');
    if (input) {
      input.focus();
      input.addEventListener('keydown', e => { if (e.key === 'Enter') submitSpell(); });
    }
  }

  function spellHint() {
    if (!session || session.phase !== 'ask') return;
    session.hinted = true;
    renderSpell();
  }

  // 聽寫：雅思聽力本來就是「聽到什麼就要拼出什麼」，所以這顆按鈕不算作弊，
  // 但也不自動播 —— 要不要先聽由你決定。
  function spellSay() {
    if (!session || session.mode !== 'spell') return;
    Speech.say(session.items[session.index].word);
  }

  function spellSkip() {
    if (!session) return;
    session.index += 1;
    session.phase = 'ask';
    session.hinted = false;
    renderSpell();
  }

  function submitSpell() {
    const s = session;
    if (!s || s.phase !== 'ask') return;
    const input = el('spell-input');
    const answer = (input ? input.value : '').trim();
    if (!answer) return;
    const card = s.items[s.index];
    const correct = TextUtil.spellingCorrect(card.word, answer);
    Store.recordSpelling(card.id, answer, correct);
    logStudy();

    let feedback;
    if (correct) {
      s.correct += 1;
      const state = Store.grade(card.id, 'spelling', SRS.GOOD);
      feedback = `<div class="feedback ok">
        <div class="feedback-title">✓ 正確</div>
        <div class="feedback-body">${esc(card.word)}${Speech.button(card.word)}　${esc(SRS.describeNext(state, Store.today()))}</div>
      </div>`;
    } else {
      s.wrong += 1;
      Store.grade(card.id, 'spelling', SRS.AGAIN);
      const diff = TextUtil.formatDiff(card.word, answer);
      const distance = TextUtil.editDistance(card.word, answer);
      feedback = `<div class="feedback bad">
        <div class="feedback-title">✗ 拼錯了</div>
        <div class="feedback-body">
          <div>你打的：<span class="diff-bad">${esc(diff.actual)}</span></div>
          <div>正確的：<span class="diff-ok">${esc(diff.expected)}</span>${Speech.button(card.word)}</div>
          ${distance === 1 ? '<div class="feedback-note">只差 1 個字母 —— 這種最值得記下來。</div>' : ''}
          <div class="feedback-note">已加入錯誤清單，明天優先出現。</div>
        </div>
      </div>`;
    }
    s.phase = 'result';
    renderSpell(feedback);
  }

  function nextSpell() {
    session.index += 1;
    session.phase = 'ask';
    session.hinted = false;
    renderSpell();
  }

  function finishSpell() {
    const s = session;
    const total = s.correct + s.wrong;
    const pct = total ? Math.round(s.correct / total * 100) : 0;
    showStage(modeHeader('拼字練習') + `
      <div class="card center-card">
        <div class="big-emoji">${pct >= 80 ? '🎯' : '📝'}</div>
        <div class="empty-title">對 ${s.correct} ／ 錯 ${s.wrong}　正確率 ${pct}%</div>
        ${s.wrong ? '<div class="empty-hint">錯的字已進錯誤清單，回首頁可以馬上再練一輪。</div>' : ''}
        ${s.wrong ? '<button class="btn btn-error" onclick="Vocab.startSpell(true)">立刻重練錯的字</button>' : ''}
        <button class="btn btn-secondary" onclick="Vocab.showHome()">回單字首頁</button>
      </div>`);
    session = null;
  }

  // ---------------------------------------------------------- 同義詞測驗
  function startSyn() {
    const items = Store.dueItems('synonym', filterOpts({ requireSynonyms: true, limit: 20 }));
    if (!items.length) {
      showStage(modeHeader('同義詞測驗') + emptyState('今天沒有到期的同義詞題目了',
        '題目只會出有存兩個以上同義詞的卡片。'));
      return;
    }
    session = { mode: 'syn', items, index: 0, hit: 0, miss: 0, phase: 'ask', target: 2 };
    renderSyn();
  }

  function renderSyn(feedback) {
    const s = session;
    if (s.index >= s.items.length) return finishSyn();
    const card = s.items[s.index];
    showStage(modeHeader('同義詞測驗', `${s.index + 1} / ${s.items.length}`) + `
      <div class="card study-card">
        ${wordHead(card)}
      </div>
      ${feedback || ''}
      ${s.phase === 'ask' ? `
        <input class="spell-input" id="syn-input" type="text" autocomplete="off"
          autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="列出 ${s.target} 個以上，用逗號分隔">
        <button class="btn btn-primary wide-btn" onclick="Vocab.submitSyn()">送出</button>
        <div class="sub-actions"><button class="tool-btn" onclick="Vocab.synSkip()">看答案並跳過</button></div>`
      : `<button class="btn btn-primary wide-btn" onclick="Vocab.nextSyn()">下一題</button>`}`);
    const input = el('syn-input');
    if (input) {
      input.focus();
      input.addEventListener('keydown', e => { if (e.key === 'Enter') submitSyn(); });
    }
  }

  function synSkip() {
    const s = session;
    const card = s.items[s.index];
    s.phase = 'result';
    renderSyn(`<div class="feedback">
      <div class="feedback-title">這個字的同義詞</div>
      <div class="feedback-body">${esc(card.synonyms.join(' / '))}</div>
    </div>`);
  }

  function submitSyn() {
    const s = session;
    if (!s || s.phase !== 'ask') return;
    const input = el('syn-input');
    const raw = (input ? input.value : '').trim();
    if (!raw) return;
    const card = s.items[s.index];
    const answers = TextUtil.splitAnswers(raw);
    const { matched, missed, extras } = TextUtil.matchSynonyms(answers, card.synonyms);
    const hit = matched.length;

    let rating;
    if (hit === 0) rating = SRS.AGAIN;
    else if (hit < s.target) rating = SRS.HARD;
    else if (hit > s.target) rating = SRS.EASY;
    else rating = SRS.GOOD;

    const state = Store.grade(card.id, 'synonym', rating);
    logStudy();
    if (hit >= s.target) s.hit += 1; else s.miss += 1;

    s.phase = 'result';
    renderSyn(`<div class="feedback ${hit ? 'ok' : 'bad'}">
      <div class="feedback-title">${hit ? `✓ 答對 ${hit} / ${card.synonyms.length}` : '✗ 沒有對上卡片裡的同義詞'}</div>
      <div class="feedback-body">
        ${matched.length ? `<div>對上了：<b>${esc(matched.map(m => m.answer).join(', '))}</b></div>` : ''}
        ${missed.length ? `<div>還有：${esc(missed.join(' / '))}</div>` : ''}
        ${extras.length ? `<div class="feedback-note">不在卡片清單裡：${esc(extras.join(', '))}
          （確定是對的就用「補完卡片」加進去）</div>` : ''}
        <div class="feedback-note">${esc(SRS.RATING_SHORT[rating])} · ${esc(SRS.describeNext(state, Store.today()))}</div>
      </div>
    </div>`);
  }

  function nextSyn() {
    session.index += 1;
    session.phase = 'ask';
    renderSyn();
  }

  function finishSyn() {
    const s = session;
    const total = s.hit + s.miss;
    showStage(modeHeader('同義詞測驗') + `
      <div class="card center-card">
        <div class="big-emoji">🔁</div>
        <div class="empty-title">達標 ${s.hit} ／ ${total} 題</div>
        <div class="empty-hint">同義替換是雅思聽力閱讀的核心，這個練久了讀題會快很多。</div>
        <button class="btn btn-secondary" onclick="Vocab.showHome()">回單字首頁</button>
      </div>`);
    session = null;
  }

  // ---------------------------------------------------------- 模式 C：主動輸出
  const GENERAL_PROMPTS = [
    'Some people think X; others disagree. Discuss both views and give your own opinion.',
    'What are the advantages and disadvantages of this development?',
    'Describe a recent change in your country and explain how it has affected people.',
    'To what extent do you agree or disagree with this statement?'
  ];

  const TOPIC_PROMPTS = {
    環境: ['Some people believe individual action cannot solve environmental problems. Do you agree?',
      'What should governments do about plastic waste in cities?',
      'Describe an environmental problem in your hometown.'],
    教育: ['Should schools replace final exams with continuous assessment?',
      'Some argue university education should be free. What is your view?',
      'Describe a subject you think should be added to the school curriculum.'],
    科技: ['Has social media done more harm than good to human relationships?',
      'Should governments regulate artificial intelligence more strictly?',
      'Describe a piece of technology that changed how you study.'],
    健康: ['What are the main causes of rising obesity rates in cities?',
      'Should healthcare be funded entirely by the government?',
      'Describe a habit that has improved your physical or mental health.'],
    都市化: ['What problems does rapid urbanisation cause, and how can they be solved?',
      'Is it better to live in a large city or a small town?',
      'Describe a change that would improve transport in your city.'],
    犯罪: ['Do longer prison sentences reduce crime rates?',
      'Should CCTV cameras be installed in all public places?',
      'What is the best way to prevent youth crime?'],
    媒體: ['Can we still trust the news we read online?',
      'Should social media companies be responsible for misinformation?',
      'Describe a news story that changed your opinion about something.'],
    經濟: ['Should governments spend more on public services or cut taxes?',
      'Is economic growth always good for a country?',
      'Describe a way in which online shopping has changed local businesses.'],
    工作: ['Is a four-day working week realistic for most industries?',
      'Should employees be allowed to work from home permanently?',
      'Describe a job that you think will disappear in the next twenty years.'],
    文化: ['Should governments fund the preservation of traditional culture?',
      'Does globalisation make cultures more similar to each other?',
      'Describe a tradition in your country that you would like to keep.']
  };

  const pick = list => list[Math.floor(Math.random() * list.length)];

  function promptFor(topic) {
    const bank = TOPIC_PROMPTS[(topic || '').trim()];
    if (bank) return pick(bank);
    const key = Object.keys(TOPIC_PROMPTS).find(k => (topic || '').includes(k));
    return key ? pick(TOPIC_PROMPTS[key]) : pick(GENERAL_PROMPTS);
  }

  function startProduce() {
    const cards = Store.productionCandidates(filterOpts({ limit: 8 }));
    if (!cards.length) {
      showStage(modeHeader('主動輸出') + `
        <div class="card center-card">
          <div class="big-emoji">🗣️</div>
          <div class="empty-title">還沒有 active 主動詞彙</div>
          <div class="empty-hint">先把認讀已經穩的字升級成 active，再回來練造句。</div>
          <button class="btn btn-primary" onclick="Vocab.showPromote()">去升級</button>
          <button class="btn btn-secondary" onclick="Vocab.showHome()">回單字首頁</button>
        </div>`);
      return;
    }
    session = {
      mode: 'produce', items: cards, index: 0, done: 0,
      prompt: promptFor(cards[0].topic), phase: 'ask'
    };
    renderProduce();
  }

  function renderProduce(feedback) {
    const s = session;
    if (s.index >= s.items.length) return finishProduce();
    const card = s.items[s.index];
    showStage(modeHeader('主動輸出', `${s.index + 1} / ${s.items.length}`) + `
      <div class="card study-card">
        ${wordHead(card)}
        <div class="dim-box">
          ${card.collocations.length ? `<div class="dim-row"><span class="dim-key">搭配</span><span class="dim-val">${esc(card.collocations.join(' · '))}</span></div>` : ''}
          ${card.synonyms.length ? `<div class="dim-row"><span class="dim-key">同義</span><span class="dim-val">${esc(card.synonyms.join(' / '))}</span></div>` : ''}
          <div class="dim-row"><span class="dim-key">話題</span><span class="dim-val">${esc(s.prompt)}</span></div>
        </div>
      </div>
      ${feedback || ''}
      ${s.phase === 'ask' ? `
        <textarea class="sentence-input" id="produce-input" rows="3"
          placeholder="用「${esc(card.word)}」寫一個完整句子"></textarea>
        <button class="btn btn-primary wide-btn" onclick="Vocab.submitProduce()">存起來</button>
        <div class="sub-actions">
          <button class="tool-btn" onclick="Vocab.produceSkip()">跳過這個字</button>
        </div>`
      : `<button class="btn btn-primary wide-btn" onclick="Vocab.nextProduce()">下一個字</button>`}`);
    const input = el('produce-input');
    if (input) input.focus();
  }

  function produceSkip() {
    session.index += 1;
    session.phase = 'ask';
    if (session.index < session.items.length) session.prompt = promptFor(session.items[session.index].topic);
    renderProduce();
  }

  function submitProduce() {
    const s = session;
    const input = el('produce-input');
    const sentence = (input ? input.value : '').trim();
    if (!sentence) return;
    const card = s.items[s.index];
    const uses = TextUtil.maskSentence(sentence, card.word).hits > 0;

    if (!uses && !s.warned) {
      s.warned = true;
      renderProduce(`<div class="feedback bad">
        <div class="feedback-title">這個句子裡好像沒用到「${esc(card.word)}」</div>
        <div class="feedback-body">改一下再送出；如果你確定用到了（例如特殊變化形），再按一次「存起來」就會存。</div>
      </div>`);
      const again = el('produce-input');
      if (again) again.value = sentence;
      return;
    }

    Store.addProduction(card.id, card.topic, s.prompt, sentence);
    logStudy();
    s.done += 1;
    s.warned = false;
    s.phase = 'result';
    renderProduce(`<div class="feedback ok">
      <div class="feedback-title">✓ 已存入輸出紀錄</div>
      <div class="feedback-body">${esc(sentence)}</div>
      <div class="feedback-note">之後在「匯入匯出」可以整份匯出成 markdown，貼給 AI 批改。</div>
    </div>`);
  }

  function nextProduce() {
    session.index += 1;
    session.phase = 'ask';
    session.warned = false;
    if (session.index < session.items.length) session.prompt = promptFor(session.items[session.index].topic);
    renderProduce();
  }

  function finishProduce() {
    const s = session;
    showStage(modeHeader('主動輸出') + `
      <div class="card center-card">
        <div class="big-emoji">🗣️</div>
        <div class="empty-title">這輪寫了 ${s.done} 句</div>
        <div class="empty-hint">真正「用出來」過的字才算學會。</div>
        <button class="btn btn-primary" onclick="Vocab.showProductions()">看全部造句紀錄</button>
        <button class="btn btn-secondary" onclick="Vocab.showHome()">回單字首頁</button>
      </div>`);
    session = null;
  }

  function showProductions() {
    const rows = Store.listProductions(100);
    const body = rows.length ? rows.map(p => `
      <div class="prod-row">
        <div class="prod-word">${esc(p.card.word)}<span class="prod-date">${esc(p.at.slice(0, 10))}</span></div>
        <div class="prod-sentence">${esc(p.sentence)}</div>
        ${p.prompt ? `<div class="prod-prompt">${esc(p.prompt)}</div>` : ''}
      </div>`).join('') : '<div class="empty-state">還沒有造句紀錄</div>';
    showStage(modeHeader('造句紀錄', `${rows.length} 句`) + `
      <div class="card">${body}</div>
      <button class="btn btn-primary wide-btn" onclick="Vocab.downloadProductions()">匯出成 markdown（貼給 AI 批改）</button>`);
  }

  // ---------------------------------------------------------- 升級 active
  function showPromote() {
    const cards = Store.promotionCandidates({ minReviews: 3, limit: 15, topic: topicFilter || undefined });
    if (!cards.length) {
      const loose = Store.promotionCandidates({ minReviews: 1, limit: 15 });
      showStage(modeHeader('升級成 active') + `
        <div class="card center-card">
          <div class="big-emoji">⬆</div>
          <div class="empty-title">還沒有夠格的字</div>
          <div class="empty-hint">條件是認讀複習過 3 次以上、而且有例句。先多跑幾輪通勤複習。</div>
          ${loose.length ? `<button class="btn btn-secondary" onclick="Vocab.showPromoteLoose()">放寬到複習過 1 次（${loose.length} 個）</button>` : ''}
          <button class="btn btn-secondary" onclick="Vocab.showHome()">回單字首頁</button>
        </div>`);
      return;
    }
    renderPromote(cards, 3);
  }

  function showPromoteLoose() {
    renderPromote(Store.promotionCandidates({ minReviews: 1, limit: 15 }), 1);
  }

  function renderPromote(cards, minReviews) {
    const rows = cards.map(c => {
      const s = Store.getSrs(c.id, 'recall');
      return `<label class="promote-row">
        <input type="checkbox" class="promote-check" value="${c.id}" checked>
        <span class="promote-word">${esc(c.word)}</span>
        <span class="promote-meta">${esc(c.topic || '-')} · 複習 ${s.reviews} 次</span>
      </label>`;
    }).join('');
    showStage(modeHeader('升級成 active', `${cards.length} 個候選`) + `
      <div class="card">
        <div class="section-title">建議升級的字（每週做一次）</div>
        <div class="hint-text">升級後會出現在「主動輸出」，要求你用它造句。認讀複習過 ${minReviews} 次以上才會列入。</div>
        ${rows}
      </div>
      <button class="btn btn-primary wide-btn" onclick="Vocab.confirmPromote()">把勾選的字升級成 active</button>
      <button class="btn btn-secondary wide-btn" onclick="Vocab.showHome()">取消</button>`);
  }

  function confirmPromote() {
    const ids = [...document.querySelectorAll('.promote-check:checked')].map(i => Number(i.value));
    ids.forEach(id => Store.setCardType(id, 'active'));
    showStage(modeHeader('升級成 active') + `
      <div class="card center-card">
        <div class="big-emoji">⬆</div>
        <div class="empty-title">已升級 ${ids.length} 個字</div>
        <div class="empty-hint">接下來用「主動輸出」把它們真的用出來。</div>
        <button class="btn btn-primary" onclick="Vocab.startProduce()">現在去造句</button>
        <button class="btn btn-secondary" onclick="Vocab.showHome()">回單字首頁</button>
      </div>`);
  }

  // ---------------------------------------------------------- 補完卡片
  function startComplete() {
    const items = Store.completionQueue({ limit: 50 });
    if (!items.length) {
      showStage(modeHeader('寫例句') + emptyState('每張卡的例句你都寫過了', '厲害。之後匯入新卡片時會再出現在這裡。'));
      return;
    }
    session = { mode: 'complete', items, index: 0, fixed: 0 };
    renderComplete();
  }

  function renderComplete() {
    const s = session;
    if (s.index >= s.items.length) return finishComplete();
    const card = Store.getCard(s.items[s.index].id);
    const missing = Store.missingCore(card);
    const known = [];
    if (Store.showZh() && card.zh) known.push(['中文', esc(card.zh)]);
    if (card.phonetic) known.push(['音標', esc(card.phonetic)]);
    if (card.example && !missing.includes('example')) {
      known.push(['例句', esc(card.example)]);
      if (Store.showZh() && card.exampleZh) known.push(['句譯', esc(card.exampleZh)]);
    }
    if (card.collocations.length) known.push(['搭配', esc(card.collocations.join(' · '))]);
    if (card.root) known.push(['字根', esc(card.root)]);
    if (card.synonyms.length) known.push(['同義', esc(card.synonyms.join(' / '))]);

    const fieldInput = (field) => {
      // 例句是唯一「自己寫才有效」的欄位，所以參考例句預設藏起來，
      // 真的想不出來才按 —— 看了就等於讀別人的句子，效果差一截。
      const reference = (field === 'example' && card.exampleRef)
        ? `<div class="ref-box">
             <button type="button" class="tool-btn" onclick="Vocab.showExampleRef(this)">
               想不出來？看一句參考</button>
             <div class="ref-text" hidden>${esc(card.exampleRef)}${Speech.button(card.exampleRef)}${
               Store.showZh() && card.exampleRefZh
                 ? `<div class="ref-zh">${esc(card.exampleRefZh)}</div>` : ''}</div>
           </div>`
        : '';
      const placeholders = {
        example: '用這個字寫一句你自己的話，句中要真的用到它',
        collocations: '常見搭配，用分號分隔：conduct research; conduct a survey',
        root: '字根字首拆解：mit-(緩和) + -igate(使…)',
        synonyms: '同義詞，用分號分隔：alleviate; reduce; ease'
      };
      return `<div class="complete-field">
        <label>${esc(Store.CORE_LABELS[field])}</label>
        <textarea id="cf-${field}" rows="2" placeholder="${esc(placeholders[field])}"></textarea>
        ${reference}
      </div>`;
    };

    const remaining = Store.incompleteCount();
    showStage(modeHeader(`寫例句 · ${card.topic || '未分類'}`,
      `${s.index + 1} / ${s.items.length}　全庫還有 ${remaining}`) + `
      <div class="card study-card">
        ${wordHead(card)}
        ${known.length ? `<div class="dim-box">${known.map(([k, v]) =>
          `<div class="dim-row"><span class="dim-key">${k}</span><span class="dim-val">${v}</span></div>`).join('')}</div>` : ''}
        <div class="missing-tag">缺少：${esc(missing.map(f => Store.CORE_LABELS[f]).join('、'))}</div>
      </div>
      <div class="card">
        ${missing.map(fieldInput).join('')}
        <div class="hint-text">留白的欄位會保持未填，之後還可以再補。</div>
      </div>
      <button class="btn btn-primary wide-btn" onclick="Vocab.saveComplete()">存起來，下一張</button>
      <button class="btn btn-secondary wide-btn" onclick="Vocab.skipComplete()">跳過這張</button>`);
  }

  function showExampleRef(btn) {
    const box = btn.parentElement.querySelector('.ref-text');
    if (!box) return;
    box.hidden = false;
    btn.remove();
  }

  function saveComplete() {
    const s = session;
    const card = Store.getCard(s.items[s.index].id);
    const fields = {};
    Store.missingCore(card).forEach(f => {
      const input = el(`cf-${f}`);
      const value = input ? input.value.trim() : '';
      if (value) fields[f] = value;
    });
    if (Object.keys(fields).length) {
      Store.updateCard(card.id, fields);
      if (!Store.isIncomplete(Store.getCard(card.id))) s.fixed += 1;
    }
    s.index += 1;
    renderComplete();
  }

  function skipComplete() {
    session.index += 1;
    renderComplete();
  }

  function finishComplete() {
    const s = session;
    showStage(modeHeader('補完卡片') + `
      <div class="card center-card">
        <div class="big-emoji">🧩</div>
        <div class="empty-title">補完 ${s.fixed} 張</div>
        <div class="empty-hint">全庫還有 ${Store.incompleteCount()} 張不完整。</div>
        <button class="btn btn-secondary" onclick="Vocab.showHome()">回單字首頁</button>
      </div>`);
    session = null;
  }

  // ---------------------------------------------------------- 卡片清單
  function showLibrary(filter) {
    const opts = filter === 'incomplete' ? { incompleteOnly: true } : {};
    if (topicFilter) opts.topic = topicFilter;
    const cards = Store.listCards(opts);
    const rows = cards.map(c => `
      <button class="lib-row" onclick="Vocab.showCard(${c.id})">
        <span class="lib-word">${esc(c.word)}</span>
        <span class="lib-meta">${esc(c.topic || '-')} · ${c.cardType === 'active' ? 'active' : 'passive'}</span>
        ${Store.isIncomplete(c) ? '<span class="lib-flag">缺</span>' : ''}
      </button>`).join('') || '<div class="empty-state">沒有符合條件的卡片</div>';

    showStage(modeHeader('卡片清單', `${cards.length} 張`) + `
      <div class="sub-actions">
        <button class="tool-btn" onclick="Vocab.showLibrary()">全部</button>
        <button class="tool-btn" onclick="Vocab.showLibrary('incomplete')">只看不完整（${Store.incompleteCount()}）</button>
        <button class="tool-btn" onclick="Vocab.showAddCard()">＋ 新增卡片</button>
      </div>
      <div class="card lib-list">${rows}</div>`);
  }

  function showCard(id) {
    const card = Store.getCard(id);
    if (!card) return;
    const tracks = Store.TRACKS.map(track => {
      const s = Store.getSrs(id, track);
      return `<div class="track-row">
        <span class="track-name">${esc(Store.TRACK_LABELS[track])}</span>
        <span class="track-stat">複習 ${s.reviews} 次 · 間隔 ${Math.round(s.interval)} 天 · 下次 ${esc(s.due)}${s.lapses ? ` · 忘記 ${s.lapses} 次` : ''}</span>
      </div>`;
    }).join('');
    showStage(modeHeader(card.word) + `
      <div class="card study-card">
        <div class="word-line"><span class="card-word">${esc(card.word)}</span>${Speech.button(card.word)}</div>
        <div class="card-meta">${esc([card.phonetic, card.pos, card.category, card.topic, card.cardType].filter(Boolean).join(' · '))}</div>
        <div class="dim-box">${backLines(card)}</div>
      </div>
      <div class="card">
        <div class="section-title">排程狀態</div>
        ${tracks}
      </div>
      <div class="sub-actions">
        <button class="tool-btn" onclick="Vocab.toggleType(${card.id})">
          切換成 ${card.cardType === 'active' ? 'passive' : 'active'}</button>
        <button class="tool-btn" onclick="Vocab.showLibrary()">回清單</button>
      </div>`);
  }

  function toggleType(id) {
    const card = Store.getCard(id);
    Store.setCardType(id, card.cardType === 'active' ? 'passive' : 'active');
    showCard(id);
  }

  function showAddCard() {
    const field = (id, label, placeholder, rows) => `
      <div class="complete-field">
        <label>${esc(label)}</label>
        ${rows ? `<textarea id="${id}" rows="${rows}" placeholder="${esc(placeholder)}"></textarea>`
          : `<input id="${id}" type="text" placeholder="${esc(placeholder)}">`}
      </div>`;
    showStage(modeHeader('新增卡片') + `
      <div class="card">
        ${field('nc-word', '單字（必填）', 'mitigate')}
        ${field('nc-pos', '詞性', 'v.')}
        ${field('nc-example', '英文例句', '整句英文，句中要真的用到這個字', 2)}
        ${field('nc-colloc', '搭配詞（分號分隔）', 'mitigate the effects; mitigate risk', 2)}
        ${field('nc-root', '字根拆解', 'mit-(緩和) + -igate(使…)', 2)}
        ${field('nc-syn', '同義詞（分號分隔）', 'alleviate; reduce; ease', 2)}
        ${field('nc-category', '分類', 'AWL / 高頻話題字 / Task1圖表用語 / 口說表達')}
        ${field('nc-topic', '主題', '環境 / 教育 / 科技 …')}
        ${field('nc-zh', '中文意思（排在卡片背面最後、小字，可整個關掉）', '減輕、緩和')}
      </div>
      <div id="nc-msg"></div>
      <button class="btn btn-primary wide-btn" onclick="Vocab.saveNewCard()">新增</button>
      <button class="btn btn-secondary wide-btn" onclick="Vocab.showLibrary()">取消</button>`);
  }

  function saveNewCard() {
    const val = id => (el(id) ? el(id).value.trim() : '');
    const word = val('nc-word');
    const msg = el('nc-msg');
    if (!word) { msg.innerHTML = '<div class="feedback bad"><div class="feedback-title">單字不能空白</div></div>'; return; }
    if (Store.findCard(word, val('nc-pos'))) {
      msg.innerHTML = `<div class="feedback bad"><div class="feedback-title">「${esc(word)}」已經在單字庫裡了</div></div>`;
      return;
    }
    const card = Store.addCard({
      word, pos: val('nc-pos'), example: val('nc-example'),
      collocations: val('nc-colloc'), root: val('nc-root'), synonyms: val('nc-syn'),
      category: val('nc-category'), topic: val('nc-topic'), zh: val('nc-zh')
    });
    Store.save();
    const missing = Store.missingCore(card);
    showStage(modeHeader('新增卡片') + `
      <div class="card center-card">
        <div class="big-emoji">✅</div>
        <div class="empty-title">已新增 ${esc(card.word)}</div>
        ${missing.length ? `<div class="empty-hint">缺少：${esc(missing.map(f => Store.CORE_LABELS[f]).join('、'))}，之後可用「補完卡片」補上。</div>` : ''}
        <button class="btn btn-primary" onclick="Vocab.showAddCard()">再新增一張</button>
        <button class="btn btn-secondary" onclick="Vocab.showHome()">回單字首頁</button>
      </div>`);
  }

  // ---------------------------------------------------------- 匯入匯出
  function showTools() {
    showStage(modeHeader('匯入匯出') + `
      <div class="card">
        <div class="section-title">📥 匯入 CSV</div>
        <div class="hint-text">只有 word 是必填。欄位名大小寫、底線、常見別名（example / root / 中文 / 詞性…）都對得上；
          缺欄位的卡片會標記成不完整，之後用「補完卡片」補齊。</div>
        <input type="file" id="csv-file" accept=".csv,.txt,text/csv" class="file-input">
        <label class="checkbox-row"><input type="checkbox" id="csv-update"> 已存在的字用檔案內容覆寫</label>
        <div id="import-msg"></div>
      </div>
      <div class="card">
        <div class="section-title">📤 匯出</div>
        <div class="hint-text">匯出的 CSV 可以直接餵給指令列版本（cli/），兩邊格式相同。</div>
        <button class="btn btn-secondary wide-btn" onclick="Vocab.downloadCSV()">匯出全部卡片（CSV）</button>
        <button class="btn btn-secondary wide-btn" onclick="Vocab.downloadTemplate()">下載 CSV 範本</button>
        <button class="btn btn-secondary wide-btn" onclick="Vocab.downloadProductions()">匯出造句紀錄（markdown）</button>
      </div>`);
    const file = el('csv-file');
    if (file) file.addEventListener('change', handleImportFile);
  }

  function handleImportFile(e) {
    const file = e.target.files && e.target.files[0];
    const msg = el('import-msg');
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => {
      msg.innerHTML = '<div class="feedback bad"><div class="feedback-title">讀取檔案失敗</div></div>';
    };
    reader.onload = () => {
      try {
        const result = Store.importCSV(String(reader.result || ''), { update: el('csv-update').checked });
        const errors = result.errors.slice(0, 5).map(x => `<div>${esc(x)}</div>`).join('');
        msg.innerHTML = `<div class="feedback ${result.added || result.updated ? 'ok' : 'bad'}">
          <div class="feedback-title">新增 ${result.added} ｜ 更新 ${result.updated} ｜ 略過 ${result.skipped} ｜ 不完整 ${result.incomplete}</div>
          <div class="feedback-body">${errors}
            ${result.errors.length > 5 ? `<div>…另外還有 ${result.errors.length - 5} 個問題</div>` : ''}
            ${result.incomplete ? '<div class="feedback-note">用「補完卡片」逐一補上缺的欄位。</div>' : ''}
          </div>
        </div>`;
      } catch (err) {
        msg.innerHTML = `<div class="feedback bad"><div class="feedback-title">匯入失敗</div>
          <div class="feedback-body">${esc(err.message)}</div></div>`;
      }
    };
    reader.readAsText(file, 'utf-8');
  }

  function download(filename, text, mime) {
    try {
      const blob = new Blob([text], { type: `${mime || 'text/plain'};charset=utf-8` });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      alert('這個瀏覽器不支援直接下載，請改用桌機版瀏覽器。');
    }
  }

  const downloadCSV = () => download(`ielts-cards-${Store.today()}.csv`, Store.exportCSV(), 'text/csv');
  const downloadProductions = () => download(`productions-${Store.today()}.md`, Store.exportProductionsMarkdown(), 'text/markdown');

  function downloadTemplate() {
    const sample = ['mitigate', 'v.', 'Governments must act now to mitigate the effects of climate change.',
      'mitigate the effects; mitigate risk', 'mit-(緩和、變柔軟) + -igate(使…) → 使變柔和',
      'alleviate; reduce; ease; lessen', 'AWL', '環境', 'passive', '減輕、緩和', ''];
    const cell = v => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    download('ielts-template.csv',
      '﻿' + Store.CSV_COLUMNS.join(',') + '\n' + sample.map(cell).join(','), 'text/csv');
  }

  // ---------------------------------------------------------- 鍵盤（筆電用）
  function onKey(e) {
    if (!session) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    if (session.mode === 'review') {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (!session.revealed) reveal(); }
      else if (['1', '2', '3', '4'].includes(e.key)) { e.preventDefault(); rate(Number(e.key)); }
      else if (e.key.toLowerCase() === 's') skip();
      else if (e.key.toLowerCase() === 'p') Speech.say(session.items[session.index].word);
    }
  }

  function init() {
    Store.init();
    Speech.init();
    document.addEventListener('keydown', onKey);
    showHome();
  }

  return {
    init, showHome, setTopic, renderHome, refresh,
    startReview, reveal, skip, rate,
    startSpell, submitSpell, nextSpell, spellHint, spellSay, spellSkip,
    startSyn, submitSyn, nextSyn, synSkip,
    startProduce, submitProduce, nextProduce, produceSkip, showProductions,
    showPromote, showPromoteLoose, confirmPromote,
    startComplete, saveComplete, skipComplete, showExampleRef,
    showLibrary, showCard, toggleType, showAddCard, saveNewCard,
    showTools, downloadCSV, downloadProductions, downloadTemplate
  };
})();
