// 設定 / 每日推送 / 連續學習 / 進度頁 / 學習計畫。
// 單字本身的邏輯在 js/store.js + js/vocab.js。
// ============ 狀態 ============
let state = JSON.parse(localStorage.getItem('ielts-state') || '{}');
if (!state.vocab) state.vocab = {}; // { word: { status: 'known'|'learning', lastSeen, ease } }

function saveState() {
  localStorage.setItem('ielts-state', JSON.stringify(state));
}

// ============ Tab 切換 ============
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.module').forEach(m => m.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
  });
});

// ============ 設定 ============
if (!state.settings) state.settings = { notifEnabled: false, notifTime: '08:00' };
if (!state.streak) state.streak = 0;
if (!state.lastStudyDate) state.lastStudyDate = null;

function openSettings() {
  document.getElementById('notif-enabled').checked = state.settings.notifEnabled;
  document.getElementById('notif-time').value = state.settings.notifTime;
  document.getElementById('stat-streak').textContent = state.streak;
  document.getElementById('stat-last').textContent = state.lastStudyDate || '尚未開始';
  loadSpeechSettings();
  document.getElementById('settings-modal').classList.add('show');
}

// ============ 發音設定 ============
function loadSpeechSettings() {
  const section = document.getElementById('speech-section');
  if (!section) return;
  if (!Speech.supported()) {
    // 不支援的瀏覽器就把整段收掉，免得按了沒反應
    section.querySelectorAll('.setting-row, .btn').forEach(el => { el.style.display = 'none'; });
    document.getElementById('speech-status').textContent =
      '這個瀏覽器不支援語音合成，喇叭按鈕不會出現。iPhone 請用 Safari。';
    return;
  }
  const prefs = Speech.getPrefs();
  document.getElementById('speech-accent').value = prefs.accent;
  document.getElementById('speech-rate').value = prefs.rate;
  document.getElementById('speech-rate-label').textContent = prefs.rate.toFixed(1) + '×';
  document.getElementById('speech-auto').checked = prefs.autoExample;
}

function saveSpeechSettings() {
  if (!Speech.supported()) return;
  const prefs = Speech.setPrefs({
    accent: document.getElementById('speech-accent').value,
    rate: Number(document.getElementById('speech-rate').value),
    autoExample: document.getElementById('speech-auto').checked
  });
  document.getElementById('speech-rate-label').textContent = prefs.rate.toFixed(1) + '×';
}

function testSpeech() {
  // 試聽也順便當成 iOS 的「使用者動作」解鎖：第一次出聲一定要由點擊觸發
  if (!Speech.say('The government should mitigate the effects of climate change.')) {
    document.getElementById('speech-status').textContent =
      '念不出來 —— 檢查手機沒有靜音、音量有開，iPhone 請用 Safari 開啟。';
  }
}
function closeSettings(e) {
  if (e && e.target.id !== 'settings-modal' && e.type !== 'click') return;
  document.getElementById('settings-modal').classList.remove('show');
}
function saveSettings() {
  state.settings.notifEnabled = document.getElementById('notif-enabled').checked;
  state.settings.notifTime = document.getElementById('notif-time').value;
  saveState();
}
async function toggleNotification() {
  const enabled = document.getElementById('notif-enabled').checked;
  if (enabled) {
    if (!('Notification' in window)) {
      alert('你的瀏覽器不支援通知');
      document.getElementById('notif-enabled').checked = false;
      return;
    }
    if (Notification.permission === 'denied') {
      alert('瀏覽器已封鎖通知，請到瀏覽器設定中重新允許');
      document.getElementById('notif-enabled').checked = false;
      return;
    }
    if (Notification.permission !== 'granted') {
      const result = await Notification.requestPermission();
      if (result !== 'granted') {
        document.getElementById('notif-enabled').checked = false;
        return;
      }
    }
    new Notification('IELTS 學習助手', { body: '✓ 每日提醒已開啟' });
  }
  saveSettings();
}

// ============ 每日推送 ============
function checkNotificationTime() {
  if (!state.settings.notifEnabled) return;
  if (Notification.permission !== 'granted') return;
  const now = new Date();
  const today = now.toDateString();
  const [hh, mm] = (state.settings.notifTime || '08:00').split(':').map(Number);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const targetMin = hh * 60 + mm;
  if (nowMin === targetMin && state.lastNotifDate !== today) {
    fireDailyNotification();
    state.lastNotifDate = today;
    saveState();
  } else if (nowMin > targetMin && state.lastStudyDate !== today && state.lastNotifDate !== today) {
    fireDailyNotification();
    state.lastNotifDate = today;
    saveState();
  }
}
function fireDailyNotification() {
  const messages = [
    '今天還沒讀雅思喔 🪷',
    '5 分鐘也好，打開來看看 📚',
    '今天的單字在等你 ✨',
    '一日不練，三日生疏 🌱',
    '土星坐命的你，貴在堅持 🔥'
  ];
  new Notification('IELTS 學習提醒', {
    body: messages[Math.floor(Math.random() * messages.length)],
    silent: false
  });
}
setInterval(checkNotificationTime, 60000);
setTimeout(checkNotificationTime, 2000);

