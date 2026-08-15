"""
test_nlu.py - Unit tests for the hybrid NLU layer.
All LLM calls are mocked. Run: python -m pytest test_nlu.py -v
"""
import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from intent import (
    LOW_STOCK_QUERY,
    TOP_BORROWED_BOOKS_QUERY,
    OVERDUE_LOAN_QUERY,
    RESERVATION_QUERY,
    REORDER_SUGGESTION_QUERY,
    FINE_SUMMARY_QUERY,
    GENERAL_QUERY,
    BORROW_TREND_QUERY,
)
import nlu as nlu_module
from nlu import (
    classify_user_message,
    _is_complex_message,
    _rule_to_nlu_shape,
    _validate,
    _validate_time_range,
    _empty_entities,
    INTENT_ALLOWLIST,
)
from agent_actions import (
    CREATE_RESERVATION_DRAFT,
    CREATE_REORDER_DRAFT,
    CREATE_STOCK_ALERT,
    CREATE_STAFF_TASK_DRAFT,
    CREATE_REPORT_DRAFT,
)


def _run(coro):
    # Python 3.14 no longer creates an implicit event loop for the main thread.
    return asyncio.run(coro)


def _llm(
    intent,
    confidence=0.9,
    wants_action=False,
    action_type=None,
    entities=None,
    secondary=None,
    reason="test",
    time_range=None,
    granularity="day",
):
    return {
        "intent": intent,
        "confidence": confidence,
        "query": "test",
        "time_range": time_range,
        "granularity": granularity,
        "wants_action": wants_action,
        "action_type": action_type,
        "entities": entities or _empty_entities(),
        "secondary_intents": secondary or [],
        "reason": reason,
    }


class TestComplexityDetection(unittest.TestCase):
    def test_short_no_conjunction(self):
        self.assertFalse(_is_complex_message("Sach qua han hom nay"))

    def test_long_message(self):
        self.assertTrue(_is_complex_message(
            "Kho minh dang thieu dau sach nao ma lai hot va duoc muon nhieu nhat"
        ))

    def test_conjunction_giup_toi(self):
        self.assertTrue(_is_complex_message(
            "Con khong, giu giup toi mot ban"
        ))

    def test_conjunction_va(self):
        self.assertTrue(_is_complex_message("Sach nao hot va ton kho thap"))


class TestValidateTimeRange(unittest.TestCase):
    def test_valid(self):
        tr = {"from": "2025-01-01", "to": "2025-01-31"}
        self.assertEqual(_validate_time_range(tr), tr)

    def test_missing_to_key(self):
        self.assertIsNone(_validate_time_range({"from": "2025-01-01"}))

    def test_empty_from_string(self):
        self.assertIsNone(_validate_time_range({"from": "", "to": "2025-01-31"}))

    def test_non_dict(self):
        self.assertIsNone(_validate_time_range("2025-01-01"))

    def test_null_value(self):
        self.assertIsNone(_validate_time_range(None))


class TestValidate(unittest.TestCase):
    def _rule(self):
        from intent import detect_intent
        return detect_intent("test")

    def test_valid_output(self):
        result = _validate(_llm(LOW_STOCK_QUERY), self._rule(), "test")
        self.assertIsNotNone(result)
        self.assertEqual(result["intent"], LOW_STOCK_QUERY)
        self.assertEqual(result["source"], "llm")

    def test_unknown_intent_rejected(self):
        self.assertIsNone(_validate({"intent": "FAKE_INTENT"}, self._rule(), "test"))

    def test_unknown_action_type_nullified(self):
        raw = _llm(RESERVATION_QUERY, action_type="DELETE_ALL")
        result = _validate(raw, self._rule(), "test")
        self.assertIsNotNone(result)
        self.assertIsNone(result["action_type"])

    def test_valid_action_type_kept(self):
        raw = _llm(RESERVATION_QUERY, action_type=CREATE_RESERVATION_DRAFT, wants_action=True)
        result = _validate(raw, self._rule(), "test")
        self.assertEqual(result["action_type"], CREATE_RESERVATION_DRAFT)

    def test_llm_invalid_time_range_falls_back_to_rule(self):
        raw = _llm(LOW_STOCK_QUERY, time_range={"from": "", "to": ""})
        rule = {"time_range": {"from": "2025-01-01", "to": "2025-01-31"}}
        result = _validate(raw, rule, "test")
        self.assertEqual(result["time_range"]["from"], "2025-01-01")

    def test_llm_valid_time_range_used(self):
        tr = {"from": "2025-06-01", "to": "2025-06-30"}
        raw = _llm(BORROW_TREND_QUERY, time_range=tr)
        result = _validate(raw, self._rule(), "test")
        self.assertEqual(result["time_range"], tr)

    def test_secondary_intents_filtered(self):
        raw = _llm(TOP_BORROWED_BOOKS_QUERY, secondary=[LOW_STOCK_QUERY, "FAKE"])
        result = _validate(raw, self._rule(), "test")
        self.assertIn(LOW_STOCK_QUERY, result["secondary_intents"])
        self.assertNotIn("FAKE", result["secondary_intents"])

    def test_secondary_same_as_intent_removed(self):
        raw = _llm(LOW_STOCK_QUERY, secondary=[LOW_STOCK_QUERY, TOP_BORROWED_BOOKS_QUERY])
        result = _validate(raw, self._rule(), "test")
        self.assertNotIn(LOW_STOCK_QUERY, result["secondary_intents"])
        self.assertIn(TOP_BORROWED_BOOKS_QUERY, result["secondary_intents"])

    def test_entities_extracted(self):
        raw = _llm(
            RESERVATION_QUERY,
            action_type=CREATE_RESERVATION_DRAFT,
            wants_action=True,
            entities={**_empty_entities(), "book_title": "Clean Code"},
        )
        result = _validate(raw, self._rule(), "test")
        self.assertEqual(result["entities"]["book_title"], "Clean Code")

    def test_missing_intent_key_returns_none(self):
        self.assertIsNone(_validate({"confidence": 0.9}, self._rule(), "test"))


