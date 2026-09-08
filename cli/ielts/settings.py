"""使用者偏好設定，存在 meta 表裡（跟卡片、排程放同一個資料庫檔）。

目前只有一項：要不要顯示中文意思。
中文是校對用的，不是記憶點，所以卡片背面固定把它排在最後；
程度上來之後可以整個關掉，強迫自己純英文思考。

網頁版的對應物是 js/store.js 的 Store.getPrefs / setPrefs。
"""

from __future__ import annotations

import sqlite3

from .db import get_meta, set_meta, transaction

SHOW_ZH_KEY = "show_zh"
DEFAULTS = {SHOW_ZH_KEY: True}


def _to_bool(raw: str | None, fallback: bool) -> bool:
    if raw is None:
        return fallback
    return raw.strip().lower() in {"1", "true", "on", "yes", "y"}


def show_zh(conn: sqlite3.Connection) -> bool:
    """現在要不要顯示中文。整個 CLI 只認這一個判斷。"""
    return _to_bool(get_meta(conn, SHOW_ZH_KEY), DEFAULTS[SHOW_ZH_KEY])


def set_show_zh(conn: sqlite3.Connection, value: bool) -> bool:
    with transaction(conn):
        set_meta(conn, SHOW_ZH_KEY, "1" if value else "0")
    return value


def as_dict(conn: sqlite3.Connection) -> dict[str, bool]:
    return {SHOW_ZH_KEY: show_zh(conn)}
