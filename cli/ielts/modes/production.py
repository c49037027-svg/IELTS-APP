"""模式 C：主動輸出（active production）。

給一個 active 單字 + 一個雅思常見話題，要你用該字造一句。
句子存進資料庫，之後可以自己檢視，或匯出成 markdown 貼給 AI 批改。
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

from .. import repository as repo, textutil
from ..context import AppContext
from ..errors import QuitSession
from ..models import SessionSummary

#: 依主題分類的雅思常見題幹。造句時給一個真實語境，比單純造句有用。
TOPIC_PROMPTS: dict[str, list[str]] = {
    "環境": [
        "Some people believe individual action cannot solve environmental problems. Do you agree?",
        "What should governments do about plastic waste in cities?",
        "Describe an environmental problem in your hometown.",
    ],
    "教育": [
        "Should schools replace final exams with continuous assessment?",
        "Some argue university education should be free. What is your view?",
        "Describe a subject you think should be added to the school curriculum.",
    ],
    "科技": [
        "Has social media done more harm than good to human relationships?",
        "Should governments regulate artificial intelligence more strictly?",
        "Describe a piece of technology that changed how you study.",
    ],
    "健康": [
        "What are the main causes of rising obesity rates in cities?",
        "Should healthcare be funded entirely by the government?",
        "Describe a habit that has improved your physical or mental health.",
    ],
    "都市化": [
        "What problems does rapid urbanisation cause, and how can they be solved?",
        "Is it better to live in a large city or a small town?",
        "Describe a change that would improve transport in your city.",
    ],
    "犯罪": [
        "Do longer prison sentences reduce crime rates?",
        "Should CCTV cameras be installed in all public places?",
        "What is the best way to prevent youth crime?",
    ],
    "媒體": [
        "Can we still trust the news we read online?",
        "Should social media companies be responsible for misinformation?",
        "Describe a news story that changed your opinion about something.",
    ],
    "經濟": [
        "Should governments spend more on public services or cut taxes?",
        "Is economic growth always good for a country?",
        "Describe a way in which online shopping has changed local businesses.",
    ],
    "工作": [
        "Is a four-day working week realistic for most industries?",
        "Should employees be allowed to work from home permanently?",
        "Describe a job that you think will disappear in the next twenty years.",
    ],
    "文化": [
        "Should governments fund the preservation of traditional culture?",
        "Does globalisation make cultures more similar to each other?",
        "Describe a tradition in your country that you would like to keep.",
    ],
}

GENERAL_PROMPTS = [
    "Some people think X; others disagree. Discuss both views and give your own opinion.",
    "What are the advantages and disadvantages of this development?",
    "Describe a recent change in your country and explain how it has affected people.",
    "To what extent do you agree or disagree with this statement?",
]


def pick_prompt(topic: str, rng) -> str:
    bank = TOPIC_PROMPTS.get(topic.strip())
    if bank:
        return rng.choice(bank)
    for key, prompts in TOPIC_PROMPTS.items():
        if key and key in (topic or ""):
            return rng.choice(prompts)
    return rng.choice(GENERAL_PROMPTS)


def run(
    ctx: AppContext, *, count: int = 5, topic: str | None = None
) -> SessionSummary:
    ui = ctx.ui
    cards = repo.production_candidates(ctx.conn, limit=count, topic=topic)
    summary = SessionSummary(mode="主動輸出", total=len(cards))

    if not cards:
        ui.blank()
        ui.hint("目前沒有 active 單字。先跑 `ielts promote` 把熟的字升級成主動詞彙。")
        return summary

    ui.rule(f"主動輸出 · {len(cards)} 個字")
    ui.dim("用該字造一個完整句子 ｜ 直接 Enter 跳過 ｜ 輸入 :q 離開")
    ui.blank()

    try:
        for index, card in enumerate(cards, start=1):
            prompt_text = pick_prompt(card.topic, ctx.rng)
            lines = [f"單字   {card.label}"]
            if card.collocation_list:
                lines.append("搭配   " + " · ".join(card.collocation_list))
            if card.synonym_list:
                lines.append("同義   " + " / ".join(card.synonym_list))
            lines.append("")
            lines.append(f"話題   {prompt_text}")
            ui.panel(lines, title=f"[{index}/{len(cards)}]", style="word")

            sentence = ui.ask("  你的句子 ›", allow_empty=True)
            if not sentence:
                summary.skipped += 1
                ui.dim("  已跳過")
                ui.blank()
                continue

            if not _uses_word(sentence, card.word):
                ui.hint(f"  這個句子裡好像沒用到「{card.word}」。")
                if not ui.confirm("  還是要存起來嗎？", default=False):
                    sentence = ui.ask("  重寫一次 ›", allow_empty=True)
                    if not sentence:
                        summary.skipped += 1
                        ui.blank()
                        continue

            if len(sentence.split()) < 4:
                ui.dim("  （句子偏短，雅思口說/寫作通常需要更完整的結構）")

            repo.add_production(
                ctx.conn, card.id or 0, card.topic, prompt_text, sentence, today=ctx.today
            )
            summary.done += 1
            ui.ok("  ✓ 已存入輸出紀錄")
            ui.blank()
    except QuitSession:
        ui.blank()
        ui.dim("已離開，寫過的句子都存好了。")

    if summary.done:
        ui.rule("本次結果")
        ui.print(f"造句 {summary.done} 句 ｜ 跳過 {summary.skipped} 句")
        ui.dim("用 `ielts export-productions` 匯出成 markdown，就能整份貼給 AI 批改。")
    return summary


def _uses_word(sentence: str, word: str) -> bool:
    masked, hits = textutil.mask_sentence(sentence, word)
    return hits > 0


def promote(
    ctx: AppContext,
    *,
    count: int = 12,
    min_reviews: int = 3,
    topic: str | None = None,
    dry_run: bool = False,
    assume_yes: bool = False,
) -> int:
    """把認讀已經穩的 passive 字升級成 active（每週做一次）。"""
    ui = ctx.ui
    cards = repo.promotion_candidates(
        ctx.conn, limit=count, min_reviews=min_reviews, topic=topic
    )
    if not cards:
        ui.hint(
            f"還沒有符合條件的字（需要認讀複習過 {min_reviews} 次以上、且有例句）。"
            "先多跑幾次 `ielts review`。"
        )
        return 0

    ui.table(
        ["單字", "詞性", "分類", "主題"],
        [[c.word, c.pos or "-", c.category or "-", c.topic or "-"] for c in cards],
        title=f"建議升級成 active 的 {len(cards)} 個字",
    )
    if dry_run:
        ui.dim("（--dry-run：沒有實際變更）")
        return 0

    if not assume_yes:
        try:
            if not ui.confirm("要把這些字升級成 active 嗎？", default=True):
                ui.dim("已取消。")
                return 0
        except QuitSession:
            ui.dim("已取消。")
            return 0

    for card in cards:
        repo.set_card_type(ctx.conn, card.id or 0, "active")
    ui.ok(f"✓ 已升級 {len(cards)} 個字，接下來用 `ielts produce` 練造句。")
    return len(cards)


def export(ctx: AppContext, out_path: str | None = None, limit: int | None = None) -> Path:
    """把造句紀錄匯出成 markdown，方便整份貼給 AI 批改。"""
    productions = repo.list_productions(ctx.conn, limit=limit)
    target = Path(out_path or f"productions-{date.today().isoformat()}.md").expanduser()
    lines = [
        "# IELTS 造句紀錄",
        "",
        f"匯出時間：{date.today().isoformat()}　共 {len(productions)} 句",
        "",
        "> 請幫我批改以下句子：文法、搭配詞是否自然、是否符合雅思學術語域，"
        "並針對每句給一個改寫版本。",
        "",
    ]
    for item in productions:
        lines.append(f"## {item.word}")
        if item.topic:
            lines.append(f"- 主題：{item.topic}")
        if item.prompt:
            lines.append(f"- 題目：{item.prompt}")
        lines.append(f"- 我的句子：{item.sentence}")
        if item.feedback:
            lines.append(f"- 既有回饋：{item.feedback}")
        lines.append("")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("\n".join(lines), encoding="utf-8")
    ctx.ui.ok(f"✓ 已匯出 {len(productions)} 句到 {target}")
    return target


def show_history(ctx: AppContext, limit: int = 20) -> None:
    productions = repo.list_productions(ctx.conn, limit=limit)
    if not productions:
        ctx.ui.hint("還沒有造句紀錄。跑 `ielts produce` 開始練主動輸出。")
        return
    ctx.ui.table(
        ["日期", "單字", "句子"],
        [[p.created_at[:10], p.word, p.sentence] for p in productions],
        title=f"最近 {len(productions)} 句",
    )
