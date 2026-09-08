"""模式的端到端測試：用假的 UI 餵入按鍵與文字輸入。"""

import unittest
from datetime import date

from ielts import db as dbmod
from ielts import repository as repo, settings
from ielts.context import AppContext
from ielts.db import TRACK_RECALL, TRACK_SPELLING
from ielts.errors import QuitSession
from ielts.models import Card
from ielts.modes import commute, complete, production, spelling, synonym
from ielts.ui import UI

TODAY = date.today()


class FakeUI(UI):
    """把 key()/ask() 換成預先排好的腳本，其餘排版邏輯照跑。"""

    def __init__(self, keys=None, answers=None):
        super().__init__(plain=True, color=False)
        self.keys = list(keys or [])
        self.answers = list(answers or [])
        self.lines: list[str] = []

    def print(self, text: str = "", style: str | None = None) -> None:  # noqa: A003
        self.lines.append(text)

    def key(self, prompt: str, allowed=None) -> str:
        if not self.keys:
            raise QuitSession()
        return self.keys.pop(0)

    def ask(self, prompt: str, *, default: str = "", allow_empty: bool = True) -> str:
        if not self.answers:
            raise QuitSession()
        return self.answers.pop(0)

    def confirm(self, prompt: str, default: bool = True) -> bool:
        answer = self.ask(prompt)
        return answer.lower().startswith("y") if answer else default

    @property
    def output(self) -> str:
        return "\n".join(self.lines)


def make_card(word: str, **kwargs) -> Card:
    data = dict(
        word=word,
        pos="v.",
        example_sentence=f"Governments should {word} the problem right now.",
        collocations=f"{word} the problem; {word} risk",
        root_analysis=f"{word} 的字根拆解",
        synonyms="alleviate; reduce; ease",
        category="AWL",
        topic="環境",
        card_type="passive",
        zh_hint="測試用中文",
    )
    data.update(kwargs)
    return Card(**data)


class ModeTestCase(unittest.TestCase):
    def setUp(self):
        self.conn = dbmod.connect(":memory:")

    def tearDown(self):
        self.conn.close()

    def context(self, ui: FakeUI) -> AppContext:
        return AppContext(conn=self.conn, ui=ui, today=TODAY)


class TestCommuteMode(ModeTestCase):
    def test_reveal_then_rate_two_cards(self):
        repo.add_card(self.conn, make_card("mitigate"))
        repo.add_card(self.conn, make_card("allocate"))
        ui = FakeUI(keys=[" ", "3", " ", "1"])
        summary = commute.run(self.context(ui), limit=10)
        self.assertEqual(summary.done, 2)
        self.assertEqual(summary.ratings, {3: 1, 1: 1})
        self.assertEqual(repo.due_count(self.conn, TRACK_RECALL, today=TODAY), 0)

    def test_skip_leaves_the_card_due(self):
        repo.add_card(self.conn, make_card("mitigate"))
        ui = FakeUI(keys=["s"])
        summary = commute.run(self.context(ui), limit=10)
        self.assertEqual(summary.done, 0)
        self.assertEqual(summary.skipped, 1)
        self.assertEqual(repo.due_count(self.conn, TRACK_RECALL, today=TODAY), 1)

    def test_quitting_midway_keeps_earlier_answers(self):
        repo.add_card(self.conn, make_card("mitigate"))
        repo.add_card(self.conn, make_card("allocate"))
        ui = FakeUI(keys=[" ", "3"])  # 第二張沒有按鍵 → QuitSession
        summary = commute.run(self.context(ui), limit=10)
        self.assertEqual(summary.done, 1)
        self.assertEqual(repo.due_count(self.conn, TRACK_RECALL, today=TODAY), 1)

    def test_back_side_shows_chinese_last_by_default(self):
        """中文是校對用的，所以要在四個維度之後才出現。"""
        repo.add_card(self.conn, make_card("mitigate"))
        ui = FakeUI(keys=[" ", "3"])
        commute.run(self.context(ui), limit=1)
        out = ui.output
        self.assertIn("測試用中文", out)
        for dimension in ("例句", "搭配", "字根", "同義"):
            self.assertLess(out.index(dimension), out.index("測試用中文"), dimension)

    def test_hiding_chinese_is_a_setting(self):
        repo.add_card(self.conn, make_card("mitigate"))
        settings.set_show_zh(self.conn, False)
        ui = FakeUI(keys=[" ", "3"])
        commute.run(self.context(ui), limit=1)
        self.assertNotIn("測試用中文", ui.output)
        self.assertIn("例句", ui.output)   # 其餘四個維度照常

    def test_zh_flag_overrides_the_setting_for_one_session(self):
        repo.add_card(self.conn, make_card("mitigate"))
        settings.set_show_zh(self.conn, False)
        ui = FakeUI(keys=[" ", "3"])
        commute.run(self.context(ui), limit=1, show_zh=True)
        self.assertIn("測試用中文", ui.output)
        # 單次覆寫不該改到設定本身
        self.assertFalse(settings.show_zh(self.conn))

    def test_cards_without_an_example_are_still_reviewable(self):
        """例句留白的卡片，背面還有搭配詞／字根／同義詞，照樣要能複習。"""
        repo.add_card(
            self.conn,
            make_card("mitigate", example_sentence="",
                      example_ref="Planting trees can mitigate urban heat."),
        )
        ui = FakeUI(keys=[" ", "3"])
        summary = commute.run(self.context(ui), limit=10)
        self.assertEqual(summary.done, 1, "這張卡不該被擋在複習外面")
        self.assertIn("搭配", ui.output)
        self.assertNotIn("Planting trees", ui.output, "複習模式不該顯示參考例句")

    def test_cards_with_nothing_on_the_back_are_skipped(self):
        repo.add_card(self.conn, Card(word="zzempty", card_type="passive"))
        ui = FakeUI(keys=[])
        summary = commute.run(self.context(ui), limit=10)
        self.assertEqual(summary.total, 0, "空白卡翻面也沒東西可看")

    def test_active_cards_are_excluded_by_default(self):
        repo.add_card(self.conn, make_card("pose", card_type="active"))
        ui = FakeUI(keys=[])
        summary = commute.run(self.context(ui), limit=10)
        self.assertEqual(summary.total, 0)