class TestFastPath(unittest.TestCase):
    """High-confidence short messages WITHOUT action signals -> rule_based."""

    def test_overdue_no_action_signal_uses_rule(self):
        # "sach qua han hom nay" -> OVERDUE_LOAN_QUERY confidence=0.92, 4 words, no action signal
        with patch.object(nlu_module, "_call_groq", new_callable=AsyncMock) as mock:
            mock.return_value = ({}, False)
            result = _run(classify_user_message("sach qua han hom nay"))
        self.assertEqual(result["source"], "rule_based")
        self.assertEqual(result["intent"], OVERDUE_LOAN_QUERY)
        mock.assert_not_called()

    def test_fine_query_fast_path(self):
        with patch.object(nlu_module, "_call_groq", new_callable=AsyncMock) as mock:
            mock.return_value = ({}, False)
            result = _run(classify_user_message("tien phat chua thu thang nay"))
        self.assertEqual(result["source"], "rule_based")
        mock.assert_not_called()

    def test_fast_path_wants_action_is_false(self):
        # Fast path never sets wants_action=True
        with patch.object(nlu_module, "_call_groq", new_callable=AsyncMock) as mock:
            mock.return_value = ({}, False)
            result = _run(classify_user_message("sach qua han hom nay"))
        self.assertFalse(result["wants_action"])
        self.assertIsNone(result["action_type"])


