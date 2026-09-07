"""卡片的畫面組裝。

四個維度（例句 / 搭配詞 / 字根 / 同義詞）是每張卡的重點，
所有模式共用同一套排版，避免各處長得不一樣。
"""

from __future__ import annotations

from .models import Card
from .textutil import highlight_target, mask_all, mask_sentence

LABEL_WIDTH = 4


def _row(label: str, value: str) -> str:
    return f"{label}  {value}"


def front_lines(card: Card) -> list[str]:
    """卡片正面：只有單字本身，不給任何中文。"""
    head = card.word
    if card.pos:
        head += f"  ({card.pos})"
    tags = " · ".join(t for t in (card.category, card.topic) if t)
    lines = [head]
    if tags:
        lines.append(tags)
    return lines


def back_lines(card: Card, *, show_zh: bool = False) -> list[str]:
    """卡片背面：四個核心維度。"""
    lines: list[str] = []
    if card.example_sentence:
        lines.append(_row("例句", highlight_target(card.example_sentence, card.word)))
    if card.collocation_list:
        lines.append(_row("搭配", " · ".join(card.collocation_list)))
    if card.root_analysis:
        lines.append(_row("字根", card.root_analysis))
    if card.synonym_list:
        lines.append(_row("同義", " / ".join(card.synonym_list)))
    if show_zh and card.zh_hint:
        lines.append(_row("中文", card.zh_hint))
    if card.notes:
        lines.append(_row("筆記", card.notes))
    if not lines:
        lines.append("（這張卡還沒有內容，用 `ielts complete` 補完）")
    return lines


def spelling_prompt_lines(card: Card) -> list[str]:
    """拼字模式的題目：例句挖空 + 中文提示，其他線索一律遮掉目標字。"""
    lines: list[str] = []
    masked, hits = mask_sentence(card.example_sentence, card.word)
    if card.example_sentence and hits:
        lines.append(_row("例句", masked))
    elif card.example_sentence:
        # 例句裡找不到目標字（可能是變化形太特殊）→ 不顯示，以免直接洩題
        lines.append(_row("例句", "（例句含目標字原形，先不顯示）"))
    if card.zh_hint:
        lines.append(_row("中文", card.zh_hint))
    if card.pos:
        lines.append(_row("詞性", card.pos))
    if card.collocation_list:
        lines.append(_row("搭配", " · ".join(mask_all(card.collocation_list, card.word))))
    if card.root_analysis:
        lines.append(_row("字根", mask_sentence(card.root_analysis, card.word)[0]))
    # AWL 字頭卡還沒補完時，英文定義就是唯一的線索（一樣遮掉目標字）
    if not card.example_sentence and card.notes:
        lines.append(_row("定義", mask_sentence(card.notes, card.word)[0]))
    return lines
