"""單字資料的唯一來源，同時產生 CLI 的 CSV 與網頁版的 cards.js。

    python3 tools/build_seed.py          # 產生 + 驗證
    python3 tools/build_seed.py --check  # 只驗證，不寫檔

資料分四個檔案（對應四個 category），每筆是一個 dict。
產生前會逐張驗證，任何一張不合格就不寫檔 —— 內容錯誤要在這裡擋下來，
不要等到複習時才發現例句裡根本沒有那個字。
"""

from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "cli"))

from ielts import textutil  # noqa: E402  （驗證挖空用，與 App 同一套規則）

from data_awl import AWL  # noqa: E402
from data_speaking import SPEAKING  # noqa: E402
from data_task1 import TASK1  # noqa: E402
from data_topics import TOPICS  # noqa: E402

CSV_PATH = ROOT / "cli" / "ielts" / "data" / "seed_cards.csv"
JS_PATH = ROOT / "js" / "cards.js"

COLUMNS = ["word", "pos", "example_sentence", "collocations", "root_analysis",
           "synonyms", "category", "topic", "card_type", "zh_hint", "notes"]

#: 口說表達與 Task 1 用語是「拿來用」的字，一開始就是 active（會出現在主動輸出）。
#: AWL 與話題字先當 passive，靠每週升級慢慢轉成主動詞彙。
ACTIVE_CATEGORIES = {"口說表達", "Task1圖表用語"}

VALID_CATEGORIES = {"AWL", "高頻話題字", "Task1圖表用語", "口說表達"}


def all_entries() -> list[dict]:
    from data_awl import SUBLIST

    entries = [*AWL, *TOPICS, *TASK1, *SPEAKING]
    # 非 AWL 分類但本身是 AWL 字頭的字，在備註裡標出 sublist，
    # 這樣「這個字也是學術核心字」的資訊不會因為分類而消失。
    for entry in entries:
        if entry["category"] == "AWL":
            continue
        sub = SUBLIST.get(entry["word"].lower())
        if sub:
            tag = f"AWL Sublist {sub}"
            notes = entry.get("notes", "")
            entry["notes"] = f"{notes}　｜　{tag}" if notes else tag
    return entries


def normalise(entry: dict) -> dict:
    card = {
        "word": entry["word"].strip(),
        "pos": entry.get("pos", "").strip(),
        "example_sentence": entry.get("example", "").strip(),
        "collocations": "; ".join(c.strip() for c in entry.get("collocations", [])),
        "root_analysis": entry.get("root", "").strip(),
        "synonyms": "; ".join(s.strip() for s in entry.get("synonyms", [])),
        "category": entry["category"].strip(),
        "topic": entry.get("topic", "").strip(),
        "card_type": entry.get(
            "card_type",
            "active" if entry["category"] in ACTIVE_CATEGORIES else "passive",
        ),
        "zh_hint": entry.get("zh", "").strip(),
        "notes": entry.get("notes", "").strip(),
    }
    return card


