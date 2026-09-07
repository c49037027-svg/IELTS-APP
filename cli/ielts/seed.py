"""預載 30 個雅思常用字。

種子資料放在 data/seed_cards.csv，走的是跟一般 CSV 匯入完全相同的路徑 ——
所以只要種子灌得進去，你自己的 CSV 也灌得進去。
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

from . import db as dbmod
from . import importer

SEED_PATH = Path(__file__).resolve().parent / "data" / "seed_cards.csv"


def seed_path() -> Path:
    return SEED_PATH


def load_seed(conn: sqlite3.Connection, *, update: bool = False) -> importer.ImportResult:
    if not SEED_PATH.exists():
        raise FileNotFoundError(f"找不到種子資料：{SEED_PATH}")
    return importer.import_csv(conn, SEED_PATH, update=update)


def is_empty(conn: sqlite3.Connection) -> bool:
    return dbmod.card_count(conn) == 0
