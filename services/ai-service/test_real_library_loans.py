import csv
import io
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "eval"))
import real_library_loans as rl  # noqa: E402

PUBLIC_CSV = (
    "Membership Number;Book ID Number;Book Title;Date of Birth;Gender;BIBID;DDC Number;Author;Borrow Date;Return Date\n"
    "8290;33031;Perubahan perilaku;25-09-1992;Laki-Laki;0010-1;614.42 [23];Priyoto (pengarang);24/08/24;05/09/24\n"
    "8290;33031;Perubahan perilaku;25-09-1992;Laki-Laki;0010-1;614.42 [23];Priyoto (pengarang);24/08/24;05/09/24\n"
    "8291;33032;Perubahan perilaku;01-01-1990;Perempuan;0010-1;614.42 [23];Priyoto (pengarang);01/09/24;\n"
    "8292;10794;Aku bisa;01-01-1990;Perempuan;0010-2;xx;Perla (penulis); Ana (editor);bad;30/06/24\n"
)


def convert(text, library="public"):
    return rl.convert(csv.DictReader(io.StringIO(text), delimiter=";"), library, {"file": "t.csv"})


class RealLibraryLoansTest(unittest.TestCase):
    def test_public_rows_become_title_level_loans_with_copies(self):
        data = convert(PUBLIC_CSV)
        self.assertFalse(data["synthetic"])
        self.assertEqual(len(data["events"]), 2)
        self.assertEqual(data["real_source"]["skipped_rows"], {"no_borrow_date": 1, "duplicate": 1, "no_member_or_copy": 0})
        (book,) = data["catalog"]
        self.assertEqual((book["id"], book["author"], book["category"]), ("b:0010-1", "Priyoto", "DDC 610"))
        self.assertEqual(book["variant_ids"], ["c:33031", "c:33032"])
        self.assertEqual(data["events"][0]["until"], "2024-09-05T00:00:00Z")
        self.assertIsNone(data["events"][1]["until"])

    def test_demographic_columns_never_reach_the_output(self):
        dumped = repr(convert(PUBLIC_CSV))
        for value in ("25-09-1992", "Laki-Laki", "Perempuan"):
            self.assertNotIn(value, dumped)

    def test_university_title_key_ignores_case_and_punctuation(self):
        row = {"Book Title": "Research methods : a skill   ", "Author": "Sekaran, Uma  "}
        self.assertEqual(rl.title_key(row, "univ"), rl.title_key({"Book Title": "RESEARCH METHODS a skill", "Author": "sekaran uma"}, "univ"))
        self.assertEqual(rl.parse_date("2018-01-02 11:58:15.643", rl.LIBRARIES["univ"]["formats"]).year, 2018)

    def test_reader_sample_keeps_whole_histories_and_is_stable(self):
        full = convert(PUBLIC_CSV)
        rows = list(csv.DictReader(io.StringIO(PUBLIC_CSV), delimiter=";"))
        sample = rl.convert(rows, "public", {"file": "t.csv"}, sample_readers=1)
        (reader,) = sample["customers"]
        self.assertEqual(sample["events"], [e for e in full["events"] if e["user"] == reader])
        self.assertEqual(rl.sampled_readers(rows, 1), rl.sampled_readers(list(reversed(rows)), 1))

    def test_ddc_division(self):
        self.assertEqual(rl.ddc_division("519.502 855 369"), "DDC 510")
        self.assertEqual(rl.ddc_division("  "), "DDC unknown")


class RealDataGuardTest(unittest.TestCase):
    """eval_recommendation_v2.py: real loans never tune production weights, and need the explicit flag."""

    def run_eval(self, payload, *flags):
        import json
        import tempfile
        import eval_recommendation_v2 as ev
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "events.json")
            with open(path, "w", encoding="utf-8") as handle:
                json.dump(payload, handle)
            return ev.main(["--events", path, "--out-dir", tmp, *flags])

    def test_real_file_is_refused_without_the_flag_and_with_write_weights(self):
        real = convert(PUBLIC_CSV)
        self.assertEqual(self.run_eval(real), 1)
        self.assertEqual(self.run_eval(real, "--real-data", "--write-weights"), 1)

    def test_flag_refuses_a_synthetic_file(self):
        self.assertEqual(self.run_eval({"synthetic": True, "catalog": [], "events": []}, "--real-data"), 1)


if __name__ == "__main__":
    unittest.main()
