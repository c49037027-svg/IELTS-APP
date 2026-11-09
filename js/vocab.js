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
    disposePad();
    session = null;
    Speech.stop();   // 念到一半就退出模式時，別讓聲音繼續
    stage().innerHTML = '';
    stage().style.display = 'none';
    home().style.display = '';
    renderHome();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function showStage(html) {
    disposePad();   // 離開手抄就放掉畫布（resize 監聽器不能留著）
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
        ${modeCard('🖊️', '手抄單字', '自己的生詞：單字／解釋／例句／同義詞，iPad 手寫抄', null, 'Vocab.startCopy()')}
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
    else if (session.mode === 'copy') renderCopy();   // 筆跡會先收起來，重畫不會弄丟
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
  // 手抄本的筆跡：該欄有手寫就用手寫（自己的字比打出來的更好記）
  function inkSvg(card, field) {
    const ink = card.noteId ? Store.getInk(card.noteId) : null;
    const f = ink && ink.fields && ink.fields[field];
    return f ? Ink.toSvg(f.s) : '';
  }

  function backLines(card) {
    const rows = [];
    const own = !!card.fromNote;   // 從手抄本建出來的卡：手寫取代打字
    const exInk = own ? inkSvg(card, 'example') : '';
    if (exInk) {
      rows.push(['例句', exInk + Speech.button(card.example || card.word), ' ink-row']);
    } else if (card.example) {
      rows.push(['例句', esc(TextUtil.highlightTarget(card.example, card.word)) + Speech.button(card.example), '']);
    }
    if (card.collocations.length) rows.push(['搭配', esc(card.collocations.join(' · ')), '']);
    if (card.root) rows.push(['字根', esc(card.root), '']);
    const synInk = own ? inkSvg(card, 'synonyms') : '';
    if (synInk) rows.push(['同義', synInk, ' ink-row']);
    else if (card.synonyms.length) rows.push(['同義', esc(card.synonyms.join(' / ')), '']);
    if (card.notes) rows.push(['筆記', esc(card.notes), '']);
    // 單字庫原本就有的字，另外掛了手抄本的筆記：筆記接在後面，不取代原本的內容
    if (card.noteId && !own) {
      const note = Store.getNote(card.noteId);
      const mine = ['meaning', 'example', 'synonyms'].map(k => inkSvg(card, k)).filter(Boolean).join('');
      const typed = note ? [note.meaning, note.example, note.synonyms.join(' / ')].filter(Boolean) : [];
      if (mine || typed.length) {
        rows.push(['我的筆記', mine + typed.map(x => `<div>${esc(x)}</div>`).join(''), ' ink-row']);
      }
    }
    const meaningInk = own ? inkSvg(card, 'meaning') : '';
    if (meaningInk) rows.push(['解釋', meaningInk, ' ink-row zh-row']);
    else if (Store.showZh() && card.zh) rows.push(['中文', esc(card.zh), ' zh-row']);
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
    // 一場的份量 = 最多 40 張到期舊字 + 今天還沒認過的新字。
    // 把新字算進 limit 裡，積了幾天沒練的時候舊卡才不會塞滿整場、
    // 讓「每天幾個新字」變成空話。
    const items = Store.dueItems('recall', filterOpts({
      cardType: 'passive', requireContent: true, preferComplete: true,
      limit: 40 + Store.newWordsLeftToday()
    }));
    if (!items.length) {
      showStage(modeHeader('通勤複習') + emptyState('今天沒有到期的卡片了', '過幾小時或明天再回來，排程會自己安排。'));
      return;
    }
    // results: 位置 → { rating, before, wasNew }。評過分的卡回頭看時要知道
    // 當時評了什麼、排程原本長怎樣（改評分要先還原），所以不能只記張數。
    session = { mode: 'review', items, index: 0, revealed: false, results: {} };
    renderReview();
  }

  const reviewDone = s => Object.keys(s.results).length;
  const reviewAgain = s => Object.values(s.results).filter(r => r.rating === SRS.AGAIN).length;

  // 上一張／下一張：評過分的卡回頭看是「已翻開 + 標出當時的評分」，
  // 沒評過的（跳過的）回頭看還是正面，可以照常翻開評分。
  function navButtons(s, prevLabel, nextLabel) {
    return `<div class="nav-row">
      <button class="nav-btn" onclick="Vocab.prev()" ${s.index <= 0 ? 'disabled' : ''}>‹ ${prevLabel}</button>
      <button class="nav-btn" onclick="Vocab.next()">${nextLabel} ›</button>
    </div>`;
  }

  // 拼字與同義詞共用的「上一題」：只有回頭這一個方向，往前走由各自的
  // 送出／跳過／下一題負責（往前 = 交卷或跳過，語意不同，不能混成一顆）。
  function quizNav(s, onPrev, enabled) {
    return `<div class="nav-row single">
      <button class="nav-btn" onclick="${onPrev}" ${enabled ? '' : 'disabled'}>‹ 上一題</button>
    </div>`;
  }

  function renderReview() {
    const s = session;
    if (s.index >= s.items.length) return finishReview();
    const card = s.items[s.index];
    const result = s.results[s.index];          // 這張已經評過分？
    const shown = s.revealed || !!result;        // 評過的卡回頭看直接翻開
    // 這張是今天第一次見面就標出來 —— 新字的目標只有「看到認得」，
    // 想不起來按 Again 很正常，不必因此覺得自己沒學好。
    const fresh = result ? result.wasNew : !Store.everSeen(card.id);
    const rateBtn = (n, label, hint) => `
      <button class="btn rate-${n}${result && result.rating === n ? ' picked' : ''}"
        onclick="Vocab.rate(${n})">${label}<span>${hint}</span></button>`;
    showStage(modeHeader('通勤複習', `${s.index + 1} / ${s.items.length}`) + `
      <div class="card study-card">
        ${fresh ? '<div class="new-tag">今天的新字　·　看到認得就好</div>' : ''}
        ${result ? `<div class="rated-tag">已評：${esc(SRS.RATING_SHORT[result.rating])}　·　點別的可以改</div>` : ''}
        ${wordHead(card)}
        ${shown ? `<div class="dim-box">${backLines(card)}</div>` : ''}
        ${shown && !card.example && !card.fromNote ? `<div class="missing-tag">
          這張還沒有你自己的例句　·　回首頁的「✍️ 寫例句」補一句，會更好記</div>` : ''}
      </div>
      ${shown ? `
        <div class="rating-grid">
          ${rateBtn(1, 'Again', '忘了')}${rateBtn(2, 'Hard', '吃力')}
          ${rateBtn(3, 'Good', '想得起來')}${rateBtn(4, 'Easy', '太簡單')}
        </div>
        ${navButtons(s, '上一張', '下一張')}
        <div class="key-hint">鍵盤：1 / 2 / 3 / 4 評分　·　← → 前後翻　·　p 念一次</div>`
      : `
        <button class="btn btn-primary wide-btn" onclick="Vocab.reveal()">看例句與同義詞</button>
        ${navButtons(s, '上一張', '跳過')}
        <div class="key-hint">鍵盤：空白鍵翻面　·　← → 前後翻　·　p 念一次</div>`}`);
  }

  function reveal() {
    if (!session || session.mode !== 'review') return;
    const card = session.items[session.index];
    if (!card) return;
    session.revealed = true;
    renderReview();
    // 翻面才念，而且只在使用者打開「自動念例句」時。
    // 這裡是點擊／按鍵之後才跑的，所以 iOS 的「語音必須由使用者動作觸發」也滿足。
    Speech.autoSay(card.example || card.word);
  }

  // 前後翻不評分 —— 沒評的卡排程原封不動，還在到期清單裡。
  function moveReview(delta) {
    const s = session;
    if (!s || s.mode !== 'review') return;
    const target = s.index + delta;
    if (target < 0 || target > s.items.length) return;
    Speech.stop();
    s.index = target;
    s.revealed = false;
    renderReview();
  }
  const prev = () => moveReview(-1);
  const next = () => moveReview(1);
  const skip = next;   // 舊名字，行為相同

  // 從結尾畫面跳回第一張沒評分的
  function goSkipped() {
    const s = session;
    if (!s || s.mode !== 'review') return;
    const first = s.items.findIndex((_, i) => !s.results[i]);
    if (first < 0) return;
    s.index = first;
    s.revealed = false;
    renderReview();
  }

  function rate(rating) {
    const s = session;
    if (!s || s.mode !== 'review' || s.index >= s.items.length) return;
    const i = s.index;
    const card = s.items[i];
    const prior = s.results[i];
    if (!prior && !s.revealed) return;
    if (prior) {
      // 回頭改評分：先把上一次的評分整個還原，再用新的評一次。
      // 直接再評的話，同一張卡會被記兩次複習、間隔被推進兩步。
      if (prior.rating !== rating) {
        Store.undoGrade(card.id, 'recall', prior.before);
        Store.grade(card.id, 'recall', rating);
        s.results[i] = { ...prior, rating };
      }
    } else {
      const before = { ...Store.getSrs(card.id, 'recall') };
      const wasNew = !Store.everSeen(card.id);
      Store.grade(card.id, 'recall', rating);
      logStudy();
      s.results[i] = { rating, before, wasNew };
    }
    s.index += 1;
    s.revealed = false;
    renderReview();
  }

  function finishReview() {
    const s = session;
    const done = reviewDone(s);
    const again = reviewAgain(s);
    const skipped = s.items.length - done;
    // session 留著不清掉：結尾畫面還能回頭翻，離開才在 showHome 清。
    showStage(modeHeader('通勤複習') + `
      <div class="card center-card">
        <div class="big-emoji">✅</div>
        <div class="empty-title">複習 ${done} 張</div>
        <div class="empty-hint">${again ? `其中 ${again} 張忘記了，明天會再出現。` : done ? '全部都想得起來，狀態不錯。' : ''}
          ${skipped ? `<br>有 ${skipped} 張跳過沒評分，還留在到期清單裡。` : ''}</div>
        <button class="btn btn-secondary" onclick="Vocab.prev()">‹ 回上一張看看</button>
        ${skipped ? `<button class="btn btn-secondary" onclick="Vocab.goSkipped()">回去看跳過的 ${skipped} 張</button>` : ''}
        <button class="btn btn-primary" onclick="Vocab.startReview()">再來一輪</button>
        <button class="btn btn-secondary" onclick="Vocab.showHome()">回單字首頁</button>
      </div>`);
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
    // answered: 位置 → 當時的回饋畫面。回頭看答過的題是唯讀重播，不會再記一次作答
    session = { mode: 'spell', items, index: 0, correct: 0, wrong: 0, phase: 'ask', hinted: false, answered: {} };
    renderSpell();
  }

  function renderSpell(feedback) {
    const s = session;
    if (s.index >= s.items.length) return finishSpell();
    if (!feedback && s.phase === 'result') feedback = s.answered[s.index] || '';
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
    // 手抄本的字：手寫的解釋當線索（例句的筆跡不能挖空，會洩題，所以不給）
    const meaningInk = card.fromNote ? inkSvg(card, 'meaning') : '';
    if (meaningInk) rows.push(['解釋', meaningInk]);
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
        </div>
        ${quizNav(s, 'Vocab.prevSpell()', s.index > 0)}`
      : `<button class="btn btn-primary wide-btn" onclick="Vocab.nextSpell()">下一題</button>
        ${quizNav(s, 'Vocab.prevSpell()', s.index > 0)}`}`);

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

  // 前後翻：答過的題回頭看是唯讀重播；跳過的題回頭看還是可以答。
  function moveSpell(delta) {
    const s = session;
    if (!s || s.mode !== 'spell') return;
    const target = s.index + delta;
    if (target < 0 || target > s.items.length) return;
    s.index = target;
    s.phase = s.answered[target] ? 'result' : 'ask';
    s.hinted = false;
    renderSpell();
  }
  const prevSpell = () => moveSpell(-1);
  const spellSkip = () => moveSpell(1);

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
    s.answered[s.index] = feedback;
    renderSpell(feedback);
  }

  const nextSpell = () => moveSpell(1);

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
        <button class="btn btn-secondary" onclick="Vocab.prevSpell()">‹ 回上一題看看</button>
        <button class="btn btn-secondary" onclick="Vocab.showHome()">回單字首頁</button>
      </div>`);
  }

  // ---------------------------------------------------------- 同義詞測驗
  function startSyn() {
    const items = Store.dueItems('synonym', filterOpts({ requireSynonyms: true, limit: 20 }));
    if (!items.length) {
      showStage(modeHeader('同義詞測驗') + emptyState('今天沒有到期的同義詞題目了',
        '題目只會出有存兩個以上同義詞的卡片。'));
      return;
    }
    session = { mode: 'syn', items, index: 0, hit: 0, miss: 0, phase: 'ask', target: 2, answered: {} };
    renderSyn();
  }

  function renderSyn(feedback) {
    const s = session;
    if (s.index >= s.items.length) return finishSyn();
    if (!feedback && s.phase === 'result') feedback = s.answered[s.index] || '';
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
        <div class="sub-actions"><button class="tool-btn" onclick="Vocab.synSkip()">看答案並跳過</button></div>
        ${quizNav(s, 'Vocab.prevSyn()', s.index > 0)}`
      : `<button class="btn btn-primary wide-btn" onclick="Vocab.nextSyn()">下一題</button>
        ${quizNav(s, 'Vocab.prevSyn()', s.index > 0)}`}`);
    const input = el('syn-input');
    if (input) {
      input.focus();
      input.addEventListener('keydown', e => { if (e.key === 'Enter') submitSyn(); });
    }
  }

  function synSkip() {
    const s = session;
    const card = s.items[s.index];
    const shown = `<div class="feedback">
      <div class="feedback-title">這個字的同義詞</div>
      <div class="feedback-body">${esc(card.synonyms.join(' / '))}</div>
    </div>`;
    s.phase = 'result';
    s.answered[s.index] = shown;
    renderSyn(shown);
  }

  // 前後翻：答過（或看過答案）的題回頭看是唯讀重播，不會再記一次作答
  function moveSyn(delta) {
    const s = session;
    if (!s || s.mode !== 'syn') return;
    const target = s.index + delta;
    if (target < 0 || target > s.items.length) return;
    s.index = target;
    s.phase = s.answered[target] ? 'result' : 'ask';
    renderSyn();
  }
  const prevSyn = () => moveSyn(-1);

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
    const shownFeedback = `<div class="feedback ${hit ? 'ok' : 'bad'}">
      <div class="feedback-title">${hit ? `✓ 答對 ${hit} / ${card.synonyms.length}` : '✗ 沒有對上卡片裡的同義詞'}</div>
      <div class="feedback-body">
        ${matched.length ? `<div>對上了：<b>${esc(matched.map(m => m.answer).join(', '))}</b></div>` : ''}
        ${missed.length ? `<div>還有：${esc(missed.join(' / '))}</div>` : ''}
        ${extras.length ? `<div class="feedback-note">不在卡片清單裡：${esc(extras.join(', '))}
          （確定是對的就用「補完卡片」加進去）</div>` : ''}
        <div class="feedback-note">${esc(SRS.RATING_SHORT[rating])} · ${esc(SRS.describeNext(state, Store.today()))}</div>
      </div>
    </div>`;
    s.answered[s.index] = shownFeedback;
    renderSyn(shownFeedback);
  }

  const nextSyn = () => moveSyn(1);

  function finishSyn() {
    const s = session;
    const total = s.hit + s.miss;
    showStage(modeHeader('同義詞測驗') + `
      <div class="card center-card">
        <div class="big-emoji">🔁</div>
        <div class="empty-title">達標 ${s.hit} ／ ${total} 題</div>
        <div class="empty-hint">同義替換是雅思聽力閱讀的核心，這個練久了讀題會快很多。</div>
        <button class="btn btn-secondary" onclick="Vocab.prevSyn()">‹ 回上一題看看</button>
        <button class="btn btn-secondary" onclick="Vocab.showHome()">回單字首頁</button>
      </div>`);
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

  // ---------------------------------------------------------- 手抄本（iPad + Apple Pencil）
  // 自己遇到的生詞，一個字一頁，四欄：單字／解釋／例句／同義詞。
  // 先把生詞輸入到手抄本，再拿 Apple Pencil 在橫線格子裡一欄一欄抄 ——
  // 眼睛看、手寫、嘴巴念，三條路一起進腦子。三種寫法由淺到深：
  //   抄寫：這個字的四欄在旁邊，照著抄      描紅：每一行印淡淡的字，沿著寫
  //   默寫：只給解釋與發音，字蓋起來，寫完再翻開核對
  // 手抄本跟單字庫是兩個獨立的東西：不進複習排程、不動任何卡片，只記抄過幾遍。
  // 筆跡不存（存成圖片會很快塞滿 localStorage），只在這一輪裡保留。
  const COPY_MODES = [['copy', '抄寫'], ['trace', '描紅'], ['dictate', '默寫']];
  let editingNote = null;   // 表單正在編輯哪個生詞（null = 新增）

  function disposePad() {
    if (session && session.pad) { session.pad.destroy(); session.pad = null; }
    document.body.classList.remove('copy-mode');
  }

  // ---- 手抄本清單
  function startCopy() {
    disposePad();   // 從表單或手抄頁回來：先放掉畫布，再清 session
    session = null;
    editingNote = null;
    const notes = Store.listNotes();
    showStage(modeHeader('手抄單字', `${notes.length} 個生詞`) + `
      <button class="btn btn-primary wide-btn" onclick="Vocab.showNoteForm()">＋ 新增生詞</button>
      ${notes.length ? `
        <button class="btn btn-secondary wide-btn" onclick="Vocab.startNote()">開始手抄（${notes.length} 個）</button>
        <div class="section-subtitle">我的生詞　·　點一個字就從它開始抄</div>
        <div class="note-list">${notes.map(n => `
          <div class="note-row">
            <button class="note-main" onclick="Vocab.startNote(${n.id})">
              <span class="note-word">${esc(n.word)}</span>
              <span class="note-meaning">${esc(n.meaning || (Store.hasInk(n.id) ? '✎ 手寫筆記' : '（只有單字）'))}</span>
              <span class="note-meta">${n.copies ? `抄過 ${n.copies} 遍` : '還沒抄過'}　·　🚇 已排進通勤複習</span>
            </button>
            <button class="tool-btn" onclick="Vocab.showNoteForm(${n.id})">編輯</button>
            <button class="tool-btn" onclick="Vocab.removeNote(${n.id})">刪除</button>
          </div>`).join('')}</div>
        <div class="tool-row">
          <button class="tool-btn" onclick="Vocab.downloadNotebook()">📥 匯出文字（CSV）</button>
          <button class="tool-btn" onclick="Vocab.downloadNotebookInk()">📥 匯出含筆跡（JSON）</button>
        </div>
        <div class="hint-text" style="margin-top:10px;">
          生詞存在這台裝置的瀏覽器裡。iPad 請用 Safari「加入主畫面」再使用，並定期匯出備份 ——
          Safari 對沒加到主畫面的網站，一陣子沒開會清掉它存的資料。</div>`
      : `
        <div class="card center-card">
          <div class="big-emoji">🖊️</div>
          <div class="empty-title">手抄本還是空的</div>
          <div class="empty-hint">遇到的生詞先在這裡存下來：單字、解釋、例句、同義詞，
            然後用 Apple Pencil 一欄一欄手抄。</div>
        </div>`}`);
  }

  // ---- 新增／編輯表單
  // 單字打字（發音、拼字題要用文字）；解釋、例句、同義詞直接用 Apple Pencil 寫在格子裡，
  // 筆跡原樣存下來，之後在通勤複習顯示的就是你自己的字。
  // 想打字也可以（選填）：打的字會成為搜尋、匯出與拼字題的依據。
  function showNoteForm(id) {
    disposePad();
    session = null;
    const note = id ? Store.getNote(id) : null;
    editingNote = note ? note.id : null;
    const v = key => esc(note ? (Array.isArray(note[key]) ? note[key].join(', ') : note[key]) : '');
    const wide = window.innerWidth >= 700;
    const typedOpen = note && (note.meaning || note.example || note.synonyms.length) ? 'open' : '';
    showStage(modeHeader(note ? '編輯生詞' : '新增生詞') + `
      <div class="card">
        <div class="complete-field">
          <label>單字</label>
          <input id="nb-word" type="text" autocomplete="off" autocapitalize="off" autocorrect="off"
            spellcheck="false" placeholder="例如 ubiquitous" value="${v('word')}">
          <div class="hint-text" style="margin:6px 0 0;">iPad：用 Apple Pencil 直接在這一欄上寫字，
            iPadOS 會自動轉成文字（Scribble）。單字要有文字，才有發音和拼字題。</div>
        </div>
      </div>
      <div class="section-subtitle">用 Apple Pencil 寫在格子裡　·　解釋、例句、同義詞</div>
      <div class="pad-wrap">
        <div class="pad-box"><canvas id="pad" aria-label="手寫區"></canvas></div>
        <div class="pad-scroll" aria-label="手指在這一條上下滑可以捲動頁面">滑這裡捲頁</div>
      </div>
      <div class="pad-tools">
        <button class="tool-btn" id="copy-undo" onclick="Vocab.copyUndo()">↶ 復原</button>
        <button class="tool-btn" onclick="Vocab.copyClear()">清除重寫</button>
        <label class="finger-toggle"><input type="checkbox" id="finger-ok"
          onchange="Vocab.copyFinger(this.checked)"> 手指也能寫</label>
      </div>
      <div class="pad-status" id="pad-status"></div>
      <details class="typed-fields" ${typedOpen}>
        <summary>⌨ 也可以用打字（選填）</summary>
        <div class="complete-field">
          <label>解釋</label>
          <textarea id="nb-meaning" rows="2" placeholder="中文或英文都可以">${v('meaning')}</textarea>
        </div>
        <div class="complete-field">
          <label>例句</label>
          <textarea id="nb-example" rows="2" placeholder="Smartphones are ubiquitous in modern cities.">${v('example')}</textarea>
        </div>
        <div class="complete-field">
          <label>同義詞</label>
          <input id="nb-syn" type="text" autocomplete="off" autocapitalize="off" autocorrect="off"
            spellcheck="false" placeholder="用逗號或分號分隔" value="${v('synonyms')}">
        </div>
      </details>
      <div class="form-error" id="nb-error"></div>
      <div class="hint-text">只有單字是必填。存起來之後，這個字會自動排進通勤複習，複習時背面顯示你自己的筆跡
        —— 不過至少要寫一點解釋、例句或同義詞，背面才有東西可以看。</div>
      <button class="btn btn-primary wide-btn" onclick="Vocab.saveNote(false)">存起來</button>
      ${note ? '' : `<button class="btn btn-secondary wide-btn" onclick="Vocab.saveNote(true)">存起來，再加一個</button>`}
      <button class="btn btn-secondary wide-btn" onclick="Vocab.startCopy()">取消</button>`);

    session = { mode: 'noteform', pad: null, fingerOk: false };
    session.pad = Handwriting.createPad(el('pad'), {
      sections: [
        { key: 'meaning', label: '解釋', rows: 2 },
        { key: 'example', label: '例句', rows: 4 },
        { key: 'synonyms', label: '同義詞', rows: 2 }
      ],
      rowHeight: wide ? 96 : 84, onChange: syncCopyUi
    });
    if (note) session.pad.importInk(Store.getInk(note.id));
    syncCopyUi();
    const word = el('nb-word');
    if (word && !note) word.focus();
  }

  function saveNote(another) {
    const s = session;
    if (!s || s.mode !== 'noteform' || !s.pad) return;
    const fields = {
      word: el('nb-word').value,
      meaning: el('nb-meaning').value,
      example: el('nb-example').value,
      synonyms: el('nb-syn').value
    };
    let note;
    try {
      note = editingNote ? Store.updateNote(editingNote, fields) : Store.addNote(fields);
    } catch (e) {
      el('nb-error').textContent = e.message;   // 留在這一頁，寫好的筆跡不會丟
      return;
    }
    Store.setInk(note.id, s.pad.exportInk());
    if (another) showNoteForm(); else startCopy();
  }

  function removeNote(id) {
    const note = Store.getNote(id);
    if (!note) return;
    if (!confirm(`刪除「${note.word}」？它的筆跡，和排在通勤複習裡的卡片，都會一起刪掉，找不回來。`)) return;
    Store.deleteNote(id);
    startCopy();
  }

  function downloadNotebook() {
    download('ielts-notebook.csv', Store.exportNotebookCSV(), 'text/csv');
  }

  // CSV 帶不走手寫筆跡，所以另外一份 JSON（要換 iPad、或怕 Safari 清資料時用）
  function downloadNotebookInk() {
    download('ielts-notebook-ink.json', Store.exportNotebookJSON(), 'application/json');
  }

  // ---- 手抄
  // 從某個字開始（沒指定就從第一個）；整本手抄本排成一輪
  function startNote(id) {
    const items = Store.listNotes();
    if (!items.length) { startCopy(); return; }
    const first = id ? Math.max(0, items.findIndex(n => n.id === Number(id))) : 0;
    session = {
      mode: 'copy', items, index: first, padMode: 'copy', revealed: false,
      strokes: {}, done: {}, pad: null, padIndex: -1, fingerOk: false
    };
    renderCopy();
  }

  // 切換寫法、換字都會重畫整頁，重畫前先把這一頁的筆跡收起來，回來時還在
  function saveCopyStrokes() {
    const s = session;
    if (s && s.pad && s.padIndex >= 0) s.strokes[s.padIndex] = s.pad.getStrokes().slice();
  }

  // 一頁四欄：沒填的欄位整欄不出現。版面在三種寫法之間固定不變，
  // 這樣切換寫法時已經寫的筆跡不會跑位。
  const FIELD_LABELS = { meaning: '解釋', example: '例句', synonyms: '同義詞' };

  // 每一欄：有手寫就用手寫（描紅時把你自己的筆跡淡淡印出來），沒有才用打的字
  function noteSections(note) {
    const ink = Store.getInk(note.id);
    const out = [{ key: 'word', label: '單字', text: note.word }];
    ['meaning', 'example', 'synonyms'].forEach(key => {
      const typed = key === 'synonyms' ? note.synonyms.join(', ') : note[key];
      const f = ink && ink.fields && ink.fields[key];
      if (f) out.push({ key, label: FIELD_LABELS[key], rows: f.rows, guideInk: { w: ink.w, s: f.s } });
      else if (typed) out.push({ key, label: FIELD_LABELS[key], text: typed });
    });
    return out;
  }

  function noteReference(note, hidden) {
    const speaker = Speech.button(note.word);
    if (hidden) {
      // 默寫：只給解釋與發音（雅思聽力本來就是聽到什麼要拼出什麼）
      return `<div class="copy-ref">
        <div class="word-line"><span class="copy-hidden">？？？</span>${speaker}</div>
        ${(() => {
          const ink = Store.getInk(note.id);
          const m = ink && ink.fields && ink.fields.meaning ? Ink.toSvg(ink.fields.meaning.s) : '';
          return m || note.meaning
            ? `<div class="copy-sec"><span class="dim-key">解釋</span><span>${m || esc(note.meaning)}</span></div>` : '';
        })()}
        <div class="copy-tip">聽發音、看解釋，把這個字默寫出來</div>
      </div>`;
    }
    const ink = Store.getInk(note.id);
    const field = key => ink && ink.fields && ink.fields[key] ? Ink.toSvg(ink.fields[key].s) : '';
    const meaning = field('meaning'), example = field('example'), syn = field('synonyms');
    return `<div class="copy-ref">
      <div class="word-line"><span class="card-word">${esc(note.word)}</span>${speaker}</div>
      ${meaning || note.meaning ? `<div class="copy-sec"><span class="dim-key">解釋</span><span>${
        meaning || esc(note.meaning)}</span></div>` : ''}
      ${example || note.example ? `<div class="copy-sec"><span class="dim-key">例句</span><span>${
        example || esc(TextUtil.highlightTarget(note.example, note.word))}${
        Speech.button(note.example || note.word)}</span></div>` : ''}
      ${syn || note.synonyms.length ? `<div class="copy-sec"><span class="dim-key">同義</span><span>${
        syn || esc(note.synonyms.join(' / '))}</span></div>` : ''}
    </div>`;
  }

  function renderCopy() {
    const s = session;
    saveCopyStrokes();
    if (s.index >= s.items.length) return finishCopy();
    const note = Store.getNote(s.items[s.index].id) || s.items[s.index];
    const dictate = s.padMode === 'dictate';
    const hidden = dictate && !s.revealed;
    const wide = window.innerWidth >= 700;

    showStage(modeHeader('手抄單字', `${s.index + 1} / ${s.items.length}`) + `
      <div class="seg" role="tablist">
        ${COPY_MODES.map(([key, label]) =>
          `<button class="${s.padMode === key ? 'on' : ''}" onclick="Vocab.copyMode('${key}')">${label}</button>`).join('')}
      </div>
      <div class="copy-split">
        <div class="copy-left">
          <div class="card study-card copy-card">
            ${noteReference(note, hidden)}
            <div class="copy-count">${note.copies ? `這個字已經抄過 ${note.copies} 遍` : '還沒抄過這個字'}${s.done[s.index] ? '　·　本次已完成' : ''}</div>
          </div>
        </div>
        <div class="copy-right">
          <div class="pad-wrap">
            <div class="pad-box"><canvas id="pad" aria-label="手寫區"></canvas></div>
            <div class="pad-scroll" aria-label="手指在這一條上下滑可以捲動頁面">滑這裡捲頁</div>
          </div>
          <div class="pad-tools">
            <button class="tool-btn" id="copy-undo" onclick="Vocab.copyUndo()">↶ 復原</button>
            <button class="tool-btn" onclick="Vocab.copyClear()">清除重寫</button>
            <label class="finger-toggle"><input type="checkbox" id="finger-ok" ${s.fingerOk ? 'checked' : ''}
              onchange="Vocab.copyFinger(this.checked)"> 手指也能寫</label>
          </div>
          <div class="pad-status" id="pad-status"></div>
          ${hidden
            ? `<button class="btn btn-primary wide-btn" onclick="Vocab.copyReveal()">寫好了，翻開核對</button>`
            : `<button class="btn btn-primary wide-btn" id="copy-done" onclick="Vocab.copyDone()" disabled>
                 ✓ 寫好了，下一個</button>`}
          ${dictate && s.revealed ? `<div class="feedback"><div class="feedback-note">核對一下：寫錯的字母圈起來，再抄一遍。</div></div>` : ''}
          <div class="nav-row">
            <button class="nav-btn" onclick="Vocab.copyPrev()" ${s.index <= 0 ? 'disabled' : ''}>‹ 上一個</button>
            <button class="nav-btn" onclick="Vocab.copyNext()">跳過 ›</button>
          </div>
        </div>
      </div>`);
    document.body.classList.add('copy-mode');

    s.pad = Handwriting.createPad(el('pad'), {
      sections: noteSections(note), rowHeight: wide ? 100 : 88,
      trace: s.padMode === 'trace', onChange: syncCopyUi
    });
    s.padIndex = s.index;
    s.pad.allowFinger(s.fingerOk);
    s.pad.setStrokes((s.strokes[s.index] || []).slice());
  }

  function syncCopyUi() {
    const s = session;
    if (!s || !s.pad || (s.mode !== 'copy' && s.mode !== 'noteform')) return;
    const done = el('copy-done');
    if (done) done.disabled = !s.pad.hasInk();
    const undo = el('copy-undo');
    if (undo) undo.disabled = s.pad.strokeCount === 0;
    const status = el('pad-status');
    if (status) {
      status.textContent = s.pad.penDetected && !s.fingerOk
        ? '✏️ 偵測到 Apple Pencil —— 手掌碰到螢幕不會留下筆跡'
        : s.pad.strokeCount ? `已寫 ${s.pad.strokeCount} 筆` : '用 Apple Pencil（或手指）直接在格子裡寫';
    }
  }

  const copyUndo = () => { if (session && session.pad) session.pad.undo(); };
  const copyClear = () => { if (session && session.pad) session.pad.clear(); };

  function copyFinger(on) {
    if (!session || !session.pad) return;
    session.fingerOk = !!on;
    if (session.pad) session.pad.allowFinger(on);
    syncCopyUi();
  }

  function copyMode(mode) {
    const s = session;
    if (!s || s.mode !== 'copy' || s.padMode === mode) return;
    s.padMode = mode;
    s.revealed = false;
    renderCopy();
  }

  function copyReveal() {
    if (!session || session.mode !== 'copy') return;
    session.revealed = true;
    renderCopy();
  }

  function copyDone() {
    const s = session;
    if (!s || s.mode !== 'copy' || s.index >= s.items.length || !s.pad) return;
    if (!s.pad.hasInk() || (s.padMode === 'dictate' && !s.revealed)) return;
    // 回頭再按「寫好了」不重複記次數
    if (!s.done[s.index]) {
      s.done[s.index] = Store.recordNoteCopy(s.items[s.index].id);
      logStudy();
    }
    s.index += 1;
    s.revealed = false;
    renderCopy();
  }

  function moveCopy(delta) {
    const s = session;
    if (!s || s.mode !== 'copy') return;
    const target = s.index + delta;
    if (target < 0 || target > s.items.length) return;
    s.index = target;
    s.revealed = false;
    renderCopy();
  }
  const copyPrev = () => moveCopy(-1);
  const copyNext = () => moveCopy(1);

  function finishCopy() {
    const s = session;
    const n = Object.keys(s.done).length;
    showStage(modeHeader('手抄單字') + `
      <div class="card center-card">
        <div class="big-emoji">🖊️</div>
        <div class="empty-title">手抄了 ${n} 個字</div>
        <div class="empty-hint">${n < s.items.length ? `有 ${s.items.length - n} 個跳過沒抄。` : '全部抄完了。'}
          抄完的字睡前再默寫一次，記得最牢。</div>
        <button class="btn btn-secondary" onclick="Vocab.copyPrev()">‹ 回上一個看看</button>
        <button class="btn btn-primary" onclick="Vocab.startNote()">再抄一輪</button>
        <button class="btn btn-secondary" onclick="Vocab.startCopy()">回手抄本</button>
      </div>`);
  }

  // ---------------------------------------------------------- 鍵盤（筆電用）
  function onKey(e) {
    if (!session) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    if (session.mode === 'review') {
      const inRange = session.index < session.items.length;
      if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); if (inRange) next(); }
      else if (!inRange) return;
      else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (!session.revealed && !session.results[session.index]) reveal();
      }
      else if (['1', '2', '3', '4'].includes(e.key)) { e.preventDefault(); rate(Number(e.key)); }
      else if (e.key.toLowerCase() === 's') next();
      else if (e.key.toLowerCase() === 'p') Speech.say(session.items[session.index].word);
    }
  }

  // 手機：左右滑動前後翻。只在通勤複習開，而且要明顯是橫向滑
  // （橫向夠長、且遠大於縱向），捲動內容時不會誤觸。
  function bindSwipe() {
    let start = null;
    const box = stage();
    box.addEventListener('touchstart', e => {
      const t = e.changedTouches[0];
      start = { x: t.clientX, y: t.clientY };
    }, { passive: true });
    box.addEventListener('touchend', e => {
      const from = start;
      start = null;
      if (!from || !session || session.mode !== 'review') return;
      const t = e.changedTouches[0];
      const dx = t.clientX - from.x, dy = t.clientY - from.y;
      if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 2) return;
      if (dx > 0) prev(); else if (session.index < session.items.length) next();
    }, { passive: true });
  }

  function init() {
    Store.init();
    Speech.init();
    document.addEventListener('keydown', onKey);
    bindSwipe();
    showHome();
  }

  return {
    init, showHome, setTopic, renderHome, refresh,
    startReview, reveal, skip, prev, next, goSkipped, rate,
    startCopy, showNoteForm, saveNote, removeNote, downloadNotebook, downloadNotebookInk, startNote,
    copyMode, copyUndo, copyClear, copyFinger, copyReveal, copyDone, copyPrev, copyNext,
    startSpell, submitSpell, nextSpell, prevSpell, spellHint, spellSay, spellSkip,
    startSyn, submitSyn, nextSyn, prevSyn, synSkip,
    startProduce, submitProduce, nextProduce, produceSkip, showProductions,
    showPromote, showPromoteLoose, confirmPromote,
    startComplete, saveComplete, skipComplete, showExampleRef,
    showLibrary, showCard, toggleType, showAddCard, saveNewCard,
    showTools, downloadCSV, downloadProductions, downloadTemplate
  };
})();