class TestSpellingMode(ModeTestCase):
    def test_correct_answer_advances_the_schedule(self):
        repo.add_card(self.conn, make_card("mitigate"))
        ui = FakeUI(answers=["mitigate"])
        summary = spelling.run(self.context(ui), limit=1)
        self.assertEqual(summary.correct, 1)
        self.assertEqual(repo.spelling_accuracy(self.conn)["correct"], 1)
        self.assertGreater(repo.get_srs(self.conn, 1, TRACK_SPELLING).interval, 0)

    def test_wrong_answer_lands_on_the_error_list(self):
        repo.add_card(self.conn, make_card("mitigate"))
        ui = FakeUI(answers=["mitigat", ""])  # 打錯 + 跳過重打
        summary = spelling.run(self.context(ui), limit=1)
        self.assertEqual(summary.wrong, 1)
        errors = repo.spelling_error_list(self.conn)
        self.assertEqual(errors[0]["word"], "mitigate")
        queue = repo.spelling_queue(self.conn, today=TODAY, limit=5, only_wrong=True)
        self.assertEqual(len(queue), 1)

    def test_question_mark_reveals_a_hint_without_the_answer(self):
        repo.add_card(self.conn, make_card("mitigate"))
        ui = FakeUI(answers=["?", "mitigate"])
        spelling.run(self.context(ui), limit=1)
        self.assertIn("提示", ui.output)
        self.assertIn("8 個字母", ui.output)

    def test_prompt_does_not_leak_the_word(self):
        repo.add_card(self.conn, make_card("mitigate"))
        ui = FakeUI(answers=["mitigate"])
        spelling.run(self.context(ui), limit=1)
        prompt_part = ui.output.split("拼字")[0]
        self.assertNotIn("mitigate", prompt_part)

    def test_empty_answer_skips(self):
        repo.add_card(self.conn, make_card("mitigate"))
        ui = FakeUI(answers=[""])
        summary = spelling.run(self.context(ui), limit=1)
        self.assertEqual(summary.skipped, 1)
        self.assertEqual(repo.spelling_accuracy(self.conn)["total"], 0)


class TestSynonymMode(ModeTestCase):
    def test_full_answer_scores_good(self):
        repo.add_card(self.conn, make_card("mitigate"))
        ui = FakeUI(answers=["alleviate, reduce"])
        summary = synonym.run(self.context(ui), limit=1, target=2)
        self.assertEqual(summary.correct, 1)
        self.assertEqual(summary.ratings.get(3), 1)

    def test_partial_answer_scores_hard(self):
        repo.add_card(self.conn, make_card("mitigate"))
        ui = FakeUI(answers=["reduce"])
        summary = synonym.run(self.context(ui), limit=1, target=2)
        self.assertEqual(summary.ratings.get(2), 1)

    def test_wrong_answer_scores_again_and_shows_the_list(self):
        repo.add_card(self.conn, make_card("mitigate"))
        ui = FakeUI(answers=["banana"])
        summary = synonym.run(self.context(ui), limit=1, target=2)
        self.assertEqual(summary.ratings.get(1), 1)
        self.assertIn("alleviate", ui.output)


