"""資料模型。

多值欄位（collocations / synonyms）在資料庫裡以 ';' 分隔字串儲存，
模型層負責 parse 成 list，讓上層永遠拿到 list，不用自己 split。
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Sequence

MULTI_SEP = ";"

#: 四個核心維度。這四項齊全才算一張「可用」的卡片；缺任一項會被標記為 incomplete。
CORE_FIELDS = ("example_sentence", "collocations", "root_analysis", "synonyms")

CORE_FIELD_LABELS = {
    "example_sentence": "英文例句",
    "collocations": "常見搭配詞",
    "root_analysis": "字根字首拆解",
    "synonyms": "同義詞群",
}

CARD_TEXT_FIELDS = (
    "word",
    "pos",
    "example_sentence",
    "collocations",
    "root_analysis",
    "synonyms",
    "category",
    "topic",
    "card_type",
    "zh_hint",
    "notes",
)


def split_multi(raw: str | None) -> list[str]:
    """把 'a; b ; c' 拆成 ['a', 'b', 'c']（去空白、去空項）。"""
    if not raw:
        return []
    parts: list[str] = []
    for chunk in str(raw).replace("|", MULTI_SEP).replace("、", MULTI_SEP).split(MULTI_SEP):
        item = chunk.strip()
        if item:
            parts.append(item)
    return parts


def join_multi(items: Sequence[str]) -> str:
    return MULTI_SEP.join(str(i).strip() for i in items if str(i).strip())


def parse_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def now_iso() -> str:
    return datetime.now().replace(microsecond=0).isoformat(sep=" ")


def stamp_for(day: date | None) -> str:
    """用指定日期 + 現在時刻組出時間戳。

    `--date` 模擬未來某天時，複習紀錄也要落在那一天，
    否則每日新卡上限與統計都會跟排程對不起來。
    """
    if day is None:
        return now_iso()
    return f"{day.isoformat()} {datetime.now():%H:%M:%S}"


@dataclass
class Card:
    id: int | None = None
    word: str = ""
    pos: str = ""
    example_sentence: str = ""
    collocations: str = ""
    root_analysis: str = ""
    synonyms: str = ""
    category: str = ""
    topic: str = ""
    card_type: str = "passive"
    zh_hint: str = ""
    notes: str = ""
    is_incomplete: int = 0
    missing_fields: str = ""
    created_at: str = ""
    updated_at: str = ""

    @classmethod
    def from_row(cls, row: sqlite3.Row | dict[str, Any]) -> "Card":
        data = dict(row)
        known = {f: data.get(f) for f in cls.__dataclass_fields__ if f in data}
        for key, value in list(known.items()):
            if value is None:
                known[key] = 0 if key in ("id", "is_incomplete") else ""
        return cls(**known)  # type: ignore[arg-type]

    # -- 衍生屬性 ---------------------------------------------------------
    @property
    def collocation_list(self) -> list[str]:
        return split_multi(self.collocations)

    @property
    def synonym_list(self) -> list[str]:
        return split_multi(self.synonyms)

    @property
    def is_active(self) -> bool:
        return self.card_type == "active"

    @property
    def label(self) -> str:
        return f"{self.word} ({self.pos})" if self.pos else self.word

    def missing_core_fields(self) -> list[str]:
        """回傳缺少的核心欄位名稱。"""
        return [f for f in CORE_FIELDS if not str(getattr(self, f, "") or "").strip()]


@dataclass
class SrsState:
    card_id: int
    track: str
    interval: float = 0.0
    ease_factor: float = 2.5
    due_date: str = ""
    review_count: int = 0
    lapse_count: int = 0
    last_reviewed: str | None = None

    @classmethod
    def from_row(cls, row: sqlite3.Row | dict[str, Any]) -> "SrsState":
        data = dict(row)
        return cls(
            card_id=int(data["card_id"]),
            track=str(data["track"]),
            interval=float(data.get("interval") or 0.0),
            ease_factor=float(data.get("ease_factor") or 2.5),
            due_date=str(data.get("due_date") or ""),
            review_count=int(data.get("review_count") or 0),
            lapse_count=int(data.get("lapse_count") or 0),
            last_reviewed=data.get("last_reviewed"),
        )

    @property
    def due(self) -> date | None:
        return parse_date(self.due_date)

    @property
    def is_new(self) -> bool:
        return self.review_count == 0


@dataclass
class ReviewItem:
    """一張卡片加上它在某個 track 上的排程狀態。"""

    card: Card
    state: SrsState


@dataclass
class Production:
    id: int | None
    card_id: int
    word: str = ""
    topic: str = ""
    prompt: str = ""
    sentence: str = ""
    created_at: str = ""
    feedback: str = ""
    status: str = "new"

    @classmethod
    def from_row(cls, row: sqlite3.Row | dict[str, Any]) -> "Production":
        data = dict(row)
        return cls(
            id=data.get("id"),
            card_id=int(data["card_id"]),
            word=str(data.get("word") or ""),
            topic=str(data.get("topic") or ""),
            prompt=str(data.get("prompt") or ""),
            sentence=str(data.get("sentence") or ""),
            created_at=str(data.get("created_at") or ""),
            feedback=str(data.get("feedback") or ""),
            status=str(data.get("status") or "new"),
        )


@dataclass
class SessionSummary:
    """一次練習結束後的統計，用於收尾畫面。"""

    mode: str
    total: int = 0
    done: int = 0
    correct: int = 0
    wrong: int = 0
    ratings: dict[int, int] = field(default_factory=dict)
    skipped: int = 0
