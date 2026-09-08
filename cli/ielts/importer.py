"""CSV 匯入 / 範本輸出。

設計成「寬鬆吃進來、明確標記缺漏」：欄位名大小寫、底線、空白都能對上，
只有 word 是必填，其餘空著就標記 incomplete，之後用補完模式處理。
"""

from __future__ import annotations

import csv
import sqlite3
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

from . import db as dbmod
from . import repository as repo
from .models import CARD_TEXT_FIELDS, Card, join_multi, split_multi

TEMPLATE_COLUMNS = [
    "word",
    "pos",
    "example_sentence",
    "example_ref",
    "collocations",
    "root_analysis",
    "synonyms",
    "category",
    "topic",
    "card_type",
    "zh_hint",
    "notes",
]

#: 常見欄位別名 → 正式欄位名。方便直接吃別人做好的單字表。
ALIASES = {
    "vocab": "word",
    "vocabulary": "word",
    "term": "word",
    "單字": "word",
    "part_of_speech": "pos",
    "partofspeech": "pos",
    "詞性": "pos",
    "example": "example_sentence",
    "exampleref": "example_ref",
    "reference_example": "example_ref",
    "參考例句": "example_ref",
    "sentence": "example_sentence",
    "examplesentence": "example_sentence",
    "例句": "example_sentence",
    "collocation": "collocations",
    "搭配詞": "collocations",
    "搭配": "collocations",
    "root": "root_analysis",
    "roots": "root_analysis",
    "etymology": "root_analysis",
    "字根": "root_analysis",
    "synonym": "synonyms",
    "同義詞": "synonyms",
    "類別": "category",
    "分類": "category",
    "主題": "topic",
    "話題": "topic",
    "type": "card_type",
    "cardtype": "card_type",
    "chinese": "zh_hint",
    "chinese_meaning": "zh_hint",
    "chinesemeaning": "zh_hint",
    "zh": "zh_hint",
    "meaning": "zh_hint",
    "translation": "zh_hint",
    "中文": "zh_hint",
    "中文意思": "zh_hint",
    "中文解釋": "zh_hint",
    "note": "notes",
    "備註": "notes",
}

ENCODINGS = ("utf-8-sig", "utf-8", "cp950", "big5", "latin-1")


@dataclass
class ImportResult:
    added: int = 0
    updated: int = 0
    skipped: int = 0
    incomplete: int = 0
    errors: list[str] = field(default_factory=list)

    @property
    def total(self) -> int:
        return self.added + self.updated + self.skipped


def normalise_header(name: str) -> str:
    key = (name or "").strip().lower().replace(" ", "_").replace("-", "_")
    key = key.lstrip("﻿")
    if key in CARD_TEXT_FIELDS:
        return key
    return ALIASES.get(key, ALIASES.get(key.replace("_", ""), key))


def read_rows(path: str | Path) -> list[dict[str, str]]:
    """讀 CSV，自動嘗試常見編碼（Excel 匯出的 Big5 也吃得下）。"""
    file_path = Path(path).expanduser()
    if not file_path.exists():
        raise FileNotFoundError(f"找不到檔案：{file_path}")
    last_error: Exception | None = None
    for encoding in ENCODINGS:
        try:
            with file_path.open("r", encoding=encoding, newline="") as handle:
                sample = handle.read(4096)
                handle.seek(0)
                try:
                    dialect: Any = csv.Sniffer().sniff(sample, delimiters=",\t;")
                except csv.Error:
                    dialect = csv.excel
                reader = csv.DictReader(handle, dialect=dialect)
                if not reader.fieldnames:
                    return []
                rows = []
                for raw in reader:
                    row = {
                        normalise_header(k): (v or "").strip()
                        for k, v in raw.items()
                        if k is not None
                    }
                    rows.append(row)
                return rows
        except UnicodeDecodeError as exc:
            last_error = exc
            continue
    raise UnicodeDecodeError(  # pragma: no cover - 幾乎不會走到（latin-1 什麼都吃）
        "csv", b"", 0, 1, f"無法解碼檔案 {file_path}：{last_error}"
    )


def row_to_card(row: dict[str, str]) -> Card:
    card = Card()
    for field_name in CARD_TEXT_FIELDS:
        value = row.get(field_name, "")
        if field_name in ("collocations", "synonyms"):
            value = join_multi(split_multi(value))
        setattr(card, field_name, (value or "").strip())
    if not card.card_type:
        card.card_type = "passive"
    return card


def import_rows(
    conn: sqlite3.Connection, rows: Iterable[dict[str, str]], *, update: bool = False
) -> ImportResult:
    result = ImportResult()
    for line_no, row in enumerate(rows, start=2):
        try:
            card = row_to_card(row)
            if not card.word:
                result.skipped += 1
                result.errors.append(f"第 {line_no} 行：缺少 word，已略過")
                continue
            existing = repo.find_card(conn, card.word, card.pos)
            with dbmod.transaction(conn):
                if existing is None:
                    repo.add_card(conn, card)
                    result.added += 1
                elif update:
                    fields = {
                        f: getattr(card, f)
                        for f in CARD_TEXT_FIELDS
                        if str(getattr(card, f, "") or "").strip()
                    }
                    repo.update_card(conn, existing.id or 0, **fields)
                    result.updated += 1
                else:
                    result.skipped += 1
                    continue
            if card.missing_core_fields():
                result.incomplete += 1
        except (sqlite3.Error, ValueError) as exc:
            result.skipped += 1
            result.errors.append(f"第 {line_no} 行：{exc}")
    return result


def import_csv(
    conn: sqlite3.Connection, path: str | Path, *, update: bool = False
) -> ImportResult:
    return import_rows(conn, read_rows(path), update=update)


def write_template(path: str | Path) -> Path:
    """輸出一份空白 CSV 範本（含一列填法示範）。"""
    target = Path(path).expanduser()
    target.parent.mkdir(parents=True, exist_ok=True)
    sample = {
        "word": "mitigate",
        "pos": "v.",
        "example_sentence": "Governments must act now to mitigate the effects of climate change.",
        "example_ref": "",
        "collocations": "mitigate the effects; mitigate risk; mitigate climate change",
        "root_analysis": "mit-(緩和、變柔軟) + -igate(使…) → 使變柔和",
        "synonyms": "alleviate; reduce; ease; lessen",
        "category": "AWL",
        "topic": "環境",
        "card_type": "passive",
        "zh_hint": "減輕、緩和",
        "notes": "",
    }
    with target.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=TEMPLATE_COLUMNS)
        writer.writeheader()
        writer.writerow(sample)
    return target


def export_csv(conn: sqlite3.Connection, path: str | Path) -> Path:
    """把整個單字庫匯出成 CSV（備份、或搬到別台機器）。"""
    target = Path(path).expanduser()
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=TEMPLATE_COLUMNS)
        writer.writeheader()
        for card in repo.iter_all_cards(conn):
            writer.writerow({f: getattr(card, f, "") for f in TEMPLATE_COLUMNS})
    return target
