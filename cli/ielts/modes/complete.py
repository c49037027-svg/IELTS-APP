"""補完模式：把匯入時標記為 incomplete 的卡片逐一補齊。

只問缺的欄位；每補完一張就立刻寫回資料庫，隨時可以中斷。
"""

from __future__ import annotations

from .. import repository as repo
from ..context import AppContext
from ..errors import QuitSession
from ..models import CORE_FIELD_LABELS, Card

FIELD_HINTS = {
    "example_sentence": "整句英文，句中要真的用到這個字",
    "collocations": "常見搭配，用分號分隔，如 conduct research; conduct a survey",
    "root_analysis": "字根字首拆解，如 mit-(緩和) + -igate(使…)",
    "synonyms": "同義詞，用分號分隔，如 alleviate; reduce; ease",
}


def run(ctx: AppContext, *, limit: int = 20, word: str | None = None) -> int:
    ui = ctx.ui
    cards = repo.completion_queue(ctx.conn, limit=limit, search=word)
    if not cards:
        ui.ok("所有卡片的四個核心維度都補齊了 🎉")
        return 0

    ui.rule(f"補完模式 · 這批 {len(cards)} 張（全庫 {repo.incomplete_count(ctx.conn)} 張待補）")
    ui.dim("AWL 依 sublist 由高頻排到低頻 ｜ 直接 Enter = 跳過這個欄位 ｜ :q 離開（已填的都會保留）")
    ui.blank()

    fixed = 0
    try:
        for index, card in enumerate(cards, start=1):
            missing = card.missing_core_fields()
            ui.panel(
                _context_lines(card),
                title=f"[{index}/{len(cards)}] {card.label}　{card.topic}",
                style="hint",
            )
            updates: dict[str, str] = {}
            for field_name in missing:
                label = CORE_FIELD_LABELS[field_name]
                ui.dim(f"  提示：{FIELD_HINTS[field_name]}")
                value = ui.ask(f"  {label} ›", allow_empty=True)
                if value:
                    updates[field_name] = value
            if updates:
                repo.update_card(ctx.conn, card.id or 0, **updates)
                still = set(missing) - set(updates)
                if still:
                    ui.dim("  已存（仍缺：" + "、".join(CORE_FIELD_LABELS[f] for f in still) + "）")
                else:
                    fixed += 1
                    ui.ok("  ✓ 這張卡補完了")
            else:
                ui.dim("  略過")
            ui.blank()
    except QuitSession:
        ui.blank()
        ui.dim("已離開，補到一半的內容都存好了。")

    remaining = repo.incomplete_count(ctx.conn)
    ui.rule("本次結果")
    ui.print(f"補完 {fixed} 張 ｜ 全庫還有 {remaining} 張不完整")
    return fixed


def _context_lines(card: Card) -> list[str]:
    """把已經有的內容顯示出來，補的時候有脈絡可循。"""
    lines: list[str] = []
    if card.zh_hint:
        lines.append(f"中文   {card.zh_hint}")
    if card.pos:
        lines.append(f"詞性   {card.pos}")
    if card.example_sentence:
        lines.append(f"例句   {card.example_sentence}")
    if card.collocations:
        lines.append(f"搭配   {' · '.join(card.collocation_list)}")
    if card.root_analysis:
        lines.append(f"字根   {card.root_analysis}")
    if card.synonyms:
        lines.append(f"同義   {' / '.join(card.synonym_list)}")
    missing = card.missing_core_fields()
    lines.append("缺少   " + "、".join(CORE_FIELD_LABELS[f] for f in missing))
    return lines
