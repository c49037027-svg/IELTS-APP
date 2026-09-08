"""挖空、拼字比對、同義詞比對的測試。"""

import unittest

from ielts import textutil


class TestMasking(unittest.TestCase):
    def test_masks_the_exact_word(self):
        masked, hits = textutil.mask_sentence(
            "Governments must act now to mitigate the effects.", "mitigate"
        )
        self.assertEqual(hits, 1)
        self.assertNotIn("mitigate", masked)
        self.assertIn(textutil.MASK, masked)

    def test_masks_inflected_forms(self):
        masked, hits = textutil.mask_sentence(
            "Air quality has deteriorated sharply since 2010.", "deteriorate"
        )
        self.assertEqual(hits, 1)
        self.assertNotIn("deteriorated", masked)

    def test_masks_third_person_and_gerund(self):
        for sentence, word in [
            ("Researchers conducted a survey.", "conduct"),
            ("The council allocates a budget.", "allocate"),
            ("Toxins keep accumulating in the body.", "accumulate"),
        ]:
            masked, hits = textutil.mask_sentence(sentence, word)
            self.assertGreaterEqual(hits, 1, sentence)

    def test_masks_irregular_past_tenses(self):
        cases = [
            ("Online sales overtook high-street sales in 2019.", "overtake"),
            ("Prices rose sharply after the subsidy ended.", "rise"),
            ("The figure fell to just 20 per cent.", "fall"),
            ("Enrolment grew steadily throughout the decade.", "grow"),
            ("The council withdrew the proposal last month.", "withdraw"),
        ]
        for sentence, word in cases:
            masked, hits = textutil.mask_sentence(sentence, word)
            self.assertEqual(hits, 1, f"{word}: {sentence}")

    def test_masks_ui_words_whose_final_consonant_doubles(self):
        """字母規則會把 equip 的 ui 當成兩個母音，漏掉 equipped。"""
        for sentence, word in [
            ("Schools were equipped with laptops but no training.", "equip"),
            ("Equipping every classroom proved too expensive.", "equip"),
        ]:
            self.assertEqual(textutil.mask_sentence(sentence, word)[1], 1, sentence)

    def test_double_final_does_not_break_normal_words(self):
        """remain 不該變成 remainned。"""
        self.assertNotIn("remainned", textutil.inflections("remain"))
        self.assertIn("remained", textutil.inflections("remain"))

    def test_masks_doubled_endings_of_short_words(self):
        masked, hits = textutil.mask_sentence("Sales dipped briefly in 2012.", "dip")
        self.assertEqual(hits, 1)
        self.assertNotIn("dipped", masked)

    def test_does_not_mask_unrelated_lookalikes(self):
        masked, _ = textutil.mask_sentence(
            "That position is possible and posts are open.", "pose"
        )
        self.assertIn("position", masked)
        self.assertIn("possible", masked)

    def test_masks_content_words_of_a_phrase(self):
        masked, hits = textutil.mask_sentence(
            "Long working hours take a heavy toll on mental health.", "take its toll"
        )
        self.assertGreaterEqual(hits, 2)
        self.assertNotIn("toll", masked)
        self.assertIn("heavy", masked)

    def test_empty_input_is_safe(self):
        self.assertEqual(textutil.mask_sentence("", "word"), ("", 0))
        self.assertEqual(textutil.mask_sentence("A sentence.", ""), ("A sentence.", 0))
        self.assertEqual(textutil.mask_sentence("A sentence.", "中文")[1], 0)

    def test_highlight_wraps_the_target(self):
        result = textutil.highlight_target(
            "Rising sea levels pose a threat.", "pose"
        )
        self.assertIn("《pose》", result)


class TestSpellingComparison(unittest.TestCase):
    def test_case_and_space_insensitive(self):
        self.assertTrue(textutil.spelling_correct("mitigate", "  Mitigate "))
        self.assertTrue(textutil.spelling_correct("take its toll", "Take its toll."))

    def test_wrong_spelling_is_rejected(self):
        self.assertFalse(textutil.spelling_correct("mitigate", "mitigat"))
        self.assertFalse(textutil.spelling_correct("mitigate", "mitagate"))

    def test_edit_distance(self):
        self.assertEqual(textutil.edit_distance("mitigate", "mitigate"), 0)
        self.assertEqual(textutil.edit_distance("mitigate", "mitigat"), 1)
        self.assertEqual(textutil.edit_distance("mitigate", "mitagate"), 1)

    def test_diff_marks_the_difference(self):
        expected, actual = textutil.format_diff("mitigate", "mitagate")
        self.assertIn("【", expected)
        self.assertIn("【", actual)

    def test_letter_skeleton_shows_first_letter_and_length(self):
        skeleton = textutil.letter_skeleton("mitigate")
        self.assertTrue(skeleton.startswith("m"))
        self.assertIn("8", skeleton)
        self.assertNotIn("mitigate", skeleton)


class TestSynonymMatching(unittest.TestCase):
    def test_splits_on_common_separators(self):
        self.assertEqual(
            textutil.split_answers("alleviate, reduce; ease"),
            ["alleviate", "reduce", "ease"],
        )
        self.assertEqual(
            textutil.split_answers("alleviate、reduce"), ["alleviate", "reduce"]
        )
        self.assertEqual(textutil.split_answers("alleviate reduce"), ["alleviate", "reduce"])

    def test_exact_matches(self):
        matched, missed, extras = textutil.match_synonyms(
            ["reduce", "ease"], ["alleviate", "reduce", "ease", "lessen"]
        )
        self.assertEqual(len(matched), 2)
        self.assertEqual(sorted(missed), ["alleviate", "lessen"])
        self.assertEqual(extras, [])

    def test_tolerates_inflection_and_case(self):
        matched, _, extras = textutil.match_synonyms(
            ["Reducing", "EASE"], ["reduce", "ease"]
        )
        self.assertEqual(len(matched), 2)
        self.assertEqual(extras, [])

    def test_reports_answers_not_on_the_card(self):
        matched, missed, extras = textutil.match_synonyms(
            ["banana"], ["reduce", "ease"]
        )
        self.assertEqual(matched, [])
        self.assertEqual(extras, ["banana"])
        self.assertEqual(len(missed), 2)

    def test_duplicate_answers_only_count_once(self):
        matched, missed, extras = textutil.match_synonyms(
            ["reduce", "reduce"], ["reduce", "ease"]
        )
        self.assertEqual(len(matched), 1)
        self.assertEqual(extras, ["reduce"])

    def test_empty_answers_are_ignored(self):
        matched, _, extras = textutil.match_synonyms(["", "  "], ["reduce"])
        self.assertEqual(matched, [])
        self.assertEqual(extras, [])


if __name__ == "__main__":
    unittest.main()
