"""所有 SQL 查詢集中在這裡。

modes/ 與 stats/ 只呼叫這一層，不自己寫 SQL；換資料庫或改 schema 時
只需要動這個檔案。
"""

from __future__ import annotations

import sqlite3
from datetime import date, timedelta
from typing import Any, Iterable, Sequence

from . import db as dbmod
from . import srs
from .db import TRACK_RECALL, TRACK_SPELLING, TRACK_SYNONYM
from .models import (
    CARD_TEXT_FIELDS,
    Card,
    Production,
    ReviewItem,
    SrsState,
    join_multi,
    now_iso,
    stamp_for,
)

#: 每天最多放幾張「沒學過的新卡」進來。到期的舊卡不受限制 ——
#: 沒有這個上限，整份 AWL 會在第一天全部到期，等於沒有排程。
NEW_PER_DAY = 20


def new_introduced_today(
    conn: sqlite3.Connection, track: str, today: date | None = None
) -> int:
    """今天已經放行幾張新卡（某張卡在這個 track 的第一次複習發生在今天）。"""
    today = today or date.today()
    row = conn.execute(
        """
        SELECT COUNT(*) AS n FROM (
            SELECT card_id, MIN(reviewed_at) AS first_seen
            FROM review_log WHERE track = ? GROUP BY card_id
        ) WHERE substr(first_seen, 1, 10) = ?
        """,
        (track, today.isoformat()),
    ).fetchone()
    return int(row["n"] or 0)


def _apply_daily_limit(
    conn: sqlite3.Connection, items: list[ReviewItem], track: str, today: date
) -> list[ReviewItem]:
    """舊卡全放行；新卡受每日上限。"""
    allowance = max(0, NEW_PER_DAY - new_introduced_today(conn, track, today))
    kept: list[ReviewItem] = []
    taken = 0
    for item in items:
        if item.state.review_count > 0:
            kept.append(item)
        elif taken < allowance:
            kept.append(item)
            taken += 1
    return kept


def _topic_clause(conn: sqlite3.Connection, topic: str) -> tuple[str, str]:
    """topic 篩選：先試完全比對，找不到才退回子字串。

    不這樣做的話，`--topic "Sublist 1"` 會把 Sublist 10 一起抓進來。
    """
    row = conn.execute(
        "SELECT 1 FROM cards WHERE topic = ? LIMIT 1", (topic,)
    ).fetchone()
    if row:
        return "AND topic = ?", topic
    return "AND topic LIKE ?", f"%{topic}%"


# ---------------------------------------------------------------- cards


def _incomplete_info(card: Card) -> tuple[int, str]:
    missing = card.missing_core_fields()
    return (1 if missing else 0), join_multi(missing)


def _normalise_card(card: Card) -> Card:
    card.word = (card.word or "").strip()
    card.pos = (card.pos or "").strip()
    card.card_type = (card.card_type or "passive").strip().lower()
    if card.card_type not in dbmod.CARD_TYPES:
        card.card_type = "passive"
    for field_name in CARD_TEXT_FIELDS:
        value = getattr(card, field_name, "")
        setattr(card, field_name, ("" if value is None else str(value)).strip())
    return card


