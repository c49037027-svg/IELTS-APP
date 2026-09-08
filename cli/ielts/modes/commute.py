"""模式 A：通勤複習（passive review）。

單鍵操作 —— 空白鍵翻面、1/2/3/4 評分、s 跳過、q 離開。
背面固定顯示四個維度（例句 / 搭配 / 字根 / 同義），不出現中文對照。
"""

from __future__ import annotations

from .. import render, repository as repo, settings, srs
from ..context import AppContext
from ..db import TRACK_RECALL
from ..errors import QuitSession
from ..models import SessionSummary

REVEAL_KEYS = (" ", "\n")
RATING_KEYS = {"1": srs.AGAIN, "2": srs.HARD, "3": srs.GOOD, "4": srs.EASY}


def run(
    ctx: AppContext,
    *,
    limit: int = 30,
    topic: str | None = None,
    category: str | None = None,
    include_active: bool = False,
    show_zh: bool | None = None,
) -> SessionSummary:
    ui = ctx.ui
    # None = 照設定走（ielts config --zh on/off）；--zh / --no-zh 才覆寫這一次
    if show_zh is None:
        show_zh = settings.show_zh(ctx.conn)
    items = repo.due_items(
        ctx.conn,
        TRACK_RECALL,
        today=ctx.today,
        limit=limit,
        topic=topic,
        category=category,
        card_type=None if include_active else "passive",
        # 背面至少要有東西可看就行。例句還沒自己寫的卡片，背面還有
        # 搭配詞、字根、同義詞、中文 —— 那已經是一張夠用的卡了。
        require_any_fields=("example_sentence", "collocations", "root_analysis", "synonyms"),
    )
    summary = SessionSummary(mode="通勤複習", total=len(items))

    if not items:
        ui.blank()
        ui.ok("今天沒有到期的卡片了 🎉")
        hidden = repo.incomplete_count(ctx.conn)
        if hidden:
            ui.dim(f"（有 {hidden} 張卡缺例句被略過，可用 `ielts complete` 補完）")
        return summary

    ui.rule(f"通勤複習 · {len(items)} 張")
    ui.dim("空白鍵 = 看例句 ｜ 1 Again  2 Hard  3 Good  4 Easy ｜ s 跳過 ｜ q 離開")
    ui.blank()

    try:
        for index, item in enumerate(items, start=1):
            card = item.card
            head = f"[{index}/{len(items)}]"
            ui.panel(render.front_lines(card), title=head, style="word")

            key = ui.key("  空白鍵翻面 › ", allowed=[" ", "\n", "s"])
            if key == "s":
                summary.skipped += 1
                ui.dim("  已跳過")
                ui.blank()
                continue

            ui.panel(render.back_lines(card, show_zh=show_zh), title="", style="dim")
            rating_key = ui.key("  評分 1-4 › ", allowed=list(RATING_KEYS) + ["s"])
            if rating_key == "s":
                summary.skipped += 1
                ui.blank()
                continue

            rating = RATING_KEYS[rating_key]
            state = repo.grade(ctx.conn, item, rating, today=ctx.today, rng=ctx.rng)
            summary.done += 1
            summary.ratings[rating] = summary.ratings.get(rating, 0) + 1
            ui.dim(f"  {srs.RATING_SHORT[rating]} → {srs.describe_next(state, ctx.today)}")
            ui.blank()
    except QuitSession:
        ui.blank()
        ui.dim("已離開，進度都存好了。")

    _print_summary(ctx, summary)
    return summary


def _print_summary(ctx: AppContext, summary: SessionSummary) -> None:
    ui = ctx.ui
    if summary.done == 0 and summary.skipped == 0:
        return
    ui.rule("本次結果")
    parts = [f"複習 {summary.done} 張"]
    if summary.skipped:
        parts.append(f"跳過 {summary.skipped} 張")
    again = summary.ratings.get(srs.AGAIN, 0)
    if again:
        parts.append(f"忘記 {again} 張（明天會再出現）")
    ui.print(" ｜ ".join(parts))
    remaining = repo.due_count(
        ctx.conn, TRACK_RECALL, today=ctx.today, card_type="passive"
    )
    if remaining:
        ui.dim(f"還有 {remaining} 張 passive 卡片到期，隨時可以再跑一輪。")
