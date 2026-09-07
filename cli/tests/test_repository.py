"""資料層測試：卡片、排程、拼字紀錄、升級條件。"""

import unittest
from datetime import date, timedelta

from ielts import db as dbmod
from ielts import repository as repo
from ielts import srs
from ielts.db import TRACK_RECALL, TRACK_SPELLING, TRACK_SYNONYM
from ielts.models import Card, ReviewItem

TODAY = date(2026, 3, 1)


def full_card(word="mitigate", **kwargs) -> Card:
    data = dict(
        word=word,
        pos="v.",
        example_sentence="We must mitigate the effects of climate change.",
        collocations="mitigate the effects; mitigate risk",
        root_analysis="mit-(緩和) + -igate(使…)",
        synonyms="alleviate; reduce; ease",
        category="AWL",
        topic="環境",
        card_type="passive",
        zh_hint="減輕",
    )
    data.update(kwargs)
    return Card(**data)


class RepositoryTestCase(unittest.TestCase):
    def setUp(self):
        self.conn = dbmod.connect(":memory:")

    def tearDown(self):
        self.conn.close()


class TestCards(RepositoryTestCase):
    def test_add_card_creates_all_srs_tracks(self):
        card_id = repo.add_card(self.conn, full_card(), today=TODAY)
        for track in dbmod.TRACKS:
            state = repo.get_srs(self.conn, card_id, track)
            self.assertEqual(state.review_count, 0)
            self.assertEqual(state.ease_factor, srs.DEFAULT_EASE)

    def test_complete_card_is_not_incomplete(self):
        card_id = repo.add_card(self.conn, full_card(), today=TODAY)
        card = repo.get_card(self.conn, card_id)
        self.assertEqual(card.is_incomplete, 0)
        self.assertEqual(card.missing_core_fields(), [])

    def test_missing_core_fields_mark_incomplete(self):
        card_id = repo.add_card(self.conn, Card(word="negligible", pos="adj."), today=TODAY)
        card = repo.get_card(self.conn, card_id)
        self.assertEqual(card.is_incomplete, 1)
        self.assertEqual(
            sorted(card.missing_core_fields()),
            ["collocations", "example_sentence", "root_analysis", "synonyms"],
        )
        self.assertEqual(repo.incomplete_count(self.conn), 1)

    def test_filling_fields_clears_incomplete(self):
        card_id = repo.add_card(self.conn, Card(word="negligible"), today=TODAY)
        repo.update_card(
            self.conn,
            card_id,
            example_sentence="A negligible rise in sea level still floods farmland.",
            collocations="a negligible effect",
            root_analysis="neg-(不) + leg(挑選)",
            synonyms="insignificant; trivial",
        )
        self.assertEqual(repo.get_card(self.conn, card_id).is_incomplete, 0)
        self.assertEqual(repo.incomplete_count(self.conn), 0)

    def test_word_is_required(self):
        with self.assertRaises(ValueError):
            repo.add_card(self.conn, Card(word="   "), today=TODAY)

    def test_multi_value_fields_parse_into_lists(self):
        card_id = repo.add_card(self.conn, full_card(), today=TODAY)
        card = repo.get_card(self.conn, card_id)
        self.assertEqual(card.synonym_list, ["alleviate", "reduce", "ease"])
        self.assertEqual(len(card.collocation_list), 2)

    def test_filters(self):
        repo.add_card(self.conn, full_card("mitigate", topic="環境"), today=TODAY)
        repo.add_card(self.conn, full_card("curriculum", topic="教育", category="高頻話題字"), today=TODAY)
        self.assertEqual(len(repo.list_cards(self.conn, topic="環境")), 1)
        self.assertEqual(len(repo.list_cards(self.conn, category="高頻話題字")), 1)
        self.assertEqual(len(repo.list_cards(self.conn, search="curr")), 1)