def add_card(conn: sqlite3.Connection, card: Card, today: date | None = None) -> int:
    """新增一張卡片並自動建立三個 track 的排程狀態（預設今天到期）。回傳 card id。"""
    card = _normalise_card(card)
    if not card.word:
        raise ValueError("word 不可為空")
    incomplete, missing = _incomplete_info(card)
    stamp = now_iso()
    cur = conn.execute(
        """
        INSERT INTO cards (word, pos, example_sentence, example_zh,
                           example_ref, example_ref_zh, collocations,
                           root_analysis, synonyms, category, topic, card_type,
                           zh_hint, notes,
                           is_incomplete, missing_fields, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            card.word, card.pos, card.example_sentence, card.example_zh,
            card.example_ref, card.example_ref_zh,
            card.collocations, card.root_analysis, card.synonyms, card.category,
            card.topic, card.card_type, card.zh_hint, card.notes, incomplete, missing,
            stamp, stamp,
        ),
    )
    card_id = int(cur.lastrowid)
    ensure_srs_rows(conn, card_id, today)
    return card_id


def update_card(conn: sqlite3.Connection, card_id: int, **fields: Any) -> None:
    """更新卡片欄位，並重新計算 incomplete 狀態。"""
    allowed = {k: v for k, v in fields.items() if k in CARD_TEXT_FIELDS}
    if not allowed:
        return
    assignments = ", ".join(f"{k} = ?" for k in allowed)
    conn.execute(
        f"UPDATE cards SET {assignments}, updated_at = ? WHERE id = ?",
        (*[str(v or "").strip() for v in allowed.values()], now_iso(), card_id),
    )
    refresh_incomplete(conn, card_id)


def refresh_incomplete(conn: sqlite3.Connection, card_id: int) -> None:
    card = get_card(conn, card_id)
    if not card:
        return
    incomplete, missing = _incomplete_info(card)
    conn.execute(
        "UPDATE cards SET is_incomplete = ?, missing_fields = ? WHERE id = ?",
        (incomplete, missing, card_id),
    )


def get_card(conn: sqlite3.Connection, card_id: int) -> Card | None:
    row = conn.execute("SELECT * FROM cards WHERE id = ?", (card_id,)).fetchone()
    return Card.from_row(row) if row else None


def find_card(conn: sqlite3.Connection, word: str, pos: str = "") -> Card | None:
    row = conn.execute(
        "SELECT * FROM cards WHERE word = ? AND pos = ?", (word.strip(), pos.strip())
    ).fetchone()
    return Card.from_row(row) if row else None


def list_cards(
    conn: sqlite3.Connection,
    *,
    topic: str | None = None,
    category: str | None = None,
    card_type: str | None = None,
    incomplete_only: bool = False,
    search: str | None = None,
    limit: int | None = None,
) -> list[Card]:
    sql = ["SELECT * FROM cards WHERE 1=1"]
    args: list[Any] = []
    if topic:
        clause, value = _topic_clause(conn, topic)
        sql.append(clause)
        args.append(value)
    if category:
        sql.append("AND category LIKE ?")
        args.append(f"%{category}%")
    if card_type:
        sql.append("AND card_type = ?")
        args.append(card_type)
    if incomplete_only:
        sql.append("AND is_incomplete = 1")
    if search:
        sql.append("AND word LIKE ?")
        args.append(f"%{search}%")
    sql.append("ORDER BY word COLLATE NOCASE")
    if limit:
        sql.append("LIMIT ?")
        args.append(int(limit))
    rows = conn.execute(" ".join(sql), args).fetchall()
    return [Card.from_row(r) for r in rows]


def completion_queue(
    conn: sqlite3.Connection, *, limit: int | None = None, search: str | None = None
) -> list[Card]:
    """補完佇列：AWL 依 sublist 由高頻到低頻（1 → 10），其餘排在後面。

    Sublist 1、2 已經寫齊，所以實際會從 Sublist 3 開始補。
    """
    sql = ["SELECT * FROM cards WHERE is_incomplete = 1"]
    args: list[Any] = []
    if search:
        sql.append("AND word LIKE ?")
        args.append(f"%{search}%")
    sql.append(
        "ORDER BY CASE WHEN topic LIKE 'Sublist %' "
        "          THEN CAST(substr(topic, 9) AS INTEGER) ELSE 99 END, "
        "         word COLLATE NOCASE"
    )
    if limit:
        sql.append("LIMIT ?")
        args.append(int(limit))
    return [Card.from_row(r) for r in conn.execute(" ".join(sql), args).fetchall()]


def set_card_type(conn: sqlite3.Connection, card_id: int, card_type: str) -> None:
    if card_type not in dbmod.CARD_TYPES:
        raise ValueError(f"card_type 必須是 {dbmod.CARD_TYPES}")
    conn.execute(
        "UPDATE cards SET card_type = ?, updated_at = ? WHERE id = ?",
        (card_type, now_iso(), card_id),
    )


# ------------------------------------------------------------- srs state


def ensure_srs_rows(
    conn: sqlite3.Connection, card_id: int, today: date | None = None
) -> None:
    """為一張卡建立缺少的 track 排程列（新卡今天到期）。"""
    today = today or date.today()
    for track in dbmod.TRACKS:
        conn.execute(
            """
            INSERT OR IGNORE INTO srs_state
                (card_id, track, interval, ease_factor, due_date, review_count, lapse_count)
            VALUES (?, ?, 0, ?, ?, 0, 0)
            """,
            (card_id, track, srs.DEFAULT_EASE, today.isoformat()),
        )


def backfill_srs_rows(conn: sqlite3.Connection, today: date | None = None) -> int:
    """補齊所有卡片的排程列（例如新增 track 之後）。回傳補了幾列。"""
    today = (today or date.today()).isoformat()
    before = conn.execute("SELECT COUNT(*) AS n FROM srs_state").fetchone()["n"]
    for track in dbmod.TRACKS:
        conn.execute(
            """
            INSERT OR IGNORE INTO srs_state
                (card_id, track, interval, ease_factor, due_date, review_count, lapse_count)
            SELECT id, ?, 0, ?, ?, 0, 0 FROM cards
            """,
            (track, srs.DEFAULT_EASE, today),
        )
    after = conn.execute("SELECT COUNT(*) AS n FROM srs_state").fetchone()["n"]
    return int(after) - int(before)


def get_srs(conn: sqlite3.Connection, card_id: int, track: str) -> SrsState:
    row = conn.execute(
        "SELECT * FROM srs_state WHERE card_id = ? AND track = ?", (card_id, track)
    ).fetchone()
    if row:
        return SrsState.from_row(row)
    state = srs.new_state(card_id, track)
    save_srs(conn, state)
    return state


def save_srs(conn: sqlite3.Connection, state: SrsState) -> None:
    conn.execute(
        """
        INSERT INTO srs_state (card_id, track, interval, ease_factor, due_date,
                               review_count, lapse_count, last_reviewed)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(card_id, track) DO UPDATE SET
            interval      = excluded.interval,
            ease_factor   = excluded.ease_factor,
            due_date      = excluded.due_date,
            review_count  = excluded.review_count,
            lapse_count   = excluded.lapse_count,
            last_reviewed = excluded.last_reviewed
        """,
        (
            state.card_id, state.track, state.interval, state.ease_factor,
            state.due_date, state.review_count, state.lapse_count, state.last_reviewed,
        ),
    )


def due_items(
    conn: sqlite3.Connection,
    track: str,
    *,
    today: date | None = None,
    limit: int = 30,
    topic: str | None = None,
    category: str | None = None,
    card_type: str | None = None,
    require_fields: Sequence[str] = (),
    require_any_fields: Sequence[str] = (),
    include_new: bool = True,
    ignore_daily_limit: bool = False,
) -> list[ReviewItem]:
    """撈出某個 track 今天（含逾期）該複習的卡片。

    到期日早的排前面；同一天的隨機打散，避免每次順序都一樣。
    """
    today = today or date.today()
    sql = [
        """
        SELECT c.*, s.track, s.interval, s.ease_factor, s.due_date,
               s.review_count, s.lapse_count, s.last_reviewed
        FROM cards c
        JOIN srs_state s ON s.card_id = c.id AND s.track = ?
        WHERE s.due_date <= ?
        """
    ]
    args: list[Any] = [track, today.isoformat()]
    if not include_new:
        sql.append("AND s.review_count > 0")
    if card_type:
        sql.append("AND c.card_type = ?")
        args.append(card_type)
    if topic:
        clause, value = _topic_clause(conn, topic)
        sql.append(clause.replace("AND topic", "AND c.topic"))
        args.append(value)
    if category:
        sql.append("AND c.category LIKE ?")
        args.append(f"%{category}%")
    for field_name in require_fields:
        if field_name not in CARD_TEXT_FIELDS:
            continue
        sql.append(f"AND TRIM(c.{field_name}) <> ''")
    # 「這幾個欄位至少要有一個」—— 用來確保卡片背面不是空的
    any_fields = [f for f in require_any_fields if f in CARD_TEXT_FIELDS]
    if any_fields:
        sql.append("AND (" + " OR ".join(f"TRIM(c.{f}) <> ''" for f in any_fields) + ")")
    sql.append("ORDER BY s.due_date ASC, RANDOM()")

    rows = conn.execute(" ".join(sql), args).fetchall()
    items: list[ReviewItem] = []
    for row in rows:
        data = dict(row)
        state = SrsState.from_row({**data, "card_id": data["id"]})
        items.append(ReviewItem(card=Card.from_row(data), state=state))
    if not ignore_daily_limit:
        items = _apply_daily_limit(conn, items, track, today)
    return items[: max(1, int(limit))]


def due_count(
    conn: sqlite3.Connection,
    track: str,
    *,
    today: date | None = None,
    card_type: str | None = None,
    require_fields: Sequence[str] = (),
) -> int:
    """今天實際會出幾題（已套用每日新卡上限，跟真的練起來的量一致）。"""
    return len(
        due_items(
            conn,
            track,
            today=today,
            limit=10_000,
            card_type=card_type,
            require_fields=require_fields,
        )
    )


# ------------------------------------------------------------ 複習紀錄


def log_review(
    conn: sqlite3.Connection,
    card_id: int,
    track: str,
    rating: int,
    interval_before: float,
    interval_after: float,
    reviewed_at: str | None = None,
) -> None:
    conn.execute(
        """
        INSERT INTO review_log (card_id, track, rating, reviewed_at,
                                interval_before, interval_after)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (card_id, track, rating, reviewed_at or now_iso(), interval_before, interval_after),
    )


