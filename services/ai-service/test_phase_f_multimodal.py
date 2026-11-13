"""Phase F3: safe image intake, the recognition decision, the owner-bound
photo context, /vision/identify, and the photo inside /chat and /assistant.
Every network collaborator (OCR provider, CLIP gallery, catalog, public
catalog, auth) is a stand-in."""
from __future__ import annotations

import io
import json
import time
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from PIL import Image
from starlette.datastructures import Headers, UploadFile

import image_input
import main
import routes_ai_experience as rae
import vision_context as vc
from agent_schemas import UserContext
from cache import RateLimiter, ResponseCache
from intent import GENERAL_QUERY
from main import AssistantRequest, ChatRequest

READER = UserContext(user_id="reader-1", roles=["CUSTOMER"], permissions=["customer.self.read", "inventory.catalog.read"])
OTHER = UserContext(user_id="reader-2", roles=["CUSTOMER"], permissions=["customer.self.read", "inventory.catalog.read"])
SUPPLIER = UserContext(user_id="sup-1", roles=["SUPPLIER"], permissions=["supplier.portal.read"])
USERS = {"Bearer r": READER, "Bearer o": OTHER, "Bearer s": SUPPLIER}
BOOKS = [{"id": "b1", "title": "Nhà Giả Kim", "author": "Paulo Coelho", "variant_id": "v1", "isbn13": "9786045"},
         {"id": "b2", "title": "Đắc Nhân Tâm", "author": "Dale Carnegie", "variant_id": "v2"}]
PUBLIC = {"b1": {"available_quantity": 3, "availability_status": "AVAILABLE",
                 "branches": [{"name": "Chi nhánh Đà Nẵng", "available_quantity": 3}], "borrow_count": 41,
                 "retrieved_at": "2026-11-13T10:00:00+0700"}}


def _png(w=200, h=300, fmt="PNG", exif=None) -> bytes:
    out = io.BytesIO()
    img = Image.new("RGB", (w, h), (120, 30, 30))
    kwargs = {"exif": exif} if exif is not None else {}
    img.save(out, format=fmt, **kwargs)
    return out.getvalue()


def _upload(data: bytes, ctype="image/png") -> UploadFile:
    return UploadFile(file=io.BytesIO(data), filename="cover", headers=Headers({"content-type": ctype}))


def _request(token=None):
    return SimpleNamespace(headers={"authorization": token} if token else {}, client=SimpleNamespace(host="gw"))


class ImageIntakeTest(unittest.IsolatedAsyncioTestCase):
    def test_real_formats_pass_and_the_declared_type_is_not_trusted(self):
        for fmt, mime in (("PNG", "image/png"), ("JPEG", "image/jpeg"), ("WEBP", "image/webp")):
            self.assertEqual(image_input.validate(_png(fmt=fmt))["mime"], mime)

    def test_svg_gif_and_text_are_refused(self):
        svg = b'<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>'
        gif = b"GIF89a" + b"\x00" * 64
        for data in (svg, gif, b"hello world" * 20):
            with self.assertRaises(HTTPException) as ctx:
                image_input.validate(data)
            self.assertEqual(ctx.exception.status_code, 415)

    def test_truncated_image_is_refused(self):
        with self.assertRaises(HTTPException) as ctx:
            image_input.validate(_png(fmt="JPEG")[:400])
        self.assertEqual(ctx.exception.status_code, 400)

    def test_pixel_budget_is_checked_before_decoding(self):
        with patch.object(image_input, "MAX_IMAGE_PIXELS", 1000):
            with self.assertRaises(HTTPException) as ctx:
                image_input.validate(_png())
        self.assertEqual(ctx.exception.status_code, 413)

    def test_tiny_image_is_refused(self):
        with self.assertRaises(HTTPException):
            image_input.validate(_png(20, 20))

    async def test_byte_budget_stops_the_read(self):
        with self.assertRaises(HTTPException) as ctx:
            await image_input.read_upload(_upload(b"\xff\xd8\xff" + b"0" * 5000), limit=1000)
        self.assertEqual(ctx.exception.status_code, 413)

    def test_normalize_drops_exif_and_bounds_size(self):
        exif = Image.Exif()
        exif[0x010F] = "PhoneMaker"  # device make
        exif[0x0112] = 6  # orientation: rotated - must be applied, then dropped
        out = image_input.normalize(_png(3000, 2000, fmt="JPEG", exif=exif.tobytes()))
        with Image.open(io.BytesIO(out)) as img:
            self.assertEqual(img.format, "JPEG")
            self.assertLessEqual(max(img.size), image_input.NORMALIZED_MAX_SIDE)
            self.assertGreater(img.size[1], img.size[0])  # 3000x2000 rotated upright
            self.assertEqual(dict(img.getexif()), {})


