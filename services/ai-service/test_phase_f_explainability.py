"""Phase F4: the unified evidence contract. A factual claim with no evidence
is never PASSED; a contradiction fails; document claims are checked against
the retrieved passage, not just the presence of a citation; the assistant's
own verification is re-shaped, not recomputed."""
import unittest

from ai_core import explainability as xai

FAQ = {
    "summary": "- Phí phạt: Trả sách trễ bị tính phí 5.000 đồng mỗi ngày cho mỗi cuốn.",
    "raw": {"faq_matches": [{"id": "fine-calculation", "question": "Phí phạt",
                             "answer": "Trả sách trễ hạn bị tính phí 5.000 đồng mỗi ngày cho mỗi cuốn sách.",
                             "score": 0.9}]},
    "sources": [{"name": "FAQ: Phí phạt", "endpoint": "faq://fine-calculation", "status": "ok"}],
    "retrieved_at": "2026-11-13T03:00:00+00:00",
}
KPI = {"summary": "Có 436 phiếu quá hạn.", "raw": {"overdue_loans": 436},
       "sources": [{"name": "Analytics KPI", "endpoint": "/analytics/dashboard/kpis", "status": "ok"},
                   {"name": "Analytics fines", "endpoint": "/analytics/fines", "status": "error"}],
       "retrieved_at": "2026-11-13T03:00:00+00:00"}
IMAGE = {"attachment_id": "img_x", "status": "IDENTIFIED", "used": True,
         "book": {"book_id": "b1", "title": "Nhà Giả Kim"},
         "availability": {"available_quantity": 3, "retrieved_at": "2026-11-13T10:00:00+0700"}}


def run(reply, retrieval, question="?", personal=None, image=None, abstained=False):
    return xai.for_chat(reply, question, retrieval, retrieval, personal, image, abstained=abstained)


class ChatContractTest(unittest.TestCase):
    def test_grounded_number_is_supported_and_passes(self):
        out = run("Hiện có 436 phiếu mượn đang quá hạn trong hệ thống.", KPI)
        self.assertEqual([c["verdict"] for c in out["claims"]], ["SUPPORTED"])
        self.assertEqual(out["verification"]["status"], "PASSED")
        self.assertTrue(out["claims"][0]["evidence_ids"])

    def test_ungrounded_number_is_never_passed(self):
        out = run("Hiện có 512 phiếu mượn đang quá hạn trong hệ thống.", KPI)
        self.assertEqual(out["claims"][0]["verdict"], "UNSUPPORTED")
        self.assertEqual(out["verification"]["status"], "WARNING")

    def test_failed_source_is_an_unknown_not_evidence(self):
        out = run("Hiện có 436 phiếu mượn đang quá hạn trong hệ thống.", KPI)
        self.assertNotIn("/analytics/fines", [e["source_ref"] for e in out["evidence"]])
        self.assertTrue(any("Analytics fines" in u for u in out["explanation"]["unknowns"]))

    def test_policy_claim_is_checked_against_the_passage(self):
        supported = run("Trả sách trễ hạn bị tính phí theo mỗi ngày cho mỗi cuốn sách.", FAQ)
        self.assertEqual(supported["claims"][0]["verdict"], "SUPPORTED")
        self.assertEqual(supported["evidence"][0]["source_type"], "DOCUMENT")
        self.assertIn("5.000", supported["evidence"][0]["snippet"])
        unrelated = run("Độc giả có thể gia hạn thẻ qua ứng dụng di động bất kỳ lúc nào.", FAQ)
        self.assertNotEqual(unrelated["claims"][0]["verdict"], "SUPPORTED")  # a citation alone proves nothing
        self.assertNotEqual(unrelated["verification"]["status"], "PASSED")

    def test_availability_contradiction_fails(self):
        out = run("Cuốn Nhà Giả Kim hiện còn 7 bản tại chi nhánh.", {"sources": [], "raw": {}}, image=IMAGE)
        self.assertEqual(out["claims"][0]["verdict"], "CONTRADICTED")
        self.assertEqual(out["verification"]["status"], "FAILED")

    def test_inference_and_unknown_are_separated_from_facts(self):
        out = run("Bạn có thể đặt trước cuốn này để giữ chỗ sớm. Hiện chưa có dữ liệu về lượt mượn của sách này.",
                  FAQ)
        kinds = {c["kind"] for c in out["claims"]}
        self.assertIn("INFERENCE", kinds)
        self.assertIn("UNKNOWN", kinds)
        self.assertEqual(out["explanation"]["facts"], [])

    def test_abstention(self):
        out = run("Hiện hệ thống chưa có đủ thông tin.", {"sources": []}, abstained=True)
        self.assertEqual(out["verification"]["status"], "NO_EVIDENCE")
        self.assertEqual(out["evidence"], [])

    def test_public_question_carries_no_personal_evidence(self):
        out = run("Trả sách trễ hạn bị tính phí theo mỗi ngày cho mỗi cuốn sách.", FAQ,
                  personal={"summary": "", "sources": []})
        self.assertFalse([e for e in out["evidence"] if e["kind"] == "personal_data"])

    def test_no_numeric_confidence_is_emitted(self):
        out = run("Hiện có 436 phiếu mượn đang quá hạn trong hệ thống.", KPI)
        self.assertNotIn("confidence", str(out["verification"]).lower())


