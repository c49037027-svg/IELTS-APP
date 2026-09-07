"""同義詞群測驗。

雅思聽力閱讀的核心機制是同義替換：題目講 A，錄音/文章講 B。
給一個字，要你列出 2-3 個同義詞，程式比對卡片上的 synonyms 欄位。
比對容忍大小寫與詞形變化（reduce / reducing 算同一個）。
"""

from __future__ import annotations

from .. import repository as repo, srs, textutil
from ..context import AppContext
from ..errors import QuitSession
from ..models import SessionSummary


def run(
    ctx: AppContext, *, limit: int = 15, topic: str | None = None, target: int = 2
) -> SessionSummary:
    ui = ctx.ui
    items = repo.synonym_pool(ctx.conn, today=ctx.today, limit=limit, topic=topic)
    summary = SessionSummary(mode="同義詞測驗", total=len(items))

    if not items:
        ui.blank()
        ui.ok("今天沒有到期的同義詞題目了 🎉")
        ui.dim("（題目只會出有存兩個以上同義詞的卡片）")
        return summary

    ui.rule(f"同義詞測驗 · {len(items)} 題")
    ui.dim(f"列出至少 {target} 個同義詞，用逗號分隔 ｜ Enter 跳過 ｜ 輸入 :q 離開")
    ui.blank()

    try:
        for index, item in enumerate(items, start=1):
            card = item.card
            expected = card.synonym_list
            lines = [f"單字   {card.label}"]
            if card.topic or card.category:
                lines.append(
                    "分類   " + " · ".join(t for t in (card.category, card.topic) if t)
                )
            ui.panel(lines, title=f"[{index}/{len(items)}]", style="word")

            raw = ui.ask(f"  {target} 個以上同義詞 ›", allow_empty=True)
            if not raw:
                summary.skipped += 1
                ui.dim("  跳過 → " + " / ".join(expected))
                ui.blank()
                continue

            answers = textutil.split_answers(raw)
            matched, missed, extras = textutil.match_synonyms(answers, expected)
            hit = len(matched)

            if hit:
                ui.ok(f"  ✓ 答對 {hit}/{len(expected)}：" + ", ".join(m[1] for m in matched))
            else:
                ui.bad("  ✗ 沒有對上卡片裡的同義詞")
            if missed:
                ui.print("    還有：" + " / ".join(missed), "hint")
            if extras:
                ui.dim(
                    "    這些不在卡片清單裡：" + ", ".join(extras)
                    + "（若你確定是對的，可用 `ielts complete` 補進去）"
                )

            rating = _rating_for(hit, target)
            state = repo.grade(ctx.conn, item, rating, today=ctx.today, rng=ctx.rng)
            summary.done += 1
            summary.ratings[rating] = summary.ratings.get(rating, 0) + 1
            if hit >= target:
                summary.correct += 1
            else:
                summary.wrong += 1
            ui.dim(f"    {srs.RATING_SHORT[rating]} · {srs.describe_next(state, ctx.today)}")
            ui.blank()
    except QuitSession:
        ui.blank()
        ui.dim("已離開，作答紀錄都存好了。")

    if summary.done:
        ui.rule("本次結果")
        rate = summary.correct / summary.done * 100
        ui.print(
            f"作答 {summary.done} 題 ｜ 達標 {summary.correct} ｜ 未達標 {summary.wrong} "
            f"｜ 達標率 {rate:.0f}%"
        )
    return summary


def _rating_for(hit: int, target: int) -> int:
    if hit == 0:
        return srs.AGAIN
    if hit < target:
        return srs.HARD
    if hit > target:
        return srs.EASY
    return srs.GOOD
