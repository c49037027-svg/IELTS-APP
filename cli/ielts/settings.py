"""使用者偏好設定，存在 meta 表裡（跟卡片、排程放同一個資料庫檔）。

兩項：
  show_zh      要不要顯示中文意思。中文是校對用的，不是記憶點，所以卡片背面
               固定把它排在最後；程度上來之後可以整個關掉，純英文思考。
  new_per_day  每天最多認識幾個新字。只擋新字 —— 到期的舊字一律照排程出。

網頁版的對應物是 js/store.js 的 Store.getPrefs / setPrefs。
"""

from __future__ import annotations

import sqlite3

from .db import get_meta, set_meta, transaction

SHOW_ZH_KEY = "show_zh"
NEW_PER_DAY_KEY = "new_per_day"

#: 每天最多放幾個沒學過的新字進來。到期的舊字不受這個上限 ——
#: 沒有這個上限，整份 AWL 會在第一天全部到期，等於沒有排程。
NEW_PER_DAY_DEFAULT = 30
NEW_PER_DAY_MIN = 5
NEW_PER_DAY_MAX = 60

DEFAULTS = {SHOW_ZH_KEY: True, NEW_PER_DAY_KEY: NEW_PER_DAY_DEFAULT}


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


def clamp_new_per_day(value: object) -> int:
    """把使用者給的數字夾到合理範圍，看不懂就退回預設值。"""
    try:
        number = int(str(value).strip())
    except (TypeError, ValueError):
        return NEW_PER_DAY_DEFAULT
    return max(NEW_PER_DAY_MIN, min(NEW_PER_DAY_MAX, number))


def new_per_day(conn: sqlite3.Connection) -> int:
    """今天最多認識幾個新字。整個 CLI 只認這一個數字。"""
    raw = get_meta(conn, NEW_PER_DAY_KEY)
    if raw is None:
        return NEW_PER_DAY_DEFAULT
    return clamp_new_per_day(raw)


def set_new_per_day(conn: sqlite3.Connection, value: object) -> int:
    number = clamp_new_per_day(value)
    with transaction(conn):
        set_meta(conn, NEW_PER_DAY_KEY, str(number))
    return number


def as_dict(conn: sqlite3.Connection) -> dict[str, object]:
    return {SHOW_ZH_KEY: show_zh(conn), NEW_PER_DAY_KEY: new_per_day(conn)}
