// 日期工具：全程用 YYYY-MM-DD 字串，避免時區把到期日算歪。
const Dates = (() => {
  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function nowISO() {
    const d = new Date();
    return `${todayISO()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  function parse(iso) {
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  }
  function format(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function addDays(iso, days) {
    const d = parse(iso);
    d.setDate(d.getDate() + days);
    return format(d);
  }
  function diffDays(isoA, isoB) {
    return Math.round((parse(isoA) - parse(isoB)) / 86400000);
  }
  return { todayISO, nowISO, parse, format, addDays, diffDays };
})();

// SM-2 間隔重複演算法 —— 與 cli/ielts/srs.py 同一組參數，兩邊行為一致。
// 純函式，不碰 DOM 也不碰 localStorage。
const SRS = (() => {
  const AGAIN = 1, HARD = 2, GOOD = 3, EASY = 4;
  const RATINGS = [AGAIN, HARD, GOOD, EASY];

  const RATING_LABELS = {
    1: 'Again 忘了',
    2: 'Hard 有點吃力',
    3: 'Good 想得起來',
    4: 'Easy 太簡單'
  };
  const RATING_SHORT = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' };

  const MIN_EASE = 1.3, MAX_EASE = 3.0, DEFAULT_EASE = 2.5;
  const MAX_INTERVAL_DAYS = 365 * 2;
  const FIRST_INTERVAL = 1, SECOND_INTERVAL = 6, LAPSE_INTERVAL = 1;
  const HARD_MULTIPLIER = 1.2, EASY_BONUS = 1.3;
  const EASE_DELTA = { 1: -0.20, 2: -0.15, 3: 0, 4: 0.15 };
  const JITTER_MIN_INTERVAL = 4, JITTER_RATIO = 0.05;

  const clampEase = v => Math.max(MIN_EASE, Math.min(MAX_EASE, Math.round(v * 10000) / 10000));

  function newState() {
    return {
      interval: 0,
      ease: DEFAULT_EASE,
      due: Dates.todayISO(),
      reviews: 0,
      lapses: 0,
      lastReviewed: null
    };
  }

  function nextInterval(state, rating) {
    if (!RATINGS.includes(rating)) throw new Error('評分必須是 1-4');
    const interval = Math.max(0, state.interval || 0);
    const ease = clampEase(state.ease || DEFAULT_EASE);

    if (rating === AGAIN) return LAPSE_INTERVAL;
    if (state.reviews === 0 || interval <= 0) {
      return rating === EASY ? SECOND_INTERVAL : FIRST_INTERVAL;
    }
    if (interval < SECOND_INTERVAL && state.reviews === 1) {
      if (rating === HARD) return Math.max(FIRST_INTERVAL + 1, interval * HARD_MULTIPLIER);
      if (rating === EASY) return SECOND_INTERVAL * EASY_BONUS;
      return SECOND_INTERVAL;
    }
    if (rating === HARD) return interval * HARD_MULTIPLIER;
    if (rating === GOOD) return interval * ease;
    return interval * ease * EASY_BONUS;
  }

  // 4 天以上的間隔加 ±5% 抖動，讓到期日自然分散，不會全擠在同一天。
  function applyJitter(interval) {
    if (interval < JITTER_MIN_INTERVAL) return interval;
    return interval * (1 + (Math.random() * 2 - 1) * JITTER_RATIO);
  }

  function schedule(state, rating, today) {
    const base = state || newState();
    let raw = nextInterval(base, rating);
    if (rating !== AGAIN) raw = applyJitter(raw);
    const interval = Math.max(1, Math.min(MAX_INTERVAL_DAYS, Math.round(raw * 1000) / 1000));
    return {
      interval,
      ease: clampEase((base.ease || DEFAULT_EASE) + EASE_DELTA[rating]),
      due: Dates.addDays(today || Dates.todayISO(), Math.round(interval)),
      reviews: (base.reviews || 0) + 1,
      lapses: (base.lapses || 0) + (rating === AGAIN ? 1 : 0),
      lastReviewed: Dates.nowISO()
    };
  }

  function describeNext(state, today) {
    const days = Dates.diffDays(state.due, today || Dates.todayISO());
    if (days <= 0) return '下次：今天稍後';
    if (days === 1) return '下次：明天';
    if (days < 30) return `下次：${days} 天後`;
    return `下次：約 ${(days / 30).toFixed(1)} 個月後`;
  }

  function maturity(state) {
    if (!state || state.reviews === 0) return 'new';
    return state.interval < 21 ? 'learning' : 'mature';
  }

  return {
    AGAIN, HARD, GOOD, EASY, RATINGS, RATING_LABELS, RATING_SHORT,
    DEFAULT_EASE, MIN_EASE, MAX_INTERVAL_DAYS,
    newState, nextInterval, applyJitter, schedule, describeNext, maturity
  };
})();
