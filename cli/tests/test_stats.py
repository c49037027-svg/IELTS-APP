"""統計與 streak 計算測試。"""

import contextlib
import io
import unittest
from datetime import date, timedelta

from ielts import db as dbmod
from ielts import repository as repo, seed, srs, stats
from ielts.context import AppContext
from ielts.db import TRACK_RECALL
from ielts.ui import UI

TODAY = date.today()


def days(*offsets: int) -> set[str]:
    return {(TODAY - timedelta(days=o)).isoformat() for o in offsets}


class TestStreak(unittest.TestCase):
    def test_no_activity_is_zero(self):
        self.assertEqual(stats.current_streak(set(), TODAY), 0)

    def test_today_only(self):
        self.assertEqual(stats.current_streak(days(0), TODAY), 1)

    def test_consecutive_days(self):
        self.assertEqual(stats.current_streak(days(0, 1, 2, 3), TODAY), 4)

    def test_yesterday_still_counts_today_not_yet_studied(self):
        self.assertEqual(stats.current_streak(days(1, 2), TODAY), 2)

    def test_gap_breaks_the_streak(self):
        self.assertEqual(stats.current_streak(days(0, 1, 3, 4), TODAY), 2)

    def test_two_day_gap_resets_to_zero(self):
        self.assertEqual(stats.current_streak(days(2, 3), TODAY), 0)

    def test_longest_streak(self):
        self.assertEqual(stats.longest_streak(days(0, 1, 5, 6, 7, 8)), 4)
        self.assertEqual(stats.longest_streak(set()), 0)


class TestDashboard(unittest.TestCase):
    def setUp(self):
        self.conn = dbmod.connect(":memory:")
        seed.load_seed(self.conn)
        self.ctx = AppContext(conn=self.conn, ui=UI(plain=True, color=False), today=TODAY)

    def tearDown(self):
        self.conn.close()

    def test_collect_reports_the_seeded_library(self):
        data = stats.collect(self.ctx)
        self.assertGreater(data["total_cards"], 700)
        self.assertEqual(sum(data["types"].values()), data["total_cards"])
        self.assertEqual(data["incomplete"], 0, "種子資料的四個維度都寫齊了")
        self.assertGreater(data["due"][TRACK_RECALL], 0)

    def test_reviews_move_the_numbers(self):
        item = repo.due_items(self.conn, TRACK_RECALL, today=TODAY, limit=1)[0]
        repo.grade(self.conn, item, srs.GOOD, today=TODAY)
        data = stats.collect(self.ctx)
        self.assertEqual(data["reviews_today"], 1)
        self.assertEqual(data["new_learned_week"], 1)
        self.assertEqual(data["streak"], 1)

    def test_spelling_errors_show_up(self):
        card = repo.list_cards(self.conn, limit=1)[0]
        repo.record_spelling(self.conn, card.id, "wrongspelling", False)
        data = stats.collect(self.ctx)
        self.assertEqual(data["spelling_all"]["wrong"], 1)
        self.assertEqual(data["spelling_all"]["accuracy"], 0.0)

    def test_render_does_not_crash_on_an_empty_library(self):
        empty = dbmod.connect(":memory:")
        try:
            ctx = AppContext(conn=empty, ui=UI(plain=True, color=False), today=TODAY)
            with contextlib.redirect_stdout(io.StringIO()):
                stats.render(ctx)
        finally:
            empty.close()

    def test_render_full_dashboard(self):
        item = repo.due_items(self.conn, TRACK_RECALL, today=TODAY, limit=1)[0]
        repo.grade(self.conn, item, srs.AGAIN, today=TODAY)
        card = repo.list_cards(self.conn, limit=1)[0]
        repo.record_spelling(self.conn, card.id, "typo", False)
        with contextlib.redirect_stdout(io.StringIO()) as out:
            stats.render(self.ctx, full=True)  # 只驗證不會炸
        self.assertIn("學習儀表板", out.getvalue())


if __name__ == "__main__":
    unittest.main()
