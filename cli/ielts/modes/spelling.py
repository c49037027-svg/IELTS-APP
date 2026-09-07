"""模式 B：拼字練習（spelling drill）。

例句挖空 + 中文提示 → 打出完整拼字 → 逐字元比對。
拼錯的字會寫進錯誤清單，並把拼字排程壓回明天，下次優先出現。
"""

from __future__ import annotations

from .. import render, repository as repo, srs, textutil
from ..context import AppContext
from ..errors import QuitSession
from ..models import SessionSummary


def run(
    ctx: AppContext,
    *,
    limit: int = 20,
    topic: str | None = None,
    only_wrong: bool = False,
) -> SessionSummary:
    ui = ctx.ui
    items = repo.spelling_queue(
        ctx.conn, today=ctx.today, limit=limit, topic=topic, only_wrong=only_wrong
    )
    summary = SessionSummary(mode="拼字練習", total=len(items))

    if not items:
        ui.blank()
        if only_wrong:
            ui.ok("錯誤清單是空的，拼字目前沒有欠帳 🎉")
        else:
            ui.ok("今天沒有到期的拼字練習了 🎉")
        return summary

    ui.rule(f"拼字練習 · {len(items)} 題")
    ui.dim("直接打出完整拼字 ｜ 輸入 ? 看提示 ｜ 直接 Enter 跳過 ｜ 輸入 :q 離開")
    ui.blank()

    try:
        for index, item in enumerate(items, start=1):
            card = item.card
            ui.panel(
                render.spelling_prompt_lines(card),
                title=f"[{index}/{len(items)}]",
                style="hint",
            )
            answer = ui.ask("  拼字 ›", allow_empty=True)

            if answer == "?":
                ui.hint("  提示：" + textutil.letter_skeleton(card.word))
                answer = ui.ask("  拼字 ›", allow_empty=True)

            if not answer:
                summary.skipped += 1
                ui.dim(f"  跳過（答案：{card.word}）")
                ui.blank()
                continue

            correct = textutil.spelling_correct(card.word, answer)
            repo.record_spelling(ctx.conn, card.id or 0, answer, correct)

            if correct:
                summary.correct += 1
                summary.done += 1
                state = repo.grade(
                    ctx.conn, item, srs.GOOD, today=ctx.today, rng=ctx.rng
                )
                ui.ok(f"  ✓ 正確　{srs.describe_next(state, ctx.today)}")
            else:
                summary.wrong += 1
                summary.done += 1
                expected_marked, actual_marked = textutil.format_diff(card.word, answer)
                distance = textutil.edit_distance(card.word, answer)
                ui.bad(f"  ✗ 你打的：{actual_marked}")
                ui.print(f"    正確的：{expected_marked}", "ok")
                if distance == 1:
                    ui.dim("    只差 1 個字母 —— 這種最值得記下來。")
                repo.grade(ctx.conn, item, srs.AGAIN, today=ctx.today, rng=ctx.rng)
                ui.dim("    已加入錯誤清單，明天優先出現。")
                retype = ui.ask("    再打一次正確拼字（Enter 跳過）›", allow_empty=True)
                if retype and textutil.spelling_correct(card.word, retype):
                    ui.ok("    ✓ 這次對了")
                elif retype:
                    ui.dim(f"    還是不對，正確是：{card.word}")
            ui.blank()
    except QuitSession:
        ui.blank()
        ui.dim("已離開，作答紀錄都存好了。")

    _print_summary(ctx, summary)
    return summary


def _print_summary(ctx: AppContext, summary: SessionSummary) -> None:
    ui = ctx.ui
    if summary.done == 0 and summary.skipped == 0:
        return
    ui.rule("本次結果")
    accuracy = (summary.correct / summary.done * 100) if summary.done else 0.0
    ui.print(
        f"作答 {summary.done} 題 ｜ 對 {summary.correct} ｜ 錯 {summary.wrong} "
        f"｜ 正確率 {accuracy:.0f}%"
    )
    if summary.skipped:
        ui.dim(f"跳過 {summary.skipped} 題")
    if summary.wrong:
        ui.dim("明天用 `ielts spell --only-wrong` 可以只練今天錯的字。")


def show_error_list(ctx: AppContext, limit: int = 20) -> None:
    """列出最常拼錯的字。"""
    rows = repo.spelling_error_list(ctx.conn, limit=limit)
    if not rows:
        ctx.ui.ok("目前沒有拼字錯誤紀錄。")
        return
    ctx.ui.table(
        ["單字", "詞性", "主題", "錯", "總", "錯誤率"],
        [
            [
                r["word"],
                r["pos"] or "-",
                r["topic"] or "-",
                str(r["wrong"]),
                str(r["total"]),
                f"{(r['wrong'] / r['total'] * 100):.0f}%" if r["total"] else "-",
            ]
            for r in rows
        ],
        title=f"最常拼錯的前 {len(rows)} 個字",
    )
