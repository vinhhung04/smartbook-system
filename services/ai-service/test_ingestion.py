from __future__ import annotations

import unittest

import ingestion


class ChunkMarkdownTest(unittest.TestCase):
    def test_splits_on_headings(self):
        text = "# A\nnoi dung a\n\n# B\nnoi dung b"
        chunks = ingestion.chunk_markdown(text)
        self.assertEqual(len(chunks), 2)
        self.assertIn("noi dung a", chunks[0])
        self.assertIn("noi dung b", chunks[1])

    def test_keeps_heading_with_its_body(self):
        chunks = ingestion.chunk_markdown("## Phi phat\nTra tre bi phat 5000d/ngay")
        self.assertIn("Phi phat", chunks[0])
        self.assertIn("5000d", chunks[0])

    def test_splits_long_section_on_paragraphs(self):
        body = "\n\n".join(["doan van " + str(i) + " " + "x" * 200 for i in range(10)])
        chunks = ingestion.chunk_markdown("# Dai\n" + body, max_chars=500)
        self.assertGreater(len(chunks), 1)
        self.assertTrue(all(len(chunk) <= 700 for chunk in chunks))

    def test_no_heading_still_returns_content(self):
        chunks = ingestion.chunk_markdown("chi la mot doan van thuong")
        self.assertEqual(len(chunks), 1)

    def test_empty_returns_empty(self):
        self.assertEqual(ingestion.chunk_markdown(""), [])
        self.assertEqual(ingestion.chunk_markdown("   \n  "), [])


class PlanChunksTest(unittest.TestCase):
    def test_all_new_when_nothing_exists(self):
        texts = ["a", "b"]
        self.assertEqual(ingestion.plan_chunks({}, texts), [0, 1])

    def test_skips_unchanged(self):
        texts = ["a", "b"]
        existing = {0: ingestion.chunk_hash("a"), 1: ingestion.chunk_hash("b")}
        self.assertEqual(ingestion.plan_chunks(existing, texts), [])

    def test_only_changed_index_is_replanned(self):
        texts = ["a", "b-moi"]
        existing = {0: ingestion.chunk_hash("a"), 1: ingestion.chunk_hash("b")}
        self.assertEqual(ingestion.plan_chunks(existing, texts), [1])

    def test_new_index_beyond_existing_is_planned(self):
        texts = ["a", "b"]
        existing = {0: ingestion.chunk_hash("a")}
        self.assertEqual(ingestion.plan_chunks(existing, texts), [1])


if __name__ == "__main__":
    unittest.main()