def _cand(book_id, visual=None, text=None, conf=None):
    ev = []
    if visual is not None:
        ev.append({"signal": "visual", "score": visual})
    if text is not None:
        ev.append({"signal": "ocr_text", "score": text})
    return {"id": book_id, "title": book_id, "evidence": ev, "confidence": conf or max(visual or 0, text or 0)}


class DecisionTest(unittest.TestCase):
    def test_rules(self):
        cases = [
            ([], "NO_MATCH"),
            ([_cand("a", text=1.0)], "IDENTIFIED"),
            ([_cand("a", visual=0.93, text=1.0)], "IDENTIFIED"),
            ([_cand("a", visual=0.92, text=0.5)], "IDENTIFIED"),           # two signals agree
            ([_cand("a", text=0.5)], "AMBIGUOUS"),                         # weak title match alone
            ([_cand("a", visual=0.93), _cand("b", visual=0.91)], "AMBIGUOUS"),
            ([_cand("a", visual=0.95), _cand("b", visual=0.82)], "IDENTIFIED"),
            ([_cand("a", text=1.0), _cand("b", text=1.0)], "AMBIGUOUS"),
        ]
        for candidates, expected in cases:
            with self.subTest(candidates=candidates):
                self.assertEqual(vc.decide(candidates)[0], expected)

    def test_scores_are_labelled_as_similarity_not_probability(self):
        view = vc.candidate_view({**BOOKS[0], "confidence": 0.82, "evidence": [{"signal": "visual", "score": 0.82}]},
                                 1, {"title": "Nha Gia Kim"})
        self.assertEqual(view["visual_similarity"], 0.82)
        self.assertNotIn("probability", json.dumps(view))
        expl = vc.explain("IDENTIFIED", ["visual_clear_margin"], [view], {"title": "Nha Gia Kim"},
                          {"visual_status": "ok", "gallery_size": 9})
        self.assertFalse(any("%" in f for f in expl["facts"]))
        self.assertTrue(any("không phải xác suất" in x for x in expl["limitations"]))


class PhotoContextTest(unittest.TestCase):
    def setUp(self):
        vc._STORE.clear()
        self.aid = vc.save(READER, "AMBIGUOUS", [{"book_id": "b1", "title": "A"}, {"book_id": "b2", "title": "B"}], {})

    def test_owner_bound(self):
        self.assertIsNotNone(vc.load(self.aid, READER))
        self.assertIsNone(vc.load(self.aid, OTHER))
        self.assertIsNone(vc.load(self.aid, None))

    def test_expired(self):
        vc._STORE[self.aid]["expires"] = time.time() - 1
        self.assertIsNone(vc.load(self.aid, READER))

    def test_only_a_verified_candidate_can_be_selected(self):
        entry = vc.load(self.aid, READER)
        self.assertEqual(vc.select(entry, "b2")["book_id"], "b2")
        self.assertIsNone(vc.select(entry, "b-not-in-photo"))
        self.assertIsNone(vc.select(entry, None))  # AMBIGUOUS: never a silent pick

    def test_no_image_bytes_are_stored(self):
        self.assertNotIn("image", json.dumps(vc._STORE[self.aid]).lower().replace("image_url", ""))


class IdentifyEndpointTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        vc._STORE.clear()
        self._p = [
            patch("ai_core.policy.get_user_context", new=AsyncMock(side_effect=lambda h: USERS[h])),
            patch.object(rae, "vision_rate_limiter", RateLimiter(100, 1000)),
            patch("routes_cover_search._run_cover_ocr",
                  new=AsyncMock(return_value={"title": "Nhà Giả Kim", "author": "Paulo Coelho"})),
            patch("routes_cover_search._match_visual",
                  new=AsyncMock(return_value=[{"book_id": "b1", "variant_id": "v1", "score": 0.91}])),
            patch("routes_cover_search._fetch_catalog", new=AsyncMock(return_value=BOOKS)),
            patch.object(rae, "_public_availability", new=AsyncMock(return_value=PUBLIC)),
        ]
        for p in self._p:
            p.start()

    def tearDown(self):
        for p in self._p:
            p.stop()

    async def test_identifies_with_evidence_and_public_availability(self):
        body = await rae.vision_identify(_request("Bearer r"), _upload(_png()), "true", False)
        self.assertEqual(body["status"], "IDENTIFIED")
        top = body["candidates"][0]
        self.assertEqual((top["book_id"], top["match_basis"]), ("b1", "BOTH_SIGNALS"))
        self.assertEqual(top["availability"]["available_quantity"], 3)
        self.assertEqual(body["ocr"], {"title": "Nhà Giả Kim", "author": "Paulo Coelho"})
        self.assertIsNotNone(vc.load(body["attachment_id"], READER))

    async def test_stream_reports_real_stages_then_the_recognition(self):
        response = await rae.vision_identify(_request("Bearer r"), _upload(_png()), "true", True)
        events = [chunk async for chunk in response.body_iterator]
        names = [e.split("\n", 1)[0].replace("event: ", "") for e in events]
        self.assertEqual(names[0], "status")
        self.assertIn("recognition", names)
        self.assertEqual(names[-1], "done")
        stages = [json.loads(e.split("data: ", 1)[1]).get("stage") for e in events if e.startswith("event: status")]
        self.assertEqual(stages[:2], ["received", "analyzing"])
        self.assertEqual(set(stages) >= {"text_read", "visual_done", "catalog_loaded", "matching_catalog"}, True)

    async def test_refusals(self):
        cases = [
            ("Bearer s", _upload(_png()), "true", 403),     # supplier: no catalog permission
            ("Bearer r", _upload(_png()), "false", 428),    # notice not acknowledged
            ("Bearer r", _upload(b"<svg></svg>" * 20, "image/svg+xml"), "true", 415),
        ]
        for token, upload, ack, status in cases:
            with self.subTest(status=status):
                with self.assertRaises(HTTPException) as ctx:
                    await rae.vision_identify(_request(token), upload, ack, False)
                self.assertEqual(ctx.exception.status_code, status)

    async def test_anonymous_is_refused_before_any_processing(self):
        ocr = AsyncMock()
        with patch("routes_cover_search._run_cover_ocr", new=ocr), \
             patch("ai_core.policy.get_user_context",
                   new=AsyncMock(side_effect=HTTPException(status_code=401, detail="x"))):
            with self.assertRaises(HTTPException) as ctx:
                await rae.vision_identify(_request(), _upload(_png()), "true", False)
        self.assertEqual(ctx.exception.status_code, 401)
        ocr.assert_not_awaited()

    async def test_ocr_down_still_answers_from_the_visual_signal(self):
        with patch("routes_cover_search._run_cover_ocr",
                   new=AsyncMock(return_value={"title": None, "author": None, "error": True})):
            body = await rae.vision_identify(_request("Bearer r"), _upload(_png()), "true", False)
        self.assertEqual(body["signals"]["ocr_status"], "error")
        self.assertEqual(body["candidates"][0]["match_basis"], "VISUAL_ONLY")

    async def test_clip_down_still_answers_from_the_text_signal(self):
        with patch("routes_cover_search._match_visual", new=AsyncMock(side_effect=RuntimeError("clip"))):
            body = await rae.vision_identify(_request("Bearer r"), _upload(_png()), "true", False)
        self.assertEqual(body["signals"]["visual_status"], "error")
        self.assertEqual(body["status"], "IDENTIFIED")  # full title match


class ChatWithPhotoTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        vc._STORE.clear()
        self.aid = vc.save(READER, "IDENTIFIED", [{"book_id": "b1", "title": "Nhà Giả Kim", "authors": ["Paulo Coelho"],
                                                   "match_basis": "BOTH_SIGNALS"}], {"title": "Nhà Giả Kim"})
        self.prompts = []

        async def llm(messages):
            self.prompts.append(messages[0]["content"])
            return "Cuốn Nhà Giả Kim hiện còn 3 bản tại Chi nhánh Đà Nẵng.", True

        empty = {"summary": "", "raw": {}, "sources": [], "warnings": [], "retrieval_status": "NO_EVIDENCE"}
        self._p = [
            patch("main.get_user_context", new=AsyncMock(side_effect=lambda h: USERS[h])),
            patch("main.classify_user_message", new=AsyncMock(return_value={"intent": GENERAL_QUERY, "query": "x"})),
            patch("main.build_user_personal_context",
                  new=AsyncMock(return_value={"role": "CUSTOMER", "persona": "Độc giả", "summary": ""})),
            patch("main.retrieve_context", new=AsyncMock(return_value=empty)),
            patch("main._get_text_llm_provider", return_value=SimpleNamespace(name="openrouter")),
            patch("main.plan_agent_action", new=AsyncMock(return_value=None)),
            patch("main.rate_limiter", RateLimiter(100, 1000)),
            patch("main.response_cache", ResponseCache()),
            patch("main._chat_with_text_llm", new=llm),
            patch.object(rae, "_public_availability", new=AsyncMock(return_value=PUBLIC)),
        ]
        for p in self._p:
            p.start()

    def tearDown(self):
        for p in self._p:
            p.stop()

    async def test_follow_up_about_the_photo_uses_the_verified_book(self):
        body = await main.chat(_request("Bearer r"), ChatRequest(message="Sách này thư viện còn không?",
                                                                attachment_id=self.aid))
        self.assertIn("Nhà Giả Kim", self.prompts[0])
        self.assertIn("3 bản sẵn sàng", self.prompts[0])
        self.assertTrue(body["image_context"]["used"])
        self.assertEqual(body["explainability"]["verification"]["status"], "PASSED")
        kinds = {e["source_type"] for e in body["explainability"]["evidence"]}
        self.assertIn("IMAGE_RECOGNITION", kinds)

    async def test_another_users_photo_is_gone(self):
        with self.assertRaises(HTTPException) as ctx:
            await main.chat(_request("Bearer o"), ChatRequest(message="Sách này là gì?", attachment_id=self.aid))
        self.assertEqual(ctx.exception.status_code, 410)

    async def test_a_book_the_photo_did_not_match_is_refused(self):
        with self.assertRaises(HTTPException) as ctx:
            await main.chat(_request("Bearer r"), ChatRequest(message="Sách này?", attachment_id=self.aid,
                                                             book_id="b-forged"))
        self.assertEqual(ctx.exception.status_code, 400)

    async def test_a_new_topic_does_not_reuse_the_old_book(self):
        body = await main.chat(_request("Bearer r"), ChatRequest(message="Thư viện mở cửa mấy giờ?",
                                                                attachment_id=self.aid))
        self.assertFalse(body.get("image_context", {}).get("used", False))
        self.assertTrue(all("Nhà Giả Kim" not in p for p in self.prompts))


class AssistantWithPhotoTest(unittest.IsolatedAsyncioTestCase):
    async def test_the_recognised_title_reaches_the_planner_and_skips_the_cache(self):
        vc._STORE.clear()
        manager = UserContext(user_id="m", roles=["WAREHOUSE_MANAGER"],
                              permissions=["analytics.reports.view", "inventory.catalog.read"])
        aid = vc.save(manager, "IDENTIFIED", [{"book_id": "b1", "title": "Nhà Giả Kim"}], {})
        planned = AsyncMock(side_effect=RuntimeError("stop after planning"))
        conversation = SimpleNamespace(conversation_id="c1", id=1)
        with patch("main.get_user_context", new=AsyncMock(return_value=manager)), \
             patch("main.rate_limiter", RateLimiter(100, 1000)), \
             patch("main._resolve_owned_conversation", new=AsyncMock(return_value=conversation)), \
             patch("main._access_fingerprint", new=AsyncMock(return_value="fp")), \
             patch("main._load_conversation_context", new=AsyncMock(return_value=([], None))), \
             patch("main._plan_assistant_turn", new=planned), \
             patch.object(rae, "_public_availability", new=AsyncMock(return_value={})):
            with self.assertRaises(RuntimeError):
                await main._start_assistant_turn(_request("Bearer m"), AssistantRequest(
                    message="Sách này có được mượn nhiều không?", attachment_id=aid))
        self.assertIn('(sách "Nhà Giả Kim")', planned.await_args.args[0])


if __name__ == "__main__":
    unittest.main()