def grade(
    conn: sqlite3.Connection,
    item: ReviewItem,
    rating: int,
    *,
    today: date | None = None,
    rng: Any = None,
) -> SrsState:
    """評分：更新排程 + 寫入紀錄，兩件事在同一個交易裡。"""
    before = item.state.interval
    stamp = stamp_for(today)
    new_state = srs.schedule(item.state, rating, today=today, rng=rng, reviewed_at=stamp)
    with dbmod.transaction(conn):
        save_srs(conn, new_state)
        log_review(
            conn, item.card.id or 0, item.state.track, rating, before,
            new_state.interval, reviewed_at=stamp,
        )
    item.state = new_state
    return new_state


# ------------------------------------------------------------ 拼字練習


def record_spelling(
    conn: sqlite3.Connection,
    card_id: int,
    user_input: str,
    is_correct: bool,
    today: date | None = None,
) -> None:
    conn.execute(
        "INSERT INTO spelling_attempts (card_id, user_input, is_correct, attempted_at) "
        "VALUES (?, ?, ?, ?)",
        (card_id, user_input[:200], 1 if is_correct else 0, stamp_for(today)),
    )


def spelling_queue(
    conn: sqlite3.Connection,
    *,
    today: date | None = None,
    limit: int = 20,
    topic: str | None = None,
    only_wrong: bool = False,
    show_zh: bool = True,
) -> list[ReviewItem]:
    """拼字練習佇列。

    一般模式：今天到期的卡片，上次拼錯的字排最前面（錯誤清單，隔天優先出現）。
    only_wrong：直接調出錯誤清單，不看到期日 —— 今天剛拼錯的字，
    當下就要能再練一次，不必等到明天。
    show_zh=False（純英文思考模式）時，只靠中文提示才出得了題的卡片會被排除，
    否則會出現「什麼線索都沒有，憑空拼一個字」的題目。
    """
    today = today or date.today()
    last_result_sql = (
        "COALESCE((SELECT a.is_correct FROM spelling_attempts a "
        "WHERE a.card_id = c.id ORDER BY a.id DESC LIMIT 1), -1)"
    )
    sql = [
        f"""
        SELECT c.*, s.track, s.interval, s.ease_factor, s.due_date,
               s.review_count, s.lapse_count, s.last_reviewed,
               {last_result_sql} AS last_result
        FROM cards c
        JOIN srs_state s ON s.card_id = c.id AND s.track = ?
        WHERE TRIM(c.word) <> ''
        """
    ]
    args: list[Any] = [TRACK_SPELLING]
    if only_wrong:
        sql.append(f"AND {last_result_sql} = 0")
    else:
        sql.append("AND s.due_date <= ?")
        args.append(today.isoformat())
        # 至少要有一個線索（例句／中文／英文定義），否則題目無解
        clue = ["TRIM(c.example_sentence) <> ''", "TRIM(c.example_ref) <> ''",
                "TRIM(c.notes) <> ''"]
        if show_zh:
            clue.append("TRIM(c.zh_hint) <> ''")
        sql.append("AND (" + " OR ".join(clue) + ")")
    if topic:
        sql.append("AND c.topic LIKE ?")
        args.append(f"%{topic}%")
    # 排序：拼錯的最優先 → 有「挖空例句 + 中文提示」的完整題目 → 其餘按到期日。
    # 只有英文定義可用的 AWL 字頭卡排最後，不要淹掉設計好的題型。
    zh_usable = "TRIM(c.zh_hint) <> ''" if show_zh else "0"
    has_sentence = "(TRIM(c.example_sentence) <> '' OR TRIM(c.example_ref) <> '')"
    sql.append(
        "ORDER BY CASE WHEN last_result = 0 THEN 0 ELSE 1 END, "
        f"CASE WHEN {has_sentence} AND {zh_usable} THEN 0 "
        f"     WHEN {has_sentence} OR {zh_usable} THEN 1 "
        "     ELSE 2 END, "
        "s.due_date ASC, RANDOM() LIMIT ?"
    )
    args.append(max(1, int(limit)) * 40)

    rows = conn.execute(" ".join(sql), args).fetchall()
    items: list[ReviewItem] = []
    for row in rows:
        data = dict(row)
        state = SrsState.from_row({**data, "card_id": data["id"]})
        items.append(ReviewItem(card=Card.from_row(data), state=state))
    if not only_wrong:
        items = _apply_daily_limit(conn, items, TRACK_SPELLING, today)
    return items[: max(1, int(limit))]