// ============ 連續學習 ============
function markStudiedToday() {
  const today = new Date().toDateString();
  if (state.lastStudyDate === today) return;
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (state.lastStudyDate === yesterday.toDateString()) {
    state.streak += 1;
  } else {
    state.streak = 1;
  }
  state.lastStudyDate = today;
  saveState();
  updateStreakDisplay();
}
function updateStreakDisplay() {
  const today = new Date().toDateString();
  if (state.streak >= 1) {
    document.getElementById('streak-banner').classList.add('show');
    document.getElementById('streak-num').textContent = state.streak;
    if (state.lastStudyDate !== today) {
      document.querySelector('.streak-banner .streak-text').innerHTML =
        `已連續 <strong>${state.streak}</strong> 天 · 今天還沒練習`;
    } else {
      document.querySelector('.streak-banner .streak-text').innerHTML =
        `連續學習 <strong>${state.streak}</strong> 天 ${state.streak >= 7 ? '🎉' : ''}`;
    }
  }
}

function resetAllData() {
  if (!confirm('確定要重置所有學習資料嗎？單字庫、排程進度、拼字紀錄、造句紀錄都會清空，此動作無法復原。')) return;
  localStorage.removeItem('ielts-state');
  Store.resetAll();          // 單字資料存在另一個 key，要一起清
  location.reload();
}

// ============ 活動紀錄 ============
if (!state.activityLog) state.activityLog = {};
function logActivity(type) {
  const today = new Date().toDateString();
  if (!state.activityLog[today]) state.activityLog[today] = { vocab: 0 };
  state.activityLog[today][type] = (state.activityLog[today][type] || 0) + 1;
  saveState();
}

// ============ 進度頁渲染 ============
function renderProgress() {
  Dashboard.renderProgressTop();

  // 近 7 天熱圖
  const heatmap = document.getElementById('heatmap');
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d);
  }
  heatmap.innerHTML = days.map(d => {
    const key = d.toDateString();
    const log = state.activityLog[key] || {};
    const count = log.vocab || 0;
    let lvl = 0;
    if (count >= 1 && count < 5) lvl = 1;
    else if (count >= 5 && count < 10) lvl = 2;
    else if (count >= 10 && count < 20) lvl = 3;
    else if (count >= 20) lvl = 4;
    const dateLabel = `${d.getMonth() + 1}/${d.getDate()}`;
    return `<div class="heatmap-day lvl-${lvl}" title="${count} 次練習">
      <div class="heatmap-date">${dateLabel}</div>
      <div class="heatmap-count">${count || ''}</div>
    </div>`;
  }).join('');
}