def validate(entries: list[dict]) -> list[str]:
    """回傳所有問題。空清單才會寫檔。"""
    problems: list[str] = []
    seen: dict[str, int] = {}

    for index, entry in enumerate(entries, start=1):
        word = entry.get("word", "").strip()
        where = f"[{index}] {word or '(無單字)'}"

        if not word:
            problems.append(f"{where}：word 空白")
            continue

        key = word.lower()
        if key in seen:
            problems.append(f"{where}：與第 {seen[key]} 筆重複")
        seen[key] = index

        category = entry.get("category", "")
        if category not in VALID_CATEGORIES:
            problems.append(f"{where}：category「{category}」不在四個分類裡")
        if not entry.get("topic"):
            problems.append(f"{where}：缺 topic")

        # 只帶字頭進來的卡片：四個維度留白是刻意的，交給補完模式
        if entry.get("bare"):
            continue

        for field, label in (("example", "例句"), ("root", "字根")):
            if not str(entry.get(field, "")).strip():
                problems.append(f"{where}：缺{label}")

        collocations = entry.get("collocations") or []
        synonyms = entry.get("synonyms") or []
        if len(collocations) < 2:
            problems.append(f"{where}：搭配詞至少要 2 個（目前 {len(collocations)}）")
        if len(synonyms) < 2:
            problems.append(f"{where}：同義詞至少要 2 個（目前 {len(synonyms)}）")
        if not str(entry.get("zh", "")).strip():
            problems.append(f"{where}：缺中文提示（拼字模式要用）")

        # 最重要的一條：例句裡必須真的用到這個字，否則挖空模式會出不了題
        example = str(entry.get("example", ""))
        if example and textutil.mask_sentence(example, word)[1] == 0:
            problems.append(f"{where}：例句裡找不到這個字 → {example}")

        # 搭配詞也應該含有這個字（片語除外，片語本身就是搭配）
        if len(word.split()) == 1:
            bad = [c for c in collocations if textutil.mask_sentence(c, word)[1] == 0]
            if len(bad) == len(collocations) and collocations:
                problems.append(f"{where}：沒有一個搭配詞含這個字 → {collocations}")

        # 同義詞不該把自己列進去
        if any(textutil.normalise(s) == textutil.normalise(word) for s in synonyms):
            problems.append(f"{where}：同義詞裡有自己")

    return problems


def write_csv(cards: list[dict]) -> None:
    CSV_PATH.parent.mkdir(parents=True, exist_ok=True)
    with CSV_PATH.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=COLUMNS)
        writer.writeheader()
        writer.writerows(cards)


def write_js(cards: list[dict]) -> None:
    rows = []
    for card in cards:
        rows.append({
            "word": card["word"],
            "pos": card["pos"],
            "example": card["example_sentence"],
            "collocations": [c.strip() for c in card["collocations"].split(";") if c.strip()],
            "root": card["root_analysis"],
            "synonyms": [s.strip() for s in card["synonyms"].split(";") if s.strip()],
            "category": card["category"],
            "topic": card["topic"],
            "cardType": card["card_type"],
            "zh": card["zh_hint"],
            "notes": card["notes"],
        })
    body = ",\n".join("  " + json.dumps(r, ensure_ascii=False) for r in rows)
    JS_PATH.write_text(
        "// 種子單字 —— 由 tools/build_seed.py 產生，不要手動改這個檔案。\n"
        "// 網頁版與 CLI 共用同一份內容；每張卡的四個維度都齊全。\n"
        f"const SEED_CARDS = [\n{body}\n];\n",
        encoding="utf-8",
    )


def report(cards: list[dict]) -> None:
    from collections import Counter

    by_category = Counter(c["category"] for c in cards)
    print(f"共 {len(cards)} 張卡")
    for name in ("AWL", "高頻話題字", "Task1圖表用語", "口說表達"):
        print(f"  {name:<12} {by_category.get(name, 0):>4}")
    topics = Counter(c["topic"] for c in cards if c["category"] == "高頻話題字")
    if topics:
        print("  話題字各主題：" + "、".join(f"{t} {n}" for t, n in sorted(topics.items())))
    complete = sum(1 for c in cards if c["example_sentence"] and c["collocations"]
                   and c["root_analysis"] and c["synonyms"])
    print(f"  四維度齊全 {complete} 張 ／ 待補完 {len(cards) - complete} 張")
    types = Counter(c["card_type"] for c in cards)
    print(f"  passive {types.get('passive', 0)} ／ active {types.get('active', 0)}")


def main() -> int:
    entries = all_entries()
    problems = validate(entries)
    if problems:
        print(f"發現 {len(problems)} 個問題，沒有寫檔：\n")
        for p in problems:
            print("  " + p)
        return 1

    cards = [normalise(e) for e in entries]
    report(cards)

    if "--check" in sys.argv:
        print("\n（--check：只驗證，沒有寫檔）")
        return 0

    write_csv(cards)
    write_js(cards)
    print(f"\n已寫入 {CSV_PATH.relative_to(ROOT)}")
    print(f"已寫入 {JS_PATH.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
