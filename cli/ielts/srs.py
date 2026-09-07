"""SM-2 間隔重複演算法。

刻意寫成無副作用的純函式（不碰資料庫、不讀時間），方便測試與之後替換成
其他排程器（例如 FSRS）。呼叫端負責把結果寫回 srs_state。
"""

from __future__ import annotations

import random
from dataclasses import replace
from datetime import date, timedelta

from .models import SrsState, now_iso

AGAIN, HARD, GOOD, EASY = 1, 2, 3, 4
RATINGS = (AGAIN, HARD, GOOD, EASY)

RATING_LABELS = {
    AGAIN: "Again 忘了",
    HARD: "Hard 有點吃力",
    GOOD: "Good 想得起來",
    EASY: "Easy 太簡單",
}

RATING_SHORT = {AGAIN: "Again", HARD: "Hard", GOOD: "Good", EASY: "Easy"}

MIN_EASE = 1.3
MAX_EASE = 3.0
DEFAULT_EASE = 2.5
MAX_INTERVAL_DAYS = 365 * 2

#: 首次答對 1 天後再見；第二次答對跳到 6 天（SM-2 經典設定）。
FIRST_INTERVAL = 1.0
SECOND_INTERVAL = 6.0

#: 忘記後不是砍回 0，而是回到 1 天，並保留一點既有熟悉度。
LAPSE_INTERVAL = 1.0

HARD_MULTIPLIER = 1.2
EASY_BONUS = 1.3

EASE_DELTA = {AGAIN: -0.20, HARD: -0.15, GOOD: 0.0, EASY: 0.15}

#: 間隔 >= 這個天數才套用抖動，避免大量卡片集中在同一天到期。
JITTER_MIN_INTERVAL = 4.0
JITTER_RATIO = 0.05


def clamp_ease(value: float) -> float:
    return max(MIN_EASE, min(MAX_EASE, round(value, 4)))


def validate_rating(rating: int) -> int:
    if rating not in RATINGS:
        raise ValueError(f"評分必須是 1-4，收到 {rating!r}")
    return rating


def next_interval(state: SrsState, rating: int) -> float:
    """依評分算出新的間隔（天）。不含抖動。"""
    validate_rating(rating)
    interval = max(0.0, float(state.interval))
    ease = clamp_ease(state.ease_factor)

    if rating == AGAIN:
        return LAPSE_INTERVAL

    if state.review_count == 0 or interval <= 0:
        # 第一次答對
        return FIRST_INTERVAL if rating != EASY else SECOND_INTERVAL

    if interval < SECOND_INTERVAL and state.review_count == 1:
        # 第二次答對，進入 6 天
        base = SECOND_INTERVAL
        if rating == HARD:
            base = max(FIRST_INTERVAL + 1, interval * HARD_MULTIPLIER)
        elif rating == EASY:
            base = SECOND_INTERVAL * EASY_BONUS
        return base

    if rating == HARD:
        return interval * HARD_MULTIPLIER
    if rating == GOOD:
        return interval * ease
    return interval * ease * EASY_BONUS


def apply_jitter(interval: float, rng: random.Random | None = None) -> float:
    """對較長的間隔加 ±5% 隨機抖動，讓到期日自然分散。"""
    if interval < JITTER_MIN_INTERVAL:
        return interval
    r = rng or random
    factor = 1.0 + r.uniform(-JITTER_RATIO, JITTER_RATIO)
    return interval * factor


def schedule(
    state: SrsState,
    rating: int,
    today: date | None = None,
    rng: random.Random | None = None,
    reviewed_at: str | None = None,
) -> SrsState:
    """回傳評分後的新排程狀態（不修改傳入的 state）。"""
    validate_rating(rating)
    today = today or date.today()

    raw = next_interval(state, rating)
    if rating != AGAIN:
        raw = apply_jitter(raw, rng)
    interval = max(1.0, min(float(MAX_INTERVAL_DAYS), round(raw, 3)))

    ease = clamp_ease(state.ease_factor + EASE_DELTA[rating])
    lapses = state.lapse_count + (1 if rating == AGAIN else 0)

    return replace(
        state,
        interval=interval,
        ease_factor=ease,
        due_date=(today + timedelta(days=int(round(interval)))).isoformat(),
        review_count=state.review_count + 1,
        lapse_count=lapses,
        last_reviewed=reviewed_at or now_iso(),
    )


def new_state(card_id: int, track: str, today: date | None = None) -> SrsState:
    """建立一張卡在某個 track 上的初始狀態（今天到期）。"""
    today = today or date.today()
    return SrsState(
        card_id=card_id,
        track=track,
        interval=0.0,
        ease_factor=DEFAULT_EASE,
        due_date=today.isoformat(),
        review_count=0,
        lapse_count=0,
        last_reviewed=None,
    )


def describe_next(state: SrsState, today: date | None = None) -> str:
    """把下次到期時間講成人話，用在評分後的即時回饋。"""
    today = today or date.today()
    due = state.due
    if not due:
        return "下次：未排程"
    days = (due - today).days
    if days <= 0:
        return "下次：今天稍後"
    if days == 1:
        return "下次：明天"
    if days < 30:
        return f"下次：{days} 天後"
    months = days / 30.0
    return f"下次：約 {months:.1f} 個月後"


def maturity(state: SrsState) -> str:
    """卡片成熟度分級，統計用。"""
    if state.review_count == 0:
        return "new"
    if state.interval < 21:
        return "learning"
    return "mature"