// ============ 學習計畫產生器 ============
function generateDailyPlan() {
  const today = new Date().toDateString();
  const tasks = { high: [], medium: [], low: [] };
  // 1. 連續紀錄即將斷
  if (state.lastStudyDate !== today && state.streak >= 1) {
    tasks.high.push({
      icon: '🔥',
      text: `保住 ${state.streak} 天連續紀錄（5 分鐘就行）`,
      minutes: 5,
      action: { tab: 'vocab', label: '去練單字' }
    });
  }

  // 2. 複習中字數過多
  const dueRecall = Store.dueCount('recall', { cardType: 'passive' });
  if (dueRecall >= 5) {
    tasks.high.push({
      icon: '\u27f3',
      text: `\u901a\u52e4\u8907\u7fd2 ${Math.min(dueRecall, 30)} \u5f35\u5230\u671f\u5361\u7247`,
      minutes: Math.ceil(Math.min(dueRecall, 30) * 0.4),
      action: { tab: 'vocab', label: '\u53bb\u8907\u7fd2' }
    });
  }
  const wrongSpelling = Store.spellingQueue({ onlyWrong: true }).length;
  if (wrongSpelling > 0) {
    tasks.high.push({
      icon: '\u270e',
      text: `\u62fc\u932f\u7684 ${wrongSpelling} \u500b\u5b57\u9084\u6c92\u6539\u6389`,
      minutes: Math.ceil(wrongSpelling * 0.5),
      action: { tab: 'vocab', label: '\u7df4\u62fc\u5b57' }
    });
  }

  // 4. 最弱主題補強
  const weak = Store.coverage('topic')
    .filter(row => row.total >= 3 && row.started / row.total < 0.5)
    .sort((a, b) => (a.started / a.total) - (b.started / b.total))[0];
  if (weak) {
    tasks.medium.push({
      icon: '📚',
      text: `學 5 個「${weak.name}」主題的新字（已學 ${weak.started}/${weak.total}）`,
      minutes: 5,
      action: { tab: 'vocab', topic: weak.name, label: `去${weak.name}` }
    });
  }

  // 4b. 沒有 active 字就先升級，有的話就練造句
  const types = Store.cardTypeCounts();
  if (types.active === 0) {
    tasks.medium.push({
      icon: '⬆',
      text: '把認讀已經穩的字升級成 active 主動詞彙',
      minutes: 3,
      action: { tab: 'vocab', label: '去升級' }
    });
  } else if (Store.productionsSince(Store.daysAgo(7)) === 0) {
    tasks.medium.push({
      icon: '✍',
      text: '本週還沒造過句 —— 用 active 字寫 5 句',
      minutes: 10,
      action: { tab: 'vocab', label: '去造句' }
    });
  }

  // 6. 鼓勵語
  let encouragement = '';
  if (state.streak >= 7) encouragement = `🎉 連續 ${state.streak} 天了，土星坐命的你正在發揮優勢`;
  else if (state.streak >= 3) encouragement = `🌱 連續 ${state.streak} 天——習慣正在形成`;
  else if (state.lastStudyDate === today) encouragement = `✓ 今天已經練過，現在的任何學習都是賺到的`;

  const totalMinutes = [...tasks.high, ...tasks.medium, ...tasks.low].reduce((s, t) => s + t.minutes, 0);
  return { tasks, totalMinutes, encouragement };
}

function renderDailyPlan() {
  const today = new Date();
  const weekdays = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
  document.getElementById('plan-date').textContent =
    `${today.getFullYear()}/${today.getMonth() + 1}/${today.getDate()} · ${weekdays[today.getDay()]}`;

  const plan = generateDailyPlan();
  const container = document.getElementById('daily-plan');

  if (plan.tasks.high.length === 0 && plan.tasks.medium.length === 0 && plan.tasks.low.length === 0) {
    container.innerHTML = `<div class="plan-empty" style="text-align:center;padding:20px;color:var(--success);font-size:15px;">🎉 今天都做完了，去散步吧</div>`;
    return;
  }

  const tierHtml = (title, tasks) => {
    if (tasks.length === 0) return '';
    return `<div class="plan-tier">
      <div class="plan-tier-title">${title}</div>
      ${tasks.map(t => `
        <div class="plan-task">
          <span class="plan-task-icon">${t.icon}</span>
          <span>${t.text}</span>
          <button class="plan-task-action" onclick="goToTab('${t.action.tab}'${t.action.topic ? `, '${t.action.topic}'` : ''})">${t.action.label} →</button>
        </div>
      `).join('')}
    </div>`;
  };

  let html = '';
  html += tierHtml('🔴 高優先', plan.tasks.high);
  html += tierHtml('🟡 進度補強', plan.tasks.medium);
  html += tierHtml('🟢 維持節奏', plan.tasks.low);
  html += `<div class="plan-footer">預計總時長：~${plan.totalMinutes} 分鐘</div>`;
  if (plan.encouragement) html += `<div class="plan-encouragement">${plan.encouragement}</div>`;

  container.innerHTML = html;
}

function goToTab(tab, topic) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.module').forEach(m => m.classList.remove('active'));
  document.querySelector(`.tab-btn[data-tab="${tab}"]`).classList.add('active');
  document.getElementById(tab).classList.add('active');
  if (tab === 'vocab' && topic) {
    document.querySelectorAll('.topic-btn').forEach(b => b.classList.remove('active'));
    const tBtn = document.querySelector(`.topic-btn[data-topic="${topic}"]`);
    if (tBtn) { tBtn.classList.add('active'); tBtn.click(); }
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// 切換到進度頁時，刷新進度 + 學習計畫
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.tab === 'progress') {
      renderProgress();
      renderDailyPlan();
    }
  });
});

// ============ 初始化 ============
Vocab.init();
updateStreakDisplay();

// ============ PWA Service Worker ============
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('[PWA] Service Worker 已註冊', reg.scope))
      .catch(err => console.warn('[PWA] 註冊失敗（本機檔案模式不支援，需透過 http/https 開啟）', err));
  });
}
