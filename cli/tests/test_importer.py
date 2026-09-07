"""CSV 匯入與種子資料測試。"""

import tempfile
import unittest
from pathlib import Path

from ielts import db as dbmod
from ielts import importer, repository as repo, seed
from ielts.models import CORE_FIELDS

HEADER = "word,pos,example_sentence,collocations,root_analysis,synonyms,category,topic,card_type,zh_hint\n"
ROW = (
    "mitigate,v.,We must mitigate the effects.,mitigate risk,mit-(緩和),"
    "alleviate; reduce,AWL,環境,passive,減輕\n"
)


class ImporterTestCase(unittest.TestCase):
    def setUp(self):
        self.conn = dbmod.connect(":memory:")
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.conn.close()
        self.tmp.cleanup()

    def write(self, name: str, content: str, encoding: str = "utf-8") -> Path:
        path = self.dir / name
        path.write_text(content, encoding=encoding)
        return path


class TestHeaderNormalisation(unittest.TestCase):
    def test_aliases_and_casing(self):
        cases = {
            "Word": "word",
            "PART OF SPEECH": "pos",
            "Example Sentence": "example_sentence",
            "example": "example_sentence",
            "Collocation": "collocations",
            "root": "root_analysis",
            "Synonym": "synonyms",
            "中文": "zh_hint",
            "主題": "topic",
            "type": "card_type",
        }
        for raw, expected in cases.items():
            self.assertEqual(importer.normalise_header(raw), expected, raw)

    def test_unknown_headers_pass_through(self):
        self.assertEqual(importer.normalise_header("frequency"), "frequency")


class TestImport(ImporterTestCase):
    def test_basic_import(self):
        path = self.write("cards.csv", HEADER + ROW)
        result = importer.import_csv(self.conn, path)
        self.assertEqual(result.added, 1)
        self.assertEqual(result.incomplete, 0)
        card = repo.find_card(self.conn, "mitigate", "v.")
        self.assertIsNotNone(card)
        self.assertEqual(card.synonym_list, ["alleviate", "reduce"])

    def test_missing_fields_are_marked_incomplete(self):
        path = self.write("partial.csv", "word,pos\nnegligible,adj.\n")
        result = importer.import_csv(self.conn, path)
        self.assertEqual(result.added, 1)
        self.assertEqual(result.incomplete, 1)
        card = repo.find_card(self.conn, "negligible", "adj.")
        self.assertEqual(card.is_incomplete, 1)
        self.assertEqual(sorted(card.missing_core_fields()), sorted(CORE_FIELDS))

    def test_rows_without_a_word_are_reported_not_crashed(self):
        path = self.write("bad.csv", "word,pos\n,adj.\ngood,adj.\n")
        result = importer.import_csv(self.conn, path)
        self.assertEqual(result.added, 1)
        self.assertEqual(result.skipped, 1)
        self.assertEqual(len(result.errors), 1)

    def test_duplicates_are_skipped_by_default(self):
        path = self.write("cards.csv", HEADER + ROW)
        importer.import_csv(self.conn, path)
        result = importer.import_csv(self.conn, path)
        self.assertEqual(result.added, 0)
        self.assertEqual(result.skipped, 1)

    def test_update_flag_overwrites(self):
        path = self.write("cards.csv", HEADER + ROW)
        importer.import_csv(self.conn, path)
        updated = self.write(
            "cards2.csv", HEADER + ROW.replace("減輕", "減輕、緩和")
        )
        result = importer.import_csv(self.conn, updated, update=True)
        self.assertEqual(result.updated, 1)
        self.assertEqual(repo.find_card(self.conn, "mitigate", "v.").zh_hint, "減輕、緩和")

    def test_same_word_different_pos_are_separate_cards(self):
        path = self.write(
            "cards.csv",
            "word,pos\nconduct,v.\nconduct,n.\n",
        )
        result = importer.import_csv(self.conn, path)
        self.assertEqual(result.added, 2)

    def test_big5_encoded_file(self):
        path = self.dir / "big5.csv"
        path.write_bytes(("word,zh_hint\nmitigate,減輕\n").encode("cp950"))
        result = importer.import_csv(self.conn, path)
        self.assertEqual(result.added, 1)
        self.assertEqual(repo.find_card(self.conn, "mitigate").zh_hint, "減輕")

    def test_utf8_bom_is_stripped(self):
        path = self.write("bom.csv", HEADER + ROW, encoding="utf-8-sig")
        result = importer.import_csv(self.conn, path)
        self.assertEqual(result.added, 1)
        self.assertIsNotNone(repo.find_card(self.conn, "mitigate", "v."))

    def test_tab_separated_file(self):
        path = self.write("tabs.csv", "word\tpos\nmitigate\tv.\n")
        result = importer.import_csv(self.conn, path)
        self.assertEqual(result.added, 1)

    def test_missing_file_raises_a_clear_error(self):
        with self.assertRaises(FileNotFoundError):
            importer.import_csv(self.conn, self.dir / "nope.csv")

    def test_template_round_trips(self):
        path = importer.write_template(self.dir / "tpl.csv")
        result = importer.import_csv(self.conn, path)
        self.assertEqual(result.added, 1)
        self.assertEqual(result.incomplete, 0)

    def test_export_round_trips(self):
        importer.import_csv(self.conn, self.write("cards.csv", HEADER + ROW))
        out = importer.export_csv(self.conn, self.dir / "out.csv")
        other = dbmod.connect(":memory:")
        try:
            result = importer.import_csv(other, out)
            self.assertEqual(result.added, 1)
        finally:
            other.close()