class TestScheduling(RepositoryTestCase):
    def test_new_cards_are_due_today(self):
        repo.add_card(self.conn, full_card(), today=TODAY)
        items = repo.due_items(self.conn, TRACK_RECALL, today=TODAY, limit=10)
        self.assertEqual(len(items), 1)

    def test_grading_pushes_the_card_out_of_todays_queue(self):
        card_id = repo.add_card(self.conn, full_card(), today=TODAY)
        item = repo.due_items(self.conn, TRACK_RECALL, today=TODAY, limit=1)[0]
        repo.grade(self.conn, item, srs.GOOD, today=TODAY)
        self.assertEqual(repo.due_items(self.conn, TRACK_RECALL, today=TODAY, limit=10), [])
        later = repo.due_items(
            self.conn, TRACK_RECALL, today=TODAY + timedelta(days=2), limit=10
        )
        self.assertEqual(len(later), 1)
        self.assertEqual(later[0].card.id, card_id)

    def test_tracks_are_scheduled_independently(self):
        """拼字答錯不應該把認讀的進度一起打回原點。"""
        repo.add_card(self.conn, full_card(), today=TODAY)
        recall = repo.due_items(self.conn, TRACK_RECALL, today=TODAY, limit=1)[0]
        for _ in range(3):
            repo.grade(self.conn, recall, srs.EASY, today=TODAY)
        recall_interval = recall.state.interval

        spelling = repo.spelling_queue(self.conn, today=TODAY, limit=1)[0]
        repo.grade(self.conn, spelling, srs.AGAIN, today=TODAY)

        after = repo.get_srs(self.conn, recall.card.id, TRACK_RECALL)
        self.assertEqual(after.interval, recall_interval)
        self.assertEqual(
            repo.get_srs(self.conn, spelling.card.id, TRACK_SPELLING).interval, 1.0
        )

    def test_review_is_logged(self):
        repo.add_card(self.conn, full_card(), today=TODAY)
        item = repo.due_items(self.conn, TRACK_RECALL, today=TODAY, limit=1)[0]
        repo.grade(self.conn, item, srs.HARD, today=TODAY)
        breakdown = repo.rating_breakdown(self.conn)
        self.assertEqual(breakdown[srs.HARD], 1)

    def test_passive_filter_excludes_active_cards(self):
        repo.add_card(self.conn, full_card("mitigate", card_type="passive"), today=TODAY)
        repo.add_card(self.conn, full_card("pose", card_type="active"), today=TODAY)
        items = repo.due_items(
            self.conn, TRACK_RECALL, today=TODAY, limit=10, card_type="passive"
        )
        self.assertEqual([i.card.word for i in items], ["mitigate"])

    def test_cards_without_an_example_are_skipped_in_review(self):
        repo.add_card(self.conn, Card(word="negligible"), today=TODAY)
        items = repo.due_items(
            self.conn,
            TRACK_RECALL,
            today=TODAY,
            limit=10,
            require_fields=("example_sentence",),
        )
        self.assertEqual(items, [])


class TestDailyNewCardLimit(RepositoryTestCase):
    def test_new_cards_are_capped_per_day(self):
        for i in range(repo.NEW_PER_DAY + 15):
            repo.add_card(self.conn, full_card(f"word{i}"), today=TODAY)
        items = repo.due_items(self.conn, TRACK_RECALL, today=TODAY, limit=1000)
        self.assertEqual(len(items), repo.NEW_PER_DAY)

    def test_allowance_shrinks_as_new_cards_are_introduced(self):
        for i in range(repo.NEW_PER_DAY + 15):
            repo.add_card(self.conn, full_card(f"word{i}"), today=TODAY)
        for item in repo.due_items(self.conn, TRACK_RECALL, today=TODAY, limit=5):
            repo.grade(self.conn, item, srs.AGAIN, today=TODAY)
        self.assertEqual(repo.new_introduced_today(self.conn, TRACK_RECALL, TODAY), 5)
        remaining = repo.due_items(self.conn, TRACK_RECALL, today=TODAY, limit=1000)
        new_ones = [i for i in remaining if i.state.review_count == 0]
        self.assertEqual(len(new_ones), repo.NEW_PER_DAY - 5)

    def test_due_old_cards_are_never_held_back(self):
        """到期的舊卡不受新卡上限限制，否則複習會越積越多。"""
        ids = [repo.add_card(self.conn, full_card(f"word{i}"), today=TODAY) for i in range(30)]
        later = TODAY + timedelta(days=1)
        for card_id in ids:
            state = repo.get_srs(self.conn, card_id, TRACK_RECALL)
            state.review_count = 3
            state.interval = 1.0
            state.due_date = later.isoformat()
            repo.save_srs(self.conn, state)
        items = repo.due_items(self.conn, TRACK_RECALL, today=later, limit=1000)
        self.assertEqual(len(items), 30)