class AssistantContractTest(unittest.TestCase):
    def test_reshapes_the_existing_verification(self):
        payload = {
            "evidence": [{"label": "Quá hạn", "tool_name": "get_overdue_summary", "metric": "overdue", "value": 436}],
            "data_as_of": "2026-11-13T10:00:00+07:00",
            "verification": {"status": "BLOCKED", "safe_to_act": False, "claims": [
                {"text": "Có 500 phiếu quá hạn", "verdict": "CONTRADICTED", "detail": "dữ liệu: 436",
                 "evidence": [{"source": "get_overdue_summary"}]}]},
            "explanation": {"claims": [{"kind": "ASSUMPTION", "statement": "Thời gian chờ hàng mặc định 14 ngày"}],
                            "limits": ["Không có dữ liệu theo chi nhánh"], "headline": "Quá hạn tăng"},
            "plan": {"assumptions": ["Không nêu kỳ: dùng 30 ngày qua"]}, "caveats": [],
        }
        out = xai.for_assistant(payload)
        self.assertEqual(out["verification"]["status"], "FAILED")
        self.assertEqual(out["verification"]["contradicted_claims"], 1)
        self.assertEqual(out["claims"][0]["evidence_ids"], ["ev-1"])
        self.assertIn("Thời gian chờ hàng mặc định 14 ngày", out["explanation"]["assumptions"])
        self.assertFalse(out["verification"]["safe_to_act"])

    def test_nothing_checked_is_never_passed(self):
        refused = xai.for_assistant({
            "evidence": [], "retrieval_warnings": ["get_overdue_summary: HTTP 403"],
            "verification": {"status": "PASSED", "claims": [], "safe_to_act": True},
            "explanation": {"claims": [{"kind": "UNKNOWN", "statement": "Không có quyền xem phiếu quá hạn."}],
                            "headline": "Không có quyền xem phiếu quá hạn."}})
        self.assertEqual(refused["verification"]["status"], "NO_EVIDENCE")
        self.assertNotIn("Không có quyền", refused["explanation"]["method"])  # not repeated as the method
        dup = xai.for_assistant({"verification": None, "explanation": {
            "claims": [{"kind": "UNKNOWN", "statement": "Chưa có nhu cầu theo kho."}],
            "limits": ["Chưa biết: Chưa có nhu cầu theo kho.", "Dữ liệu demo"]}})
        self.assertEqual(dup["explanation"]["limitations"], ["Dữ liệu demo"])
        plain = xai.for_assistant({"evidence": [], "verification": {"status": "PASSED", "claims": []}})
        self.assertEqual(plain["verification"]["status"], "NO_FACTUAL_CLAIMS")

    def test_same_top_level_shape_as_chat(self):
        chat = run("Hiện có 436 phiếu mượn đang quá hạn trong hệ thống.", KPI)
        assistant = xai.for_assistant({"evidence": [], "verification": None, "explanation": None})
        self.assertEqual(set(chat), set(assistant))
        self.assertEqual(set(chat["explanation"]), set(assistant["explanation"]))


if __name__ == "__main__":
    unittest.main()