class TestSeed(ImporterTestCase):
    def test_seed_file_exists_and_loads(self):
        self.assertTrue(seed.seed_path().exists())
        result = seed.load_seed(self.conn)
        # AWL 570 字頭 + 話題字 + Task 1 用語 + 口說表達
        self.assertGreater(result.added, 700)
        self.assertEqual(result.skipped, 0)

    def test_seed_contains_the_whole_awl(self):
        """AWL 570 個字頭一個都不能少（有些歸在功能分類，靠備註標記）。"""
        seed.load_seed(self.conn)
        words = {c.word.lower() for c in repo.list_cards(self.conn)}
        for headword in ("abandon", "analyse", "constrain", "sustain", "widespread"):
            self.assertIn(headword, words, headword)
        awl = repo.list_cards(self.conn, category="AWL")
        self.assertGreater(len(awl), 550)

    def test_fully_written_cards_have_all_four_dimensions(self):
        seed.load_seed(self.conn)
        complete = [c for c in repo.list_cards(self.conn) if not c.missing_core_fields()]
        self.assertGreater(len(complete), 200)
        for card in complete:
            self.assertTrue(card.example_sentence, card.word)
            self.assertTrue(card.collocation_list, card.word)
            self.assertTrue(card.root_analysis, card.word)
            self.assertGreaterEqual(len(card.synonym_list), 2, card.word)

    def test_every_written_example_contains_its_word(self):
        """例句裡沒有目標字的話，拼字模式就出不了題。"""
        from ielts import textutil

        seed.load_seed(self.conn)
        for card in repo.list_cards(self.conn):
            if not card.example_sentence:
                continue
            hits = textutil.mask_sentence(card.example_sentence, card.word)[1]
            self.assertGreater(hits, 0, f"{card.word}: {card.example_sentence}")

    def test_seed_covers_every_category(self):
        seed.load_seed(self.conn)
        categories = {row["name"] for row in repo.counts_by(self.conn, "category")}
        self.assertEqual(
            categories, {"AWL", "高頻話題字", "Task1圖表用語", "口說表達"}
        )

    def test_seed_has_active_cards_ready_for_production(self):
        seed.load_seed(self.conn)
        self.assertGreaterEqual(len(repo.production_candidates(self.conn, limit=100)), 50)

    def test_topic_words_are_evenly_spread(self):
        seed.load_seed(self.conn)
        rows = {r["name"]: r["total"] for r in repo.counts_by(self.conn, "topic")}
        for topic in ("環境", "教育", "科技", "健康", "都市化", "犯罪", "媒體"):
            self.assertEqual(rows.get(topic), 20, topic)

    def test_awl_cards_are_grouped_by_sublist(self):
        seed.load_seed(self.conn)
        rows = {r["name"]: r["total"] for r in repo.counts_by(self.conn, "topic")}
        for n in range(1, 11):
            self.assertIn(f"Sublist {n}", rows)

    def test_seed_is_idempotent(self):
        first = seed.load_seed(self.conn)
        again = seed.load_seed(self.conn)
        self.assertEqual(again.added, 0)
        self.assertEqual(dbmod.card_count(self.conn), first.added)


if __name__ == "__main__":
    unittest.main()
