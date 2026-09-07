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
        self.assertEqual(result.added, 30)
        self.assertEqual(result.incomplete, 0, "種子資料的四個維度都應該齊全")

    def test_seed_covers_every_category(self):
        seed.load_seed(self.conn)
        categories = {row["name"] for row in repo.counts_by(self.conn, "category")}
        self.assertEqual(
            categories, {"AWL", "高頻話題字", "Task1圖表用語", "口說表達"}
        )

    def test_seed_has_active_cards_ready_for_production(self):
        seed.load_seed(self.conn)
        self.assertGreaterEqual(len(repo.production_candidates(self.conn, limit=50)), 5)

    def test_seed_is_idempotent(self):
        seed.load_seed(self.conn)
        again = seed.load_seed(self.conn)
        self.assertEqual(again.added, 0)
        self.assertEqual(dbmod.card_count(self.conn), 30)


if __name__ == "__main__":
    unittest.main()
