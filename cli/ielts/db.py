"""SQLite 連線、schema 建立與版本遷移。

所有 SQL schema 集中在這裡；查詢語句集中在 repository.py。
模式（modes/）不直接碰資料庫。
"""

from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

SCHEMA_VERSION = 2
DEFAULT_DB_NAME = "ielts.db"

#: SRS 排程軌道。認讀 / 拼字 / 同義詞是三種不同能力，各自獨立排程。
TRACK_RECALL = "recall"
TRACK_SPELLING = "spelling"
TRACK_SYNONYM = "synonym"
TRACKS = (TRACK_RECALL, TRACK_SPELLING, TRACK_SYNONYM)

TRACK_LABELS = {
    TRACK_RECALL: "認讀",
    TRACK_SPELLING: "拼字",
    TRACK_SYNONYM: "同義詞",
}

CARD_TYPES = ("passive", "active")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cards (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    word             TEXT NOT NULL,
    pos              TEXT NOT NULL DEFAULT '',
    example_sentence TEXT NOT NULL DEFAULT '',
    example_ref      TEXT NOT NULL DEFAULT '',
    collocations     TEXT NOT NULL DEFAULT '',
    root_analysis    TEXT NOT NULL DEFAULT '',
    synonyms         TEXT NOT NULL DEFAULT '',
    category         TEXT NOT NULL DEFAULT '',
    topic            TEXT NOT NULL DEFAULT '',
    card_type        TEXT NOT NULL DEFAULT 'passive',
    zh_hint          TEXT NOT NULL DEFAULT '',
    notes            TEXT NOT NULL DEFAULT '',
    is_incomplete    INTEGER NOT NULL DEFAULT 0,
    missing_fields   TEXT NOT NULL DEFAULT '',
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_word_pos ON cards(word, pos);
CREATE INDEX IF NOT EXISTS idx_cards_type  ON cards(card_type);
CREATE INDEX IF NOT EXISTS idx_cards_topic ON cards(topic);

CREATE TABLE IF NOT EXISTS srs_state (
    card_id       INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    track         TEXT    NOT NULL,
    interval      REAL    NOT NULL DEFAULT 0,
    ease_factor   REAL    NOT NULL DEFAULT 2.5,
    due_date      TEXT    NOT NULL,
    review_count  INTEGER NOT NULL DEFAULT 0,
    lapse_count   INTEGER NOT NULL DEFAULT 0,
    last_reviewed TEXT,
    PRIMARY KEY (card_id, track)
);

CREATE INDEX IF NOT EXISTS idx_srs_due ON srs_state(track, due_date);

CREATE TABLE IF NOT EXISTS review_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id         INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    track           TEXT    NOT NULL,
    rating          INTEGER NOT NULL,
    reviewed_at     TEXT    NOT NULL,
    interval_before REAL    NOT NULL DEFAULT 0,
    interval_after  REAL    NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_review_log_time ON review_log(reviewed_at);
CREATE INDEX IF NOT EXISTS idx_review_log_card ON review_log(card_id);

CREATE TABLE IF NOT EXISTS spelling_attempts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id      INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    user_input   TEXT    NOT NULL,
    is_correct   INTEGER NOT NULL,
    attempted_at TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_spelling_card ON spelling_attempts(card_id);
CREATE INDEX IF NOT EXISTS idx_spelling_time ON spelling_attempts(attempted_at);

CREATE TABLE IF NOT EXISTS productions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id    INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    topic      TEXT    NOT NULL DEFAULT '',
    prompt     TEXT    NOT NULL DEFAULT '',
    sentence   TEXT    NOT NULL,
    created_at TEXT    NOT NULL,
    feedback   TEXT    NOT NULL DEFAULT '',
    status     TEXT    NOT NULL DEFAULT 'new'
);

CREATE INDEX IF NOT EXISTS idx_productions_card ON productions(card_id);
CREATE INDEX IF NOT EXISTS idx_productions_time ON productions(created_at);
"""


def default_db_path() -> Path:
    """資料庫預設位置：cli/ielts.db，可用環境變數 IELTS_DB 覆寫。"""
    env = os.environ.get("IELTS_DB", "").strip()
    if env:
        return Path(env).expanduser()
    return Path(__file__).resolve().parent.parent / DEFAULT_DB_NAME


def connect(path: str | os.PathLike[str] | None = None) -> sqlite3.Connection:
    """建立連線並確保 schema 存在。"""
    target = Path(path).expanduser() if path else default_db_path()
    if str(target) != ":memory:":
        target.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(target), isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    if str(target) != ":memory:":
        conn.execute("PRAGMA journal_mode = WAL")
    init_db(conn)
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    """建表（冪等）並套用必要的 migration。"""
    conn.executescript(_SCHEMA)
    current = get_schema_version(conn)
    if current == 0:
        set_meta(conn, "schema_version", str(SCHEMA_VERSION))
    elif current < SCHEMA_VERSION:
        _migrate(conn, current)
        set_meta(conn, "schema_version", str(SCHEMA_VERSION))


def _migrate(conn: sqlite3.Connection, from_version: int) -> None:
    """逐版升級既有資料庫，不動使用者已經累積的學習進度。"""
    if from_version < 2:
        # v2：加上參考例句欄位（例句留白給使用者自己寫時的備援）
        columns = {r["name"] for r in conn.execute("PRAGMA table_info(cards)")}
        if "example_ref" not in columns:
            conn.execute(
                "ALTER TABLE cards ADD COLUMN example_ref TEXT NOT NULL DEFAULT ''"
            )


def get_schema_version(conn: sqlite3.Connection) -> int:
    value = get_meta(conn, "schema_version")
    try:
        return int(value) if value else 0
    except ValueError:
        return 0


def get_meta(conn: sqlite3.Connection, key: str) -> str | None:
    row = conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else None


def set_meta(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO meta(key, value) VALUES(?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )


@contextmanager
def transaction(conn: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    """把一組寫入包成單一交易（連線是 autocommit 模式，故手動 BEGIN）。

    答題流程中「更新排程 + 寫入紀錄」必須同生共死，避免中途 Ctrl-C 留下半套資料。
    """
    already_in_tx = conn.in_transaction
    if not already_in_tx:
        conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
    except BaseException:
        if not already_in_tx and conn.in_transaction:
            conn.execute("ROLLBACK")
        raise
    else:
        if not already_in_tx and conn.in_transaction:
            conn.execute("COMMIT")


def card_count(conn: sqlite3.Connection) -> int:
    return int(conn.execute("SELECT COUNT(*) AS n FROM cards").fetchone()["n"])
