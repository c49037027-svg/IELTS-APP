"""CLI 層測試：參數解析與錯誤處理不應該讓程式炸掉。"""

import contextlib
import io
import tempfile
import unittest
from pathlib import Path

from ielts import cli


def run(*argv: str) -> tuple[int, str]:
    buffer = io.StringIO()
    with contextlib.redirect_stdout(buffer):
        code = cli.main(list(argv))
    return code, buffer.getvalue()


class CliTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = str(Path(self.tmp.name) / "test.db")
        self.base = ["--db", self.db, "--plain", "--no-color"]

    def tearDown(self):
        self.tmp.cleanup()

    def run_cmd(self, *args: str) -> tuple[int, str]:
        return run(*self.base, *args)


class TestBasicCommands(CliTestCase):
    def test_no_arguments_shows_help(self):
        code, output = run()
        self.assertEqual(code, 0)
        self.assertIn("usage", output.lower())

    def test_init_seeds_the_library(self):
        code, output = self.run_cmd("init")
        self.assertEqual(code, 0)
        self.assertIn("種子資料完成", output)
        self.assertIn("AWL", output)

    def test_init_is_idempotent(self):
        self.run_cmd("init")
        code, output = self.run_cmd("init")
        self.assertEqual(code, 0)
        self.assertIn("沒有重複灌入", output)

    def test_commands_need_a_non_empty_library(self):
        code, output = self.run_cmd("review")
        self.assertEqual(code, 1)
        self.assertIn("ielts init", output)

    def test_stats_after_init(self):
        self.run_cmd("init")
        code, output = self.run_cmd("stats")
        self.assertEqual(code, 0)
        self.assertIn("總卡片", output)
        self.assertIn("Sublist 1", output)

    def test_list_and_show(self):
        self.run_cmd("init")
        code, output = self.run_cmd("list", "--topic", "環境")
        self.assertEqual(code, 0)
        self.assertIn("mitigate", output)

        code, output = self.run_cmd("show", "mitigate")
        self.assertEqual(code, 0)
        self.assertIn("認讀", output)

    def test_show_unknown_word(self):
        self.run_cmd("init")
        code, output = self.run_cmd("show", "zzzz")
        self.assertEqual(code, 1)
        self.assertIn("找不到", output)

    def test_spell_list(self):
        self.run_cmd("init")
        code, output = self.run_cmd("spell", "--list")
        self.assertEqual(code, 0)
        self.assertIn("沒有拼字錯誤紀錄", output)

    def test_promote_dry_run_changes_nothing(self):
        self.run_cmd("init")
        code, output = self.run_cmd("promote", "--min-reviews", "0", "--dry-run")
        self.assertEqual(code, 0)
        self.assertIn("dry-run", output)


class TestErrorHandling(CliTestCase):
    def test_invalid_date_is_reported(self):
        code, output = run("--db", self.db, "--plain", "--date", "not-a-date", "stats")
        self.assertEqual(code, 1)
        self.assertIn("YYYY-MM-DD", output)

    def test_import_missing_file(self):
        self.run_cmd("init")
        code, output = self.run_cmd("import", "/nonexistent/path.csv")
        self.assertEqual(code, 1)
        self.assertIn("找不到", output)

    def test_unknown_command_exits_with_usage_error(self):
        with self.assertRaises(SystemExit):
            run("banana")

    def test_negative_limit_does_not_crash(self):
        self.run_cmd("init")
        code, _ = self.run_cmd("list", "--limit", "-5")
        self.assertEqual(code, 0)


class TestImportExportRoundTrip(CliTestCase):
    def test_template_import_export(self):
        self.run_cmd("init")
        template = str(Path(self.tmp.name) / "tpl.csv")
        code, _ = self.run_cmd("template", template)
        self.assertEqual(code, 0)
        self.assertTrue(Path(template).exists())

        code, output = self.run_cmd("import", template)
        self.assertEqual(code, 0)
        self.assertIn("略過 1 張", output)  # mitigate 已經在種子裡

        out = str(Path(self.tmp.name) / "all.csv")
        code, _ = self.run_cmd("export", out)
        self.assertEqual(code, 0)
        self.assertIn("mitigate", Path(out).read_text(encoding="utf-8"))

    def test_import_marks_incomplete_rows(self):
        self.run_cmd("init")
        partial = Path(self.tmp.name) / "partial.csv"
        partial.write_text("word,pos\nnegligible,adj.\n", encoding="utf-8")
        code, output = self.run_cmd("import", str(partial))
        self.assertEqual(code, 0)
        self.assertIn("不完整 1 張", output)
        self.assertIn("ielts complete", output)


if __name__ == "__main__":
    unittest.main()
