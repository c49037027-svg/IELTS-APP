"""執行環境：一個 AppContext 打包連線、UI 與「今天」。

模式函式統一接收 ctx，測試時可以塞入 in-memory 連線與固定日期。
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field
from datetime import date
from random import Random

from .ui import UI


@dataclass
class AppContext:
    conn: sqlite3.Connection
    ui: UI
    today: date = field(default_factory=date.today)
    rng: Random = field(default_factory=Random)

    def close(self) -> None:
        try:
            self.conn.close()
        except sqlite3.Error:
            pass