def spelling_error_list(conn: sqlite3.Connection, limit: int = 20) -> list[dict[str, Any]]:
    """最常拼錯的字（依錯誤次數排序）。"""
    rows = conn.execute(
        """
        SELECT c.id, c.word, c.pos, c.topic,
               SUM(CASE WHEN a.is_correct = 0 THEN 1 ELSE 0 END) AS wrong,
               COUNT(*) AS total
        FROM spelling_attempts a
        JOIN cards c ON c.id = a.card_id
        GROUP BY c.id
        HAVING wrong > 0
        ORDER BY wrong DESC, total DESC, c.word COLLATE NOCASE
        LIMIT ?
        """,
        (int(limit),),
    ).fetchall()
    return [dict(r) for r in rows]


def spelling_accuracy(conn: sqlite3.Connection, days: int | None = None) -> dict[str, Any]:
    sql = ["SELECT COUNT(*) AS total, SUM(is_correct) AS correct FROM spelling_attempts"]
    args: list[Any] = []
    if days:
        sql.append("WHERE attempted_at >= ?")
        args.append((date.today() - timedelta(days=days)).isoformat())
    row = conn.execute(" ".join(sql), args).fetchone()
    total = int(row["total"] or 0)
    correct = int(row["correct"] or 0)
    return {
        "total": total,
        "correct": correct,
        "wrong": total - correct,
        "accuracy": (correct / total) if total else 0.0,
    }


