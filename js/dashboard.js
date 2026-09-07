// 單字統計儀表板：渲染到「進度」分頁。
const Dashboard = (() => {
  const el = id => document.getElementById(id);
  const esc = s => String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function bar(label, value, total, suffix) {
    const pct = total > 0 ? Math.round(value / total * 100) : 0;
    return `<div class="topic-progress-row">
      <div class="topic-progress-header">
        <span class="topic-progress-name">${esc(label)}</span>
        <span class="topic-progress-stat">${esc(suffix || `${value}/${total} · ${pct}%`)}</span>
      </div>
      <div class="progress-bar"><div class="progress-bar-fill" style="width:${pct}%"></div></div>
    </div>`;
  }

  // 對應原本進度頁的三個總覽數字，改用新的排程資料。
  function renderProgressTop() {
    const cards = Store.listCards();
    let mature = 0, learning = 0, untouched = 0;
    cards.forEach(c => {
      const s = Store.getSrs(c.id, 'recall');
      if (s.reviews === 0) untouched += 1;
      else if (s.interval >= 21) mature += 1;
      else learning += 1;
    });
    if (el('ov-known')) el('ov-known').textContent = mature;
    if (el('ov-learning')) el('ov-learning').textContent = learning;
    if (el('ov-untouched')) el('ov-untouched').textContent = untouched;

    const topics = Store.coverage('topic');
    if (el('topic-progress')) {
      el('topic-progress').innerHTML = topics.length
        ? topics.map(r => bar(r.name, r.started, r.total, `${r.started}/${r.total} 已學 · ${r.mature} 熟`)).join('')
        : '<div class="empty-state">還沒有卡片</div>';
    }
    renderVocabDashboard();
  }

  function renderVocabDashboard() {
    const target = el('vocab-dashboard');
    if (!target) return;

    const today = Store.today();
    const weekAgo = Store.daysAgo(6);
    const types = Store.cardTypeCounts();
    const total = types.passive + types.active;
    const spelling = Store.spellingAccuracy();
    const recent = Store.spellingAccuracy(30);
    const errors = Store.spellingErrorList(20);
    const categories = Store.coverage('category');

    const dueRecall = Store.dueCount('recall', { cardType: 'passive', requireExample: true });
    const dueSpell = Store.spellingQueue({}).length;
    const dueSyn = Store.dueItems('synonym', { requireSynonyms: true }).length;

    const errorRows = errors.length ? errors.map(r => `
      <div class="score-row">
        <span class="title">${esc(r.card.word)}</span>
        <span class="score ${r.wrong / r.total >= 0.5 ? 'poor' : ''}">${r.wrong}/${r.total} · ${Math.round(r.wrong / r.total * 100)}%</span>
      </div>`).join('') : '<div class="empty-state">還沒有拼字錯誤紀錄</div>';

    target.innerHTML = `
      <div class="card">
        <div class="section-title">📅 今天待複習</div>
        <div class="progress-overview">
          <div class="overview-card"><div class="overview-num">${dueRecall}</div><div class="overview-label">認讀</div></div>
          <div class="overview-card"><div class="overview-num">${dueSpell}</div><div class="overview-label">拼字</div></div>
          <div class="overview-card"><div class="overview-num">${dueSyn}</div><div class="overview-label">同義詞</div></div>
        </div>
        <div class="hint-text">連續學習 ${Store.streak()} 天（最長 ${Store.longestStreak()} 天，累計 ${Store.activityDays().size} 天）</div>
      </div>

      <div class="card">
        <div class="section-title">📚 詞彙庫</div>
        ${total ? bar('passive 被動', types.passive, total, `${types.passive} 張`) : ''}
        ${total ? bar('active 主動', types.active, total, `${types.active} 張`) : ''}
        <div class="hint-text">
          總卡片 ${total} 張 ｜ 不完整 ${Store.incompleteCount()} 張 ｜ 實際造句用過 ${Store.distinctWordsUsed()} 個字
        </div>
      </div>

      <div class="card">
        <div class="section-title">🗓 本週（近 7 天）</div>
        <div class="hint-text">
          複習 ${Store.reviewsSince(weekAgo)} 次 ｜ 新學 ${Store.newCardsLearned(weekAgo)} 字 ｜
          新增卡片 ${Store.cardsAddedSince(weekAgo)} 張 ｜ 造句 ${Store.productionsSince(weekAgo)} 句 ｜
          今日已複習 ${Store.reviewsOn(today)} 次
        </div>
      </div>

      <div class="card">
        <div class="section-title">✍️ 拼字準確度</div>
        ${spelling.total === 0
          ? '<div class="hint-text">還沒有拼字紀錄，去單字頁跑「拼字練習」。</div>'
          : `<div class="hint-text">
              全部 ${spelling.correct}/${spelling.total} 正確（錯誤率 ${((1 - spelling.accuracy) * 100).toFixed(1)}%）
              ${recent.total ? `｜ 近 30 天錯誤率 ${((1 - recent.accuracy) * 100).toFixed(1)}%` : ''}
            </div>
            <div class="section-subtitle">最常拼錯的字（前 ${errors.length}）</div>
            ${errorRows}`}
      </div>

      <div class="card">
        <div class="section-title">🏷 分類覆蓋</div>
        ${categories.length
          ? categories.map(r => bar(r.name, r.started, r.total, `${r.started}/${r.total} 已學 · ${r.mature} 熟`)).join('')
          : '<div class="empty-state">還沒有卡片</div>'}
      </div>`;
  }

  return { renderProgressTop, renderVocabDashboard };
})();