class TestSpellingQueue(RepositoryTestCase):
    def test_wrong_words_come_first(self):
        repo.add_card(self.conn, full_card("mitigate"), today=TODAY)
        wrong_id = repo.add_card(self.conn, full_card("congestion"), today=TODAY)
        repo.record_spelling(self.conn, wrong_id, "congession", False)
        queue = repo.spelling_queue(self.conn, today=TODAY, limit=5)
        self.assertEqual(queue[0].card.id, wrong_id)

    def test_only_wrong_filters_the_queue(self):
        repo.add_card(self.conn, full_card("mitigate"), today=TODAY)
        wrong_id = repo.add_card(self.conn, full_card("congestion"), today=TODAY)
        repo.record_spelling(self.conn, wrong_id, "congession", False)
        queue = repo.spelling_queue(self.conn, today=TODAY, limit=5, only_wrong=True)
        self.assertEqual([i.card.id for i in queue], [wrong_id])

    def test_a_later_correct_answer_clears_the_error_flag(self):
        card_id = repo.add_card(self.conn, full_card("congestion"), today=TODAY)
        repo.record_spelling(self.conn, card_id, "congession", False)
        repo.record_spelling(self.conn, card_id, "congestion", True)
        self.assertEqual(
            repo.spelling_queue(self.conn, today=TODAY, limit=5, only_wrong=True), []
        )

    def test_accuracy_and_error_list(self):
        card_id = repo.add_card(self.conn, full_card("congestion"), today=TODAY)
        repo.record_spelling(self.conn, card_id, "congession", False)
        repo.record_spelling(self.conn, card_id, "congestion", True)
        accuracy = repo.spelling_accuracy(self.conn)
        self.assertEqual(accuracy["total"], 2)
        self.assertEqual(accuracy["correct"], 1)
        self.assertAlmostEqual(accuracy["accuracy"], 0.5)
        errors = repo.spelling_error_list(self.conn)
        self.assertEqual(errors[0]["word"], "congestion")
        self.assertEqual(errors[0]["wrong"], 1)


class TestPromotion(RepositoryTestCase):
    def test_only_well_reviewed_cards_are_promoted(self):
        fresh = repo.add_card(self.conn, full_card("curriculum"), today=TODAY)
        ready = repo.add_card(self.conn, full_card("mitigate"), today=TODAY)
        item = ReviewItem(
            card=repo.get_card(self.conn, ready),
            state=repo.get_srs(self.conn, ready, TRACK_RECALL),
        )
        for _ in range(3):
            repo.grade(self.conn, item, srs.GOOD, today=TODAY)

        candidates = repo.promotion_candidates(self.conn, limit=5, min_reviews=3)
        self.assertEqual([c.id for c in candidates], [ready])
        self.assertNotIn(fresh, [c.id for c in candidates])

    def test_promoting_moves_the_card_into_production_pool(self):
        card_id = repo.add_card(self.conn, full_card("pose"), today=TODAY)
        self.assertEqual(repo.production_candidates(self.conn), [])
        repo.set_card_type(self.conn, card_id, "active")
        self.assertEqual([c.id for c in repo.production_candidates(self.conn)], [card_id])

    def test_invalid_card_type_is_rejected(self):
        card_id = repo.add_card(self.conn, full_card(), today=TODAY)
        with self.assertRaises(ValueError):
            repo.set_card_type(self.conn, card_id, "banana")

    def test_least_used_words_are_offered_first(self):
        a = repo.add_card(self.conn, full_card("pose", card_type="active"), today=TODAY)
        b = repo.add_card(self.conn, full_card("bias", card_type="active"), today=TODAY)
        repo.add_production(self.conn, a, "環境", "prompt", "Rising seas pose a threat.")
        self.assertEqual(repo.production_candidates(self.conn)[0].id, b)


class TestSynonymPool(RepositoryTestCase):
    def test_cards_with_fewer_than_two_synonyms_are_excluded(self):
        repo.add_card(self.conn, full_card("mitigate"), today=TODAY)
        repo.add_card(self.conn, full_card("curriculum", synonyms="syllabus"), today=TODAY)
        pool = repo.synonym_pool(self.conn, today=TODAY, limit=10)
        self.assertEqual([i.card.word for i in pool], ["mitigate"])

    def test_pool_uses_its_own_track(self):
        repo.add_card(self.conn, full_card(), today=TODAY)
        item = repo.synonym_pool(self.conn, today=TODAY, limit=1)[0]
        self.assertEqual(item.state.track, TRACK_SYNONYM)


if __name__ == "__main__":
    unittest.main()
