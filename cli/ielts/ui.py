"""終端機輸出與輸入。

有裝 rich 就用 rich 畫框線與表格；沒裝就自動降級成 ANSI 純文字，
程式照樣能跑（通勤時筆電沒網路也裝得起來）。

輸入分兩種：
  * key()  —— 單鍵操作，通勤時單手就能連續複習
  * ask()  —— 整行輸入，用在拼字、造句、補完欄位
兩者都會把 Ctrl-C / EOF / q 轉成 QuitSession，讓上層乾淨收尾。
"""

from __future__ import annotations

import os
import sys
import unicodedata
from typing import Iterable, Sequence

from .errors import QuitSession

try:  # rich 是選用依賴
    from rich.console import Console as _RichConsole
    from rich.panel import Panel as _RichPanel
    from rich.table import Table as _RichTable
    from rich.text import Text as _RichText

    RICH_AVAILABLE = True
except Exception:  # pragma: no cover - 端看環境有沒有裝
    RICH_AVAILABLE = False

_ANSI = {
    "reset": "\033[0m",
    "bold": "\033[1m",
    "dim": "\033[2m",
    "word": "\033[1;36m",
    "hint": "\033[33m",
    "ok": "\033[32m",
    "bad": "\033[31m",
    "key": "\033[1;35m",
    "title": "\033[1;34m",
    "label": "\033[2;37m",
}

_RICH_STYLES = {
    "bold": "bold",
    "dim": "dim",
    "word": "bold cyan",
    "hint": "yellow",
    "ok": "green",
    "bad": "red",
    "key": "bold magenta",
    "title": "bold blue",
    "label": "dim white",
}

QUIT_KEYS = {"q", "\x03", "\x04"}


def display_width(text: str) -> int:
    """計算終端機顯示寬度（中日韓全形字算 2 欄）。"""
    width = 0
    for ch in text:
        if unicodedata.combining(ch):
            continue
        width += 2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1
    return width


def pad(text: str, width: int, align: str = "left") -> str:
    gap = max(0, width - display_width(text))
    if align == "right":
        return " " * gap + text
    if align == "center":
        left = gap // 2
        return " " * left + text + " " * (gap - left)
    return text + " " * gap


def truncate(text: str, width: int) -> str:
    if display_width(text) <= width:
        return text
    out = ""
    for ch in text:
        if display_width(out + ch) > max(1, width - 1):
            break
        out += ch
    return out + "…"