# ------------------------------------------------------------ 主動輸出


def add_production(
    conn: sqlite3.Connection,
    card_id: int,
    topic: str,
    prompt: str,
    sentence: str,
    today: date | None = None,
) -> int:
    cur = conn.execute(
        "INSERT INTO productions (card_id, topic, prompt, sentence, created_at) "
        "VALUES (?, ?, ?, ?, ?)",
        (card_id, topic, prompt, sentence.strip(), stamp_for(today)),
    )
    return int(cur.lastrowid)


def list_productions(
    conn: sqlite3.Connection, *, limit: int | None = None, status: str | None = None
) -> list[Production]:
    sql = [
        "SELECT p.*, c.word FROM productions p JOIN cards c ON c.id = p.card_id WHERE 1=1"
    ]
    args: list[Any] = []
    if status:
        sql.append("AND p.status = ?")
        args.append(status)
    sql.append("ORDER BY p.created_at DESC, p.id DESC")
    if limit:
        sql.append("LIMIT ?")
        args.append(int(limit))
    return [Production.from_row(r) for r in conn.execute(" ".join(sql), args).fetchall()]


def production_candidates(
    conn: sqlite3.Connection, *, limit: int = 10, topic: str | None = None
) -> list[Card]:
    """主動輸出要練的字：active 卡片中，造句次數最少、最久沒用的優先。"""
    sql = [
        """
        SELECT c.*, COUNT(p.id) AS used,
               COALESCE(MAX(p.created_at), '') AS last_used
        FROM cards c
        LEFT JOIN productions p ON p.card_id = c.id
        WHERE c.card_type = 'active'
        """
    ]
    args: list[Any] = []
    if topic:
        clause, value = _topic_clause(conn, topic)
        sql.append(clause.replace("AND topic", "AND c.topic"))
        args.append(value)
    sql.append("GROUP BY c.id ORDER BY used ASC, last_used ASC, RANDOM() LIMIT ?")
    args.append(max(1, int(limit)))
    return [Card.from_row(r) for r in conn.execute(" ".join(sql), args).fetchall()]


