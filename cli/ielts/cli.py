"""命令列進入點：argparse 子指令分派 + 全域錯誤處理。"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from datetime import date

from . import db as dbmod
from . import importer, repository as repo, seed, stats
from .context import AppContext
from .errors import IeltsError, QuitSession
from .models import Card
from .modes import commute, complete, production, spelling, synonym
from .ui import UI

PROG = "ielts"
DESCRIPTION = "IELTS 單字學習 CLI —— 例句 / 搭配詞 / 字根 / 同義詞 四維度記憶"

EPILOG = """\
常用流程：
  ielts init                  建立資料庫並灌入 30 個範例字
  ielts stats                 看今天要做什麼
  ielts review --limit 30     通勤複習（模式 A）
  ielts spell --limit 20      拼字練習（模式 B）
  ielts syn                   同義詞群測驗
  ielts promote               每週把熟的字升級成 active
  ielts produce               主動輸出造句（模式 C）
"""


# ---------------------------------------------------------------- 指令


def cmd_init(ctx: AppContext, args: argparse.Namespace) -> int:
    ui = ctx.ui
    if not seed.is_empty(ctx.conn) and not args.force:
        ui.hint(
            f"資料庫已經有 {dbmod.card_count(ctx.conn)} 張卡片，沒有重複灌入。"
            "（要更新種子內容用 --force）"
        )
    else:
        result = seed.load_seed(ctx.conn, update=args.force)
        ui.ok(
            f"✓ 種子資料完成：新增 {result.added} 張、更新 {result.updated} 張、"
            f"略過 {result.skipped} 張"
        )
    added = repo.backfill_srs_rows(ctx.conn, today=ctx.today)
    if added:
        ui.dim(f"（補齊 {added} 筆排程狀態）")
    ui.print(f"資料庫位置：{args.db or dbmod.default_db_path()}")
    ui.blank()
    stats.render(ctx)
    return 0


def cmd_review(ctx: AppContext, args: argparse.Namespace) -> int:
    commute.run(
        ctx,
        limit=args.limit,
        topic=args.topic,
        category=args.category,
        include_active=args.all,
        show_zh=args.zh,
    )
    return 0


def cmd_spell(ctx: AppContext, args: argparse.Namespace) -> int:
    if args.list:
        spelling.show_error_list(ctx, limit=args.limit)
        return 0
    spelling.run(ctx, limit=args.limit, topic=args.topic, only_wrong=args.only_wrong)
    return 0


def cmd_syn(ctx: AppContext, args: argparse.Namespace) -> int:
    synonym.run(ctx, limit=args.limit, topic=args.topic, target=args.target)
    return 0


def cmd_produce(ctx: AppContext, args: argparse.Namespace) -> int:
    if args.history:
        production.show_history(ctx, limit=args.count)
        return 0
    production.run(ctx, count=args.count, topic=args.topic)
    return 0


def cmd_promote(ctx: AppContext, args: argparse.Namespace) -> int:
    production.promote(
        ctx,
        count=args.count,
        min_reviews=args.min_reviews,
        topic=args.topic,
        dry_run=args.dry_run,
        assume_yes=args.yes,
    )
    return 0


def cmd_complete(ctx: AppContext, args: argparse.Namespace) -> int:
    complete.run(ctx, limit=args.limit, word=args.word)
    return 0


def cmd_import(ctx: AppContext, args: argparse.Namespace) -> int:
    ui = ctx.ui
    try:
        result = importer.import_csv(ctx.conn, args.path, update=args.update)
    except FileNotFoundError as exc:
        raise IeltsError(str(exc)) from exc
    except UnicodeDecodeError as exc:
        raise IeltsError(f"檔案編碼無法辨識：{exc}") from exc
    ui.ok(
        f"✓ 匯入完成：新增 {result.added} 張 ｜ 更新 {result.updated} 張 "
        f"｜ 略過 {result.skipped} 張 ｜ 不完整 {result.incomplete} 張"
    )
    for message in result.errors[:10]:
        ui.dim(f"  {message}")
    if len(result.errors) > 10:
        ui.dim(f"  …另外還有 {len(result.errors) - 10} 個問題")
    if result.incomplete:
        ui.hint(f"用 `ielts complete` 逐一補完那 {result.incomplete} 張卡的缺漏欄位。")
    return 0


def cmd_template(ctx: AppContext, args: argparse.Namespace) -> int:
    path = importer.write_template(args.path)
    ctx.ui.ok(f"✓ 已產生 CSV 範本：{path}")
    ctx.ui.dim("只有 word 是必填；其他欄位空著匯入後會標記為 incomplete。")
    return 0


def cmd_export(ctx: AppContext, args: argparse.Namespace) -> int:
    path = importer.export_csv(ctx.conn, args.path)
    ctx.ui.ok(f"✓ 已匯出 {dbmod.card_count(ctx.conn)} 張卡片到 {path}")
    return 0


def cmd_export_productions(ctx: AppContext, args: argparse.Namespace) -> int:
    production.export(ctx, args.out, limit=args.limit)
    return 0


def cmd_stats(ctx: AppContext, args: argparse.Namespace) -> int:
    stats.render(ctx, full=args.full)
    return 0


def cmd_list(ctx: AppContext, args: argparse.Namespace) -> int:
    cards = repo.list_cards(
        ctx.conn,
        topic=args.topic,
        category=args.category,
        card_type=args.type,
        incomplete_only=args.incomplete,
        search=args.search,
        limit=args.limit,
    )
    if not cards:
        ctx.ui.hint("沒有符合條件的卡片。")
        return 0
    ctx.ui.table(
        ["單字", "詞性", "分類", "主題", "類型", "狀態"],
        [
            [
                c.word,
                c.pos or "-",
                c.category or "-",
                c.topic or "-",
                c.card_type,
                "不完整" if c.is_incomplete else "完整",
            ]
            for c in cards
        ],
        title=f"共 {len(cards)} 張",
    )
    return 0


def cmd_show(ctx: AppContext, args: argparse.Namespace) -> int:
    from . import render as render_mod

    cards = repo.list_cards(ctx.conn, search=args.word, limit=5)
    if not cards:
        ctx.ui.hint(f"找不到包含「{args.word}」的卡片。")
        return 1
    for card in cards:
        ctx.ui.panel(
            render_mod.back_lines(card, show_zh=True), title=card.label, style="word"
        )
        for track in dbmod.TRACKS:
            state = repo.get_srs(ctx.conn, card.id or 0, track)
            ctx.ui.dim(
                f"  {dbmod.TRACK_LABELS[track]}：複習 {state.review_count} 次 ｜ "
                f"間隔 {state.interval:g} 天 ｜ 下次 {state.due_date} ｜ "
                f"忘記 {state.lapse_count} 次"
            )
        ctx.ui.blank()
    return 0


def cmd_add(ctx: AppContext, args: argparse.Namespace) -> int:
    ui = ctx.ui
    ui.rule("新增卡片")
    ui.dim("留白的欄位會標記成 incomplete，之後可用 `ielts complete` 補。輸入 :q 取消。")
    try:
        word = args.word or ui.ask("單字 ›", allow_empty=False)
        card = Card(
            word=word,
            pos=ui.ask("詞性 ›", allow_empty=True),
            example_sentence=ui.ask("英文例句 ›", allow_empty=True),
            collocations=ui.ask("搭配詞（分號分隔）›", allow_empty=True),
            root_analysis=ui.ask("字根拆解 ›", allow_empty=True),
            synonyms=ui.ask("同義詞（分號分隔）›", allow_empty=True),
            category=ui.ask("分類 ›", default="AWL"),
            topic=ui.ask("主題 ›", allow_empty=True),
            zh_hint=ui.ask("中文提示（只在拼字模式顯示）›", allow_empty=True),
            card_type="passive",
        )
    except QuitSession:
        ui.dim("已取消。")
        return 0

    existing = repo.find_card(ctx.conn, card.word, card.pos)
    if existing:
        ui.hint(f"「{card.label}」已經在單字庫裡了（id={existing.id}）。")
        return 1
    with dbmod.transaction(ctx.conn):
        card_id = repo.add_card(ctx.conn, card, today=ctx.today)
    missing = card.missing_core_fields()
    ui.ok(f"✓ 已新增 {card.label}（id={card_id}）")
    if missing:
        ui.dim("缺少：" + "、".join(missing) + " → 之後用 `ielts complete` 補完")
    return 0


# ------------------------------------------------------------ argparse


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog=PROG,
        description=DESCRIPTION,
        epilog=EPILOG,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--db", help="資料庫路徑（預設 cli/ielts.db，或環境變數 IELTS_DB）")
    parser.add_argument("--plain", action="store_true", help="不使用 rich，純文字輸出")
    parser.add_argument("--no-color", action="store_true", help="關閉顏色")
    parser.add_argument(
        "--date", help="以指定日期執行（YYYY-MM-DD，測試排程用）", default=None
    )
    sub = parser.add_subparsers(dest="command")

    p = sub.add_parser("init", help="建立資料庫並灌入 30 個範例字")
    p.add_argument("--force", action="store_true", help="即使已有資料也重新灌入/更新種子")
    p.set_defaults(func=cmd_init)

    p = sub.add_parser("review", help="模式 A：通勤複習（passive 卡片）")
    p.add_argument("--limit", type=int, default=30, help="這次要複習幾張（預設 30）")
    p.add_argument("--topic", help="只複習某個主題")
    p.add_argument("--category", help="只複習某個分類")
    p.add_argument("--all", action="store_true", help="連 active 卡片也一起複習")
    p.add_argument("--zh", action="store_true", help="背面也顯示中文提示（預設不顯示）")
    p.set_defaults(func=cmd_review)

    p = sub.add_parser("spell", help="模式 B：拼字練習")
    p.add_argument("--limit", type=int, default=20, help="這次要練幾題（預設 20）")
    p.add_argument("--topic", help="只練某個主題")
    p.add_argument("--only-wrong", action="store_true", help="只練錯誤清單裡的字")
    p.add_argument("--list", action="store_true", help="只列出最常拼錯的字，不作答")
    p.set_defaults(func=cmd_spell)

    p = sub.add_parser("syn", help="同義詞群測驗")
    p.add_argument("--limit", type=int, default=15, help="這次要出幾題（預設 15）")
    p.add_argument("--topic", help="只出某個主題")
    p.add_argument("--target", type=int, default=2, help="每題至少要列幾個同義詞（預設 2）")
    p.set_defaults(func=cmd_syn)

    p = sub.add_parser("produce", help="模式 C：主動輸出造句")
    p.add_argument("--count", type=int, default=5, help="這次要造幾句（預設 5）")
    p.add_argument("--topic", help="只挑某個主題的字")
    p.add_argument("--history", action="store_true", help="改為列出過去的造句紀錄")
    p.set_defaults(func=cmd_produce)

    p = sub.add_parser("promote", help="把熟的 passive 字升級成 active（每週一次）")
    p.add_argument("--count", type=int, default=12, help="這次升級幾個字（預設 12）")
    p.add_argument("--min-reviews", type=int, default=3, help="至少複習過幾次才夠格（預設 3）")
    p.add_argument("--topic", help="只從某個主題挑")
    p.add_argument("--dry-run", action="store_true", help="只看名單，不實際升級")
    p.add_argument("-y", "--yes", action="store_true", help="不詢問直接升級")
    p.set_defaults(func=cmd_promote)

    p = sub.add_parser("complete", help="補完不完整的卡片")
    p.add_argument("--limit", type=int, default=20, help="這次處理幾張（預設 20）")
    p.add_argument("--word", help="只補特定單字")
    p.set_defaults(func=cmd_complete)

    p = sub.add_parser("import", help="從 CSV 匯入單字")
    p.add_argument("path", help="CSV 檔案路徑")
    p.add_argument("--update", action="store_true", help="已存在的字用檔案內容覆寫")
    p.set_defaults(func=cmd_import)

    p = sub.add_parser("template", help="產生 CSV 匯入範本")
    p.add_argument("path", nargs="?", default="ielts-template.csv", help="輸出路徑")
    p.set_defaults(func=cmd_template)

    p = sub.add_parser("export", help="把整個單字庫匯出成 CSV")
    p.add_argument("path", nargs="?", default="ielts-cards.csv", help="輸出路徑")
    p.set_defaults(func=cmd_export)

    p = sub.add_parser("export-productions", help="把造句紀錄匯出成 markdown（貼給 AI 批改）")
    p.add_argument("--out", help="輸出路徑（預設 productions-YYYY-MM-DD.md）")
    p.add_argument("--limit", type=int, default=None, help="只匯出最近幾句")
    p.set_defaults(func=cmd_export_productions)

    p = sub.add_parser("stats", help="統計儀表板")
    p.add_argument("--full", action="store_true", help="顯示完整版（含評分分布與前 20 錯字）")
    p.set_defaults(func=cmd_stats)

    p = sub.add_parser("list", help="列出卡片")
    p.add_argument("--topic")
    p.add_argument("--category")
    p.add_argument("--type", choices=list(dbmod.CARD_TYPES))
    p.add_argument("--incomplete", action="store_true", help="只列不完整的卡片")
    p.add_argument("--search", help="用單字關鍵字搜尋")
    p.add_argument("--limit", type=int, default=50)
    p.set_defaults(func=cmd_list)

    p = sub.add_parser("show", help="看一張卡的完整內容與排程狀態")
    p.add_argument("word")
    p.set_defaults(func=cmd_show)

    p = sub.add_parser("add", help="手動新增一張卡片")
    p.add_argument("word", nargs="?", help="單字（省略則互動輸入）")
    p.set_defaults(func=cmd_add)

    return parser


def _parse_date(value: str | None) -> date:
    if not value:
        return date.today()
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise IeltsError(f"--date 格式要是 YYYY-MM-DD，收到 {value!r}") from exc


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if not getattr(args, "func", None):
        parser.print_help()
        return 0

    ui = UI(plain=args.plain, color=not args.no_color)
    conn = None
    try:
        today = _parse_date(args.date)
        conn = dbmod.connect(args.db)
        ctx = AppContext(conn=conn, ui=ui, today=today)
        if args.command != "init" and dbmod.card_count(conn) == 0:
            ui.hint("單字庫是空的。先跑 `ielts init` 灌入 30 個範例字，或用 `ielts import` 匯入。")
            return 1
        return int(args.func(ctx, args) or 0)
    except QuitSession:
        ui.blank()
        ui.dim("已離開。")
        return 0
    except KeyboardInterrupt:
        ui.blank()
        ui.dim("已中斷（進度都存好了）。")
        return 130
    except IeltsError as exc:
        ui.bad(f"錯誤：{exc}")
        return 1
    except FileNotFoundError as exc:
        ui.bad(f"找不到檔案：{exc}")
        return 1
    except sqlite3.Error as exc:
        ui.bad(f"資料庫錯誤：{exc}")
        return 1
    except BrokenPipeError:  # pragma: no cover - 例如 `ielts list | head`
        return 0
    finally:
        if conn is not None:
            try:
                conn.close()
            except sqlite3.Error:
                pass


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