class UI:
    def __init__(self, plain: bool = False, color: bool = True) -> None:
        self.use_rich = RICH_AVAILABLE and not plain
        self.color = color and (plain or not RICH_AVAILABLE) and self._supports_color()
        self.console = _RichConsole(no_color=not color) if self.use_rich else None
        self.width = self._detect_width()

    # ------------------------------------------------------------ 內部
    @staticmethod
    def _supports_color() -> bool:
        if os.environ.get("NO_COLOR"):
            return False
        return sys.stdout.isatty()

    @staticmethod
    def _detect_width(default: int = 78) -> int:
        try:
            return max(40, min(100, os.get_terminal_size().columns))
        except OSError:
            return default

    def _style(self, text: str, style: str | None) -> str:
        if not style or not self.color or style not in _ANSI:
            return text
        return f"{_ANSI[style]}{text}{_ANSI['reset']}"

    # ------------------------------------------------------------ 輸出
    def print(self, text: str = "", style: str | None = None) -> None:
        if self.console is not None:
            # 一律包成 Text：卡片內容可能含有 [ ]，不能讓 rich 當成 markup 解析
            self.console.print(
                _RichText(text, style=_RICH_STYLES.get(style or "", "")), highlight=False
            )
        else:
            print(self._style(text, style))

    def blank(self) -> None:
        self.print("")

    def rule(self, title: str = "") -> None:
        if self.console is not None:
            self.console.rule(_RichText(title) if title else "")
            return
        if not title:
            self.print("─" * self.width, "dim")
            return
        head = f"── {title} "
        self.print(head + "─" * max(0, self.width - display_width(head)), "title")

    def panel(self, lines: Sequence[str], title: str = "", style: str | None = None) -> None:
        body = "\n".join(lines)
        if self.console is not None:
            self.console.print(
                _RichPanel(
                    _RichText(body),
                    title=_RichText(title) if title else None,
                    border_style=_RICH_STYLES.get(style or "", "cyan"),
                    expand=False,
                )
            )
            return
        inner = max(
            [display_width(line) for line in lines] + [display_width(title) + 2, 20]
        )
        inner = min(inner, self.width - 4)
        top = f"┌─ {title} " if title else "┌"
        self.print(
            self._style(top + "─" * max(0, inner + 3 - display_width(top)) + "┐", style or "dim")
        )
        for line in lines:
            for chunk in self._wrap(line, inner):
                bar = self._style("│", style or "dim")
                self.print(f"{bar} {pad(chunk, inner)} {bar}")
        self.print(self._style("└" + "─" * (inner + 2) + "┘", style or "dim"))

    def _wrap(self, text: str, width: int) -> list[str]:
        if display_width(text) <= width:
            return [text]
        lines: list[str] = []
        current = ""
        for word in text.split(" "):
            candidate = f"{current} {word}".strip()
            if display_width(candidate) > width and current:
                lines.append(current)
                current = word
            else:
                current = candidate
        if current:
            lines.append(current)
        return lines or [""]

    def table(
        self, headers: Sequence[str], rows: Iterable[Sequence[str]], title: str = ""
    ) -> None:
        rows = [[str(c) for c in row] for row in rows]
        if self.console is not None:
            table = _RichTable(
                title=_RichText(title) if title else None, header_style="bold blue"
            )
            for head in headers:
                table.add_column(_RichText(str(head)))
            for row in rows:
                table.add_row(*[_RichText(cell) for cell in row])
            self.console.print(table)
            return
        if title:
            self.print(title, "title")
        widths = [display_width(str(h)) for h in headers]
        for row in rows:
            for i, cell in enumerate(row):
                if i < len(widths):
                    widths[i] = max(widths[i], display_width(cell))
        widths = [min(w, 34) for w in widths]
        header_line = "  ".join(pad(truncate(str(h), widths[i]), widths[i]) for i, h in enumerate(headers))
        self.print(self._style(header_line, "title"))
        self.print(self._style("  ".join("─" * w for w in widths), "dim"))
        for row in rows:
            self.print(
                "  ".join(
                    pad(truncate(cell, widths[i]), widths[i])
                    for i, cell in enumerate(row[: len(widths)])
                )
            )

    def bar(self, label: str, value: float, total: float, width: int = 22, suffix: str = "") -> None:
        ratio = 0.0 if total <= 0 else max(0.0, min(1.0, value / total))
        filled = int(round(ratio * width))
        bar = "█" * filled + "░" * (width - filled)
        text = f"{pad(truncate(label, 16), 16)} {bar} {suffix or f'{value:g}/{total:g}'}"
        self.print(text)

    # 語意化捷徑
    def title(self, text: str) -> None:
        self.print(text, "title")

    def ok(self, text: str) -> None:
        self.print(text, "ok")

    def bad(self, text: str) -> None:
        self.print(text, "bad")

    def dim(self, text: str) -> None:
        self.print(text, "dim")

    def hint(self, text: str) -> None:
        self.print(text, "hint")

    # ------------------------------------------------------------ 輸入
    def key(self, prompt: str, allowed: Iterable[str] | None = None) -> str:
        """讀一個按鍵。回傳小寫字元；Enter 回傳 '\\n'，空白鍵回傳 ' '。

        按 q / Ctrl-C / Ctrl-D 一律丟出 QuitSession，由上層決定怎麼收尾。
        """
        allowed_set = {a.lower() for a in allowed} if allowed else None
        while True:
            ch = self._read_one_key(prompt)
            if ch in QUIT_KEYS:
                raise QuitSession()
            if ch in ("\r", "\n"):
                ch = "\n"
            ch = ch.lower()
            if allowed_set is None or ch in allowed_set:
                return ch
            # 無效按鍵：安靜地再等一次，不洗版

    def _read_one_key(self, prompt: str) -> str:
        if prompt:
            sys.stdout.write(self._style(prompt, "key"))
            sys.stdout.flush()
        try:
            if not sys.stdin.isatty():
                raise OSError("not a tty")
            import termios
            import tty

            fd = sys.stdin.fileno()
            old = termios.tcgetattr(fd)
            try:
                tty.setraw(fd)
                ch = sys.stdin.read(1)
            finally:
                termios.tcsetattr(fd, termios.TCSADRAIN, old)
            if ch == "\x1b":  # 方向鍵之類的跳脫序列，吃掉後續字元
                self._drain_escape()
                ch = "\x1b"
            sys.stdout.write("\n")
            sys.stdout.flush()
            return ch
        except (OSError, ImportError, ValueError):
            # 非互動環境（管線、CI、Windows 舊終端）→ 降級成整行輸入
            try:
                line = input()
            except (EOFError, KeyboardInterrupt):
                raise QuitSession() from None
            stripped = line.strip()
            return stripped[0] if stripped else "\n"
        except KeyboardInterrupt:
            raise QuitSession() from None

    @staticmethod
    def _drain_escape() -> None:
        try:
            import select

            while select.select([sys.stdin], [], [], 0.01)[0]:
                if not sys.stdin.read(1):
                    break
        except Exception:
            pass

    def ask(self, prompt: str, *, default: str = "", allow_empty: bool = True) -> str:
        """讀一整行。空輸入回傳 default；輸入 :q 或 Ctrl-C 離開。"""
        label = f"{prompt}"
        if default:
            label += f" [{default}]"
        label += " "
        while True:
            try:
                sys.stdout.write(self._style(label, "key"))
                sys.stdout.flush()
                raw = input()
            except (EOFError, KeyboardInterrupt):
                self.blank()
                raise QuitSession() from None
            value = raw.strip()
            if value in (":q", ":quit"):
                raise QuitSession()
            if not value:
                if default:
                    return default
                if allow_empty:
                    return ""
                self.dim("（不能空白，或輸入 :q 離開）")
                continue
            return value[:2000]

    def confirm(self, prompt: str, default: bool = True) -> bool:
        suffix = "[Y/n]" if default else "[y/N]"
        answer = self.ask(f"{prompt} {suffix}", allow_empty=True).lower()
        if not answer:
            return default
        return answer.startswith("y")

    def progress(self, current: int, total: int) -> str:
        return f"{current}/{total}"