def promotion_candidates(
    conn: sqlite3.Connection,
    *,
    limit: int = 12,
    min_reviews: int = 3,
    topic: str | None = None,
) -> list[Card]:
    """可以從 passive 升級成 active 的字：認讀已經穩、失誤不多的優先。"""
    sql = [
        """
        SELECT c.*, s.review_count, s.interval, s.lapse_count
        FROM cards c
        JOIN srs_state s ON s.card_id = c.id AND s.track = ?
        WHERE c.card_type = 'passive'
          AND s.review_count >= ?
          AND TRIM(c.example_sentence) <> ''
        """
    ]
    args: list[Any] = [TRACK_RECALL, int(min_reviews)]
    if topic:
        clause, value = _topic_clause(conn, topic)
        sql.append(clause.replace("AND topic", "AND c.topic"))
        args.append(value)
    sql.append(
        "ORDER BY (s.interval - s.lapse_count * 2) DESC, s.review_count DESC LIMIT ?"
    )
    args.append(max(1, int(limit)))
    return [Card.from_row(r) for r in conn.execute(" ".join(sql), args).fetchall()]


# ---------------------------------------------------------------- 統計


def counts_by(conn: sqlite3.Connection, column: str) -> list[dict[str, Any]]:
    """依 category / topic 統計覆蓋進度。"""
    if column not in ("category", "topic"):
        raise ValueError("只支援 category / topic")
    rows = conn.execute(
        f"""
        SELECT CASE WHEN TRIM(c.{column}) = '' THEN '(未分類)' ELSE c.{column} END AS name,
               COUNT(*) AS total,
               SUM(CASE WHEN s.review_count > 0 THEN 1 ELSE 0 END) AS started,
               SUM(CASE WHEN s.interval >= 21 THEN 1 ELSE 0 END) AS mature,
               SUM(CASE WHEN c.card_type = 'active' THEN 1 ELSE 0 END) AS active
        FROM cards c
        LEFT JOIN srs_state s ON s.card_id = c.id AND s.track = '{TRACK_RECALL}'
        GROUP BY name
        ORDER BY total DESC, name
        """
    ).fetchall()
    return [dict(r) for r in rows]


def card_type_counts(conn: sqlite3.Connection) -> dict[str, int]:
    rows = conn.execute(
        "SELECT card_type, COUNT(*) AS n FROM cards GROUP BY card_type"
    ).fetchall()
    counts = {t: 0 for t in dbmod.CARD_TYPES}
    for row in rows:
        counts[str(row["card_type"])] = int(row["n"])
    return counts


