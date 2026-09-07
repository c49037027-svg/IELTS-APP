"""SM-2 排程演算法測試。"""

import random
import unittest
from datetime import date, timedelta

from ielts import srs
from ielts.models import SrsState

TODAY = date(2026, 3, 1)
NO_JITTER = random.Random(0)


def state(**kwargs) -> SrsState:
    base = dict(card_id=1, track="recall", interval=0.0, ease_factor=2.5,
                due_date=TODAY.isoformat(), review_count=0, lapse_count=0)
    base.update(kwargs)
    return SrsState(**base)


class TestNextInterval(unittest.TestCase):
    def test_first_good_is_one_day(self):
        self.assertEqual(srs.next_interval(state(), srs.GOOD), 1.0)

    def test_first_easy_skips_to_six_days(self):
        self.assertEqual(srs.next_interval(state(), srs.EASY), 6.0)

    def test_second_good_jumps_to_six_days(self):
        self.assertEqual(
            srs.next_interval(state(interval=1.0, review_count=1), srs.GOOD), 6.0
        )

    def test_mature_good_multiplies_by_ease(self):
        result = srs.next_interval(state(interval=10.0, review_count=5, ease_factor=2.5), srs.GOOD)
        self.assertAlmostEqual(result, 25.0)

    def test_hard_uses_small_multiplier(self):
        result = srs.next_interval(state(interval=10.0, review_count=5), srs.HARD)
        self.assertAlmostEqual(result, 12.0)

    def test_easy_adds_bonus(self):
        result = srs.next_interval(state(interval=10.0, review_count=5, ease_factor=2.5), srs.EASY)
        self.assertAlmostEqual(result, 32.5)

    def test_again_resets_to_one_day(self):
        result = srs.next_interval(state(interval=90.0, review_count=9), srs.AGAIN)
        self.assertEqual(result, 1.0)

    def test_invalid_rating_raises(self):
        with self.assertRaises(ValueError):
            srs.next_interval(state(), 9)


class TestSchedule(unittest.TestCase):
    def test_due_date_moves_forward(self):
        result = srs.schedule(state(), srs.GOOD, today=TODAY, rng=NO_JITTER)
        self.assertEqual(result.due_date, (TODAY + timedelta(days=1)).isoformat())
        self.assertEqual(result.review_count, 1)
        self.assertEqual(result.lapse_count, 0)

    def test_again_counts_a_lapse_and_returns_tomorrow(self):
        result = srs.schedule(
            state(interval=30.0, review_count=6), srs.AGAIN, today=TODAY, rng=NO_JITTER
        )
        self.assertEqual(result.lapse_count, 1)
        self.assertEqual(result.due_date, (TODAY + timedelta(days=1)).isoformat())

    def test_ease_moves_with_rating(self):
        harder = srs.schedule(state(review_count=3, interval=10), srs.HARD, today=TODAY, rng=NO_JITTER)
        easier = srs.schedule(state(review_count=3, interval=10), srs.EASY, today=TODAY, rng=NO_JITTER)
        self.assertAlmostEqual(harder.ease_factor, 2.35)
        self.assertAlmostEqual(easier.ease_factor, 2.65)

    def test_ease_never_drops_below_floor(self):
        current = state(review_count=5, interval=5, ease_factor=1.35)
        for _ in range(5):
            current = srs.schedule(current, srs.AGAIN, today=TODAY, rng=NO_JITTER)
        self.assertGreaterEqual(current.ease_factor, srs.MIN_EASE)

    def test_interval_is_capped(self):
        current = state(review_count=20, interval=400.0, ease_factor=3.0)
        result = srs.schedule(current, srs.EASY, today=TODAY, rng=NO_JITTER)
        self.assertLessEqual(result.interval, srs.MAX_INTERVAL_DAYS)

    def test_schedule_does_not_mutate_input(self):
        original = state(interval=5.0, review_count=2)
        srs.schedule(original, srs.GOOD, today=TODAY, rng=NO_JITTER)
        self.assertEqual(original.interval, 5.0)
        self.assertEqual(original.review_count, 2)

    def test_jitter_stays_within_five_percent(self):
        rng = random.Random(1234)
        for _ in range(50):
            result = srs.apply_jitter(100.0, rng)
            self.assertGreaterEqual(result, 95.0)
            self.assertLessEqual(result, 105.0)

    def test_short_intervals_are_not_jittered(self):
        self.assertEqual(srs.apply_jitter(1.0, random.Random(7)), 1.0)


class TestHelpers(unittest.TestCase):
    def test_describe_next_is_human_readable(self):
        tomorrow = state(due_date=(TODAY + timedelta(days=1)).isoformat())
        self.assertIn("明天", srs.describe_next(tomorrow, TODAY))

    def test_maturity_levels(self):
        self.assertEqual(srs.maturity(state()), "new")
        self.assertEqual(srs.maturity(state(review_count=2, interval=5)), "learning")
        self.assertEqual(srs.maturity(state(review_count=9, interval=40)), "mature")


if __name__ == "__main__":
    unittest.main()
