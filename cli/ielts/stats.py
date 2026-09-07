"""統計儀表板。"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from . import repository as repo
from .context import AppContext
from .db import TRACK_RECALL, TRACK_SPELLING, TRACK_SYNONYM


def current_streak(days: set[str], today: date | None = None) -> int:
    """連續學習天數。今天還沒學不會馬上歸零（從昨天起算）。"""
    today = today or date.today()
    if not days:
        return 0
    cursor = today
    if cursor.isoformat() not in days:
        cursor = today - timedelta(days=1)
        if cursor.isoformat() not in days:
            return 0
    streak = 0
    while cursor.isoformat() in days:
        streak += 1
        cursor -= timedelta(days=1)
    return streak


def longest_streak(days: set[str]) -> int:
    if not days:
        return 0
    ordered = sorted(date.fromisoformat(d) for d in days)
    best = run = 1
    for prev, current in zip(ordered, ordered[1:]):
        run = run + 1 if (current - prev).days == 1 else 1
        best = max(best, run)
    return best


def collect(ctx: AppContext) -> dict[str, Any]:
    conn, today = ctx.conn, ctx.today
    week_ago = today - timedelta(days=6)
    days = repo.activity_days(conn)
    types = repo.card_type_counts(conn)
    total_cards = sum(types.values())

    return {
        "today": today,
        "total_cards": total_cards,
        "types": types,
        "incomplete": repo.incomplete_count(conn),
        "due": {
            TRACK_RECALL: repo.due_count(conn, TRACK_RECALL, today=today, card_type="passive"),
            TRACK_SPELLING: repo.due_count(conn, TRACK_SPELLING, today=today),
            TRACK_SYNONYM: repo.due_count(conn, TRACK_SYNONYM, today=today),
        },
        "due_active_recall": repo.due_count(
            conn, TRACK_RECALL, today=today, card_type="active"
        ),
        "reviews_today": repo.reviews_between(conn, today, today),
        "reviews_week": repo.reviews_between(conn, week_ago, today),
        "new_learned_week": repo.new_cards_learned(conn, week_ago),
        "cards_added_week": repo.cards_added_since(conn, week_ago),
        "productions_week": repo.productions_since(conn, week_ago),
        "words_used": repo.distinct_words_used(conn),
        "spelling_all": repo.spelling_accuracy(conn),
        "spelling_30d": repo.spelling_accuracy(conn, days=30),
        "streak": current_streak(days, today),
        "longest_streak": longest_streak(days),
        "active_days": len(days),
        "ratings_week": repo.rating_breakdown(conn, since=week_ago),
    }


def render(ctx: AppContext, *, full: bool = False) -> None:
    ui = ctx.ui
    data = collect(ctx)

    if data["total_cards"] == 0:
        ui.hint("單字庫是空的。跑 `ielts init` 灌入 30 個範例字，或用 `ielts import` 匯入 CSV。")
        return

    ui.rule(f"IELTS 學習儀表板 · {data['today'].isoformat()}")

    ui.panel(
        [
            f"今天待複習   認讀 {data['due'][TRACK_RECALL]} ｜ 拼字 {data['due'][TRACK_SPELLING]} "
            f"｜ 同義詞 {data['due'][TRACK_SYNONYM]}",
            f"今日已複習   {data['reviews_today']} 次",
            f"連續學習     {data['streak']} 天（最長 {data['longest_streak']} 天，累計 {data['active_days']} 天）",
        ],
        title="今天",
        style="word",
    )

    passive = data["types"].get("passive", 0)
    active = data["types"].get("active", 0)
    total = data["total_cards"]
    ui.blank()
    ui.title("詞彙庫")
    ui.print(f"  總卡片 {total} 張　（不完整 {data['incomplete']} 張）")
    ui.bar("  passive 被動", passive, total, suffix=f"{passive} 張 ({passive / total * 100:.0f}%)")
    ui.bar("  active 主動", active, total, suffix=f"{active} 張 ({active / total * 100:.0f}%)")
    ui.print(f"  實際造句用過 {data['words_used']} 個字")

    ui.blank()
    ui.title("本週（近 7 天）")
    ui.print(
        f"  複習 {data['reviews_week']} 次 ｜ 新學 {data['new_learned_week']} 字 "
        f"｜ 新增卡片 {data['cards_added_week']} 張 ｜ 造句 {data['productions_week']} 句"
    )

    spelling = data["spelling_all"]
    recent = data["spelling_30d"]
    ui.blank()
    ui.title("拼字準確度")
    if spelling["total"] == 0:
        ui.dim("  還沒有拼字紀錄，跑 `ielts spell` 開始練。")
    else:
        ui.print(
            f"  全部 {spelling['correct']}/{spelling['total']} 正確 "
            f"（錯誤率 {(1 - spelling['accuracy']) * 100:.1f}%）"
        )
        if recent["total"]:
            ui.print(
                f"  近 30 天 {recent['correct']}/{recent['total']} 正確 "
                f"（錯誤率 {(1 - recent['accuracy']) * 100:.1f}%）"
            )
        errors = repo.spelling_error_list(ctx.conn, limit=20 if full else 5)
        if errors:
            ui.table(
                ["單字", "錯/總", "錯誤率", "主題"],
                [
                    [
                        r["word"],
                        f"{r['wrong']}/{r['total']}",
                        f"{r['wrong'] / r['total'] * 100:.0f}%",
                        r["topic"] or "-",
                    ]
                    for r in errors
                ],
                title=f"  最常拼錯的字（前 {len(errors)}）",
            )

    _coverage(ctx, "category", "分類覆蓋（AWL / 話題字 / Task1 / 口說）")
    _coverage(ctx, "topic", "主題覆蓋")

    if full:
        ui.blank()
        ui.title("本週評分分布")
        ratings = data["ratings_week"]
        total_ratings = sum(ratings.values())
        if total_ratings:
            names = {1: "Again", 2: "Hard", 3: "Good", 4: "Easy"}
            for rating, count in ratings.items():
                ui.bar(f"  {names[rating]}", count, total_ratings, suffix=str(count))
        else:
            ui.dim("  本週還沒有評分紀錄。")

    ui.blank()
    _next_action(ctx, data)


def _coverage(ctx: AppContext, column: str, title: str) -> None:
    rows = repo.counts_by(ctx.conn, column)
    if not rows:
        return
    ctx.ui.blank()
    ctx.ui.title(title)
    for row in rows:
        total = int(row["total"])
        started = int(row["started"] or 0)
        mature = int(row["mature"] or 0)
        ctx.ui.bar(
            f"  {row['name']}",
            started,
            total,
            suffix=f"{started}/{total} 已學 · {mature} 熟",
        )


def _next_action(ctx: AppContext, data: dict[str, Any]) -> None:
    """依目前狀態建議下一步該做什麼，通勤時不用自己想。"""
    ui = ctx.ui
    suggestions: list[str] = []
    if data["due"][TRACK_RECALL]:
        suggestions.append(f"ielts review　　（{data['due'][TRACK_RECALL]} 張認讀到期）")
    if data["due"][TRACK_SPELLING]:
        suggestions.append(f"ielts spell　　 （{data['due'][TRACK_SPELLING]} 題拼字到期）")
    if data["due"][TRACK_SYNONYM]:
        suggestions.append(f"ielts syn　　　 （{data['due'][TRACK_SYNONYM]} 題同義詞到期）")
    if data["types"].get("active", 0):
        suggestions.append("ielts produce　 （用 active 字造句）")
    else:
        suggestions.append("ielts promote　 （把熟的字升級成 active）")
    if data["incomplete"]:
        suggestions.append(f"ielts complete　（{data['incomplete']} 張卡待補完）")
    ui.panel(suggestions, title="下一步", style="ok")