def incomplete_count(conn: sqlite3.Connection) -> int:
    return int(
        conn.execute("SELECT COUNT(*) AS n FROM cards WHERE is_incomplete = 1").fetchone()["n"]
    )


def activity_days(conn: sqlite3.Connection) -> set[str]:
    """有學習活動的日期集合（複習 / 拼字 / 造句都算）。"""
    days: set[str] = set()
    queries = (
        "SELECT DISTINCT substr(reviewed_at, 1, 10) AS d FROM review_log",
        "SELECT DISTINCT substr(attempted_at, 1, 10) AS d FROM spelling_attempts",
        "SELECT DISTINCT substr(created_at, 1, 10) AS d FROM productions",
    )
    for sql in queries:
        for row in conn.execute(sql).fetchall():
            if row["d"]:
                days.add(str(row["d"]))
    return days


def reviews_between(
    conn: sqlite3.Connection, start: date, end: date, track: str | None = None
) -> int:
    sql = ["SELECT COUNT(*) AS n FROM review_log WHERE reviewed_at >= ? AND reviewed_at < ?"]
    args: list[Any] = [start.isoformat(), (end + timedelta(days=1)).isoformat()]
    if track:
        sql.append("AND track = ?")
        args.append(track)
    return int(conn.execute(" ".join(sql), args).fetchone()["n"])


def new_cards_learned(conn: sqlite3.Connection, since: date) -> int:
    """自 since 起「第一次被複習」的卡片數 —— 這才是真正的本週新學。"""
    row = conn.execute(
        """
        SELECT COUNT(*) AS n FROM (
            SELECT card_id, MIN(reviewed_at) AS first_seen
            FROM review_log GROUP BY card_id
        ) WHERE first_seen >= ?
        """,
        (since.isoformat(),),
    ).fetchone()
    return int(row["n"] or 0)


def cards_added_since(conn: sqlite3.Connection, since: date) -> int:
    row = conn.execute(
        "SELECT COUNT(*) AS n FROM cards WHERE created_at >= ?", (since.isoformat(),)
    ).fetchone()
    return int(row["n"] or 0)


def productions_since(conn: sqlite3.Connection, since: date) -> int:
    row = conn.execute(
        "SELECT COUNT(*) AS n FROM productions WHERE created_at >= ?", (since.isoformat(),)
    ).fetchone()
    return int(row["n"] or 0)


def distinct_words_used(conn: sqlite3.Connection) -> int:
    row = conn.execute(
        "SELECT COUNT(DISTINCT card_id) AS n FROM productions"
    ).fetchone()
    return int(row["n"] or 0)


def rating_breakdown(conn: sqlite3.Connection, since: date | None = None) -> dict[int, int]:
    sql = ["SELECT rating, COUNT(*) AS n FROM review_log"]
    args: list[Any] = []
    if since:
        sql.append("WHERE reviewed_at >= ?")
        args.append(since.isoformat())
    sql.append("GROUP BY rating")
    result = {r: 0 for r in srs.RATINGS}
    for row in conn.execute(" ".join(sql), args).fetchall():
        rating = int(row["rating"])
        if rating in result:
            result[rating] = int(row["n"])
    return result


def synonym_pool(
    conn: sqlite3.Connection,
    *,
    today: date | None = None,
    limit: int = 15,
    topic: str | None = None,
) -> list[ReviewItem]:
    """同義詞測驗題庫：至少要有 2 個同義詞的卡片。"""
    items = due_items(
        conn,
        TRACK_SYNONYM,
        today=today,
        limit=limit * 3,
        topic=topic,
        require_fields=("synonyms",),
    )
    usable = [i for i in items if len(i.card.synonym_list) >= 2]
    return usable[:limit]


def iter_all_cards(conn: sqlite3.Connection) -> Iterable[Card]:
    for row in conn.execute("SELECT * FROM cards ORDER BY id").fetchall():
        yield Card.from_row(row)