class TestProductionMode(ModeTestCase):
    def test_sentence_is_stored(self):
        repo.add_card(self.conn, make_card("mitigate", card_type="active"))
        ui = FakeUI(answers=["Taipei must mitigate the effects of flooding."])
        summary = production.run(self.context(ui), count=1)
        self.assertEqual(summary.done, 1)
        stored = repo.list_productions(self.conn)
        self.assertEqual(len(stored), 1)
        self.assertEqual(stored[0].word, "mitigate")

    def test_sentence_without_the_word_asks_for_a_rewrite(self):
        repo.add_card(self.conn, make_card("mitigate", card_type="active"))
        ui = FakeUI(
            answers=["I like cats.", "n", "We must mitigate the damage."]
        )
        summary = production.run(self.context(ui), count=1)
        self.assertEqual(summary.done, 1)
        self.assertIn("mitigate", repo.list_productions(self.conn)[0].sentence)

    def test_no_active_cards_gives_a_hint(self):
        repo.add_card(self.conn, make_card("mitigate"))
        ui = FakeUI()
        summary = production.run(self.context(ui), count=1)
        self.assertEqual(summary.total, 0)
        self.assertIn("promote", ui.output)

    def test_promote_requires_confirmation(self):
        repo.add_card(self.conn, make_card("mitigate"))
        ui = FakeUI(answers=["n"])
        moved = production.promote(self.context(ui), count=5, min_reviews=0)
        self.assertEqual(moved, 0)
        self.assertEqual(repo.card_type_counts(self.conn)["active"], 0)

    def test_promote_with_yes_flag(self):
        repo.add_card(self.conn, make_card("mitigate"))
        ui = FakeUI()
        moved = production.promote(self.context(ui), count=5, min_reviews=0, assume_yes=True)
        self.assertEqual(moved, 1)
        self.assertEqual(repo.card_type_counts(self.conn)["active"], 1)

    def test_export_writes_markdown(self):
        import tempfile
        from pathlib import Path

        repo.add_card(self.conn, make_card("mitigate", card_type="active"))
        repo.add_production(self.conn, 1, "環境", "prompt?", "We must mitigate it.")
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "productions.md"
            production.export(self.context(FakeUI()), str(out))
            text = out.read_text(encoding="utf-8")
        self.assertIn("mitigate", text)
        self.assertIn("We must mitigate it.", text)


class TestCompleteMode(ModeTestCase):
    def test_filling_the_gaps_clears_incomplete(self):
        repo.add_card(self.conn, Card(word="negligible", pos="adj.", zh_hint="微不足道的"))
        ui = FakeUI(
            answers=[
                "Even a negligible rise in sea level floods farmland.",
                "a negligible effect; negligible amounts",
                "neg-(不) + leg(挑選) → 不值得挑出來看",
                "insignificant; trivial",
            ]
        )
        fixed = complete.run(self.context(ui), limit=5)
        self.assertEqual(fixed, 1)
        self.assertEqual(repo.incomplete_count(self.conn), 0)

    def test_partial_fill_keeps_the_card_incomplete(self):
        repo.add_card(self.conn, Card(word="negligible"))
        ui = FakeUI(answers=["An example sentence with negligible in it.", "", "", ""])
        complete.run(self.context(ui), limit=5)
        card = repo.find_card(self.conn, "negligible")
        self.assertEqual(card.is_incomplete, 1)
        self.assertNotIn("example_sentence", card.missing_core_fields())

    def test_nothing_to_do_is_reported(self):
        repo.add_card(self.conn, make_card("mitigate"))
        ui = FakeUI()
        fixed = complete.run(self.context(ui), limit=5)
        self.assertEqual(fixed, 0)
        self.assertIn("寫過了", ui.output)

    def test_question_mark_reveals_the_reference_example(self):
        """例句想不出來時輸入 ? 才給參考句，不是預設就顯示。"""
        repo.add_card(
            self.conn,
            make_card("mitigate", example_sentence="",
                      example_ref="Planting trees can mitigate urban heat."),
        )
        ui = FakeUI(answers=["?", "We must mitigate the damage."])
        complete.run(self.context(ui), limit=1)
        self.assertIn("參考", ui.output)
        self.assertIn("Planting trees", ui.output)
        card = repo.find_card(self.conn, "mitigate", "v.")
        self.assertEqual(card.example_sentence, "We must mitigate the damage.")

    def test_reference_is_not_shown_unless_asked(self):
        repo.add_card(
            self.conn,
            make_card("mitigate", example_sentence="",
                      example_ref="Planting trees can mitigate urban heat."),
        )
        ui = FakeUI(answers=["We must mitigate the damage."])
        complete.run(self.context(ui), limit=1)
        self.assertNotIn("Planting trees", ui.output, "沒問就不該給參考句")


if __name__ == "__main__":
    unittest.main()