class TestLLMPath(unittest.TestCase):
    """Messages with action signal or low confidence -> LLM path."""

    def setUp(self):
        # _nlu_cache is a module-level cache keyed by message text; several
        # tests below reuse the same message, so a leftover cache entry from
        # an earlier test would short-circuit classify_user_message and hide
        # what this test is actually meant to exercise.
        nlu_module._nlu_cache.clear()

    def test_reservation_with_book_title(self):
        resp = _llm(
            RESERVATION_QUERY,
            wants_action=True,
            action_type=CREATE_RESERVATION_DRAFT,
            entities={**_empty_entities(), "book_title": "Clean Code"},
        )
        with patch.object(nlu_module, "_call_groq", new_callable=AsyncMock) as mock:
            mock.return_value = (resp, True)
            result = _run(classify_user_message("Giu giup toi cuon Clean Code"))
        self.assertEqual(result["intent"], RESERVATION_QUERY)
        self.assertEqual(result["action_type"], CREATE_RESERVATION_DRAFT)
        self.assertEqual(result["entities"]["book_title"], "Clean Code")
        self.assertTrue(result["wants_action"])
        self.assertEqual(result["source"], "llm")

    def test_low_stock_natural_vietnamese(self):
        resp = _llm(LOW_STOCK_QUERY, wants_action=False, action_type=None)
        with patch.object(nlu_module, "_call_groq", new_callable=AsyncMock) as mock:
            mock.return_value = (resp, True)
            result = _run(classify_user_message("Kho minh dang thieu dau sach nao vay"))
        self.assertEqual(result["intent"], LOW_STOCK_QUERY)
        self.assertFalse(result["wants_action"])
        self.assertIsNone(result["action_type"])

    def test_reorder_query_only_no_action(self):
        """'Nen nhap them sach nao?' - data query, not action creation."""
        resp = _llm(REORDER_SUGGESTION_QUERY, wants_action=False, action_type=None)
        with patch.object(nlu_module, "_call_groq", new_callable=AsyncMock) as mock:
            mock.return_value = (resp, True)
            result = _run(classify_user_message("Nen nhap them sach nao"))
        self.assertEqual(result["intent"], REORDER_SUGGESTION_QUERY)
        self.assertFalse(result["wants_action"])
        self.assertIsNone(result["action_type"])

    def test_reorder_explicit_create_action(self):
        """'Tao phieu nhap cho sach can bo sung' - explicit action."""
        resp = _llm(REORDER_SUGGESTION_QUERY, wants_action=True, action_type=CREATE_REORDER_DRAFT)
        with patch.object(nlu_module, "_call_groq", new_callable=AsyncMock) as mock:
            mock.return_value = (resp, True)
            result = _run(classify_user_message("Tao phieu nhap cho sach can bo sung"))
        self.assertEqual(result["action_type"], CREATE_REORDER_DRAFT)
        self.assertTrue(result["wants_action"])

    def test_reservation_query_only_no_action(self):
        """'Tinh trang dat sach cua toi?' - status query, not draft creation."""
        resp = _llm(RESERVATION_QUERY, wants_action=False, action_type=None)
        with patch.object(nlu_module, "_call_groq", new_callable=AsyncMock) as mock:
            mock.return_value = (resp, True)
            result = _run(classify_user_message("Tinh trang dat sach cua toi"))
        self.assertEqual(result["intent"], RESERVATION_QUERY)
        self.assertFalse(result["wants_action"])
        self.assertIsNone(result["action_type"])

    def test_dual_intent_secondary(self):
        resp = _llm(LOW_STOCK_QUERY, secondary=[TOP_BORROWED_BOOKS_QUERY])
        with patch.object(nlu_module, "_call_groq", new_callable=AsyncMock) as mock:
            mock.return_value = (resp, True)
            result = _run(classify_user_message("Nhung dau sach noi bat nhung co ve sap thieu"))
        mock.assert_awaited_once()
        self.assertIn(TOP_BORROWED_BOOKS_QUERY, result["secondary_intents"])

    def test_warehouse_entity_extracted(self):
        resp = _llm(
            REORDER_SUGGESTION_QUERY,
            wants_action=True,
            action_type=CREATE_REORDER_DRAFT,
            entities={**_empty_entities(), "warehouse_hint": "HCM"},
        )
        with patch.object(nlu_module, "_call_groq", new_callable=AsyncMock) as mock:
            mock.return_value = (resp, True)
            result = _run(classify_user_message("Nhap them sach o kho HCM giup toi"))
        self.assertEqual(result["entities"]["warehouse_hint"], "HCM")
        self.assertEqual(result["action_type"], CREATE_REORDER_DRAFT)

    def test_llm_fail_falls_back_to_rule(self):
        with patch.object(nlu_module, "_call_groq", new_callable=AsyncMock) as mg, \
             patch.object(nlu_module, "_call_ollama", new_callable=AsyncMock) as mo:
            mg.return_value = ({}, False)
            mo.return_value = ({}, False)
            result = _run(classify_user_message("Kho minh dang thieu dau sach nao vay"))
        self.assertEqual(result["source"], "fallback")
        self.assertFalse(result["wants_action"])

    def test_cache_hit_no_second_llm_call(self):
        nlu_module._nlu_cache.clear()
        msg = "sach qua han thang nay nen lam gi vay"
        resp = _llm(OVERDUE_LOAN_QUERY)
        with patch.object(nlu_module, "_call_groq", new_callable=AsyncMock) as mock:
            mock.return_value = (resp, True)
            _run(classify_user_message(msg))
            _run(classify_user_message(msg))
        self.assertLessEqual(mock.call_count, 1)

    def test_no_sensitive_keys_in_result(self):
        result = _run(classify_user_message("test message"))
        sensitive = ("authorization", "token", "password", "auth_header", "secret")
        for key in sensitive:
            self.assertNotIn(key, result)
            self.assertNotIn(key, result.get("entities", {}))

    def test_groq_fails_ollama_called(self):
        resp = _llm(LOW_STOCK_QUERY)
        with patch.object(nlu_module, "_call_groq", new_callable=AsyncMock) as mg, \
             patch.object(nlu_module, "_call_ollama", new_callable=AsyncMock) as mo:
            mg.return_value = ({}, False)
            mo.return_value = (resp, True)
            result = _run(classify_user_message("Kho minh dang thieu dau sach nao vay"))
        self.assertEqual(result["source"], "llm")
        mo.assert_called_once()


if __name__ == "__main__":
    unittest.main()
