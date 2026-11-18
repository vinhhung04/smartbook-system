"""PRA11/16: real ASGI routes, fake billable provider, no live inference.

Public chat/discover remain supported. Administrative generation and warehouse
vision must authorize before inference, and upload caps must count actual bytes.
"""
import io
import os
import unittest
from contextlib import ExitStack, asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
from PIL import Image

import main
import image_input
import routes_public_discover
from ai_core import inference_boundary
from agent_schemas import UserContext


def picture():
    stream = io.BytesIO()
    Image.new("RGB", (80, 80), "white").save(stream, "PNG")
    return stream.getvalue()


class PaidInferenceBoundaryTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.provider = SimpleNamespace(
            name="mock-billable-provider",
            chat=AsyncMock(return_value=SimpleNamespace(text='{"summaryVi":"Mock summary","keywords":["mock"]}')),
            analyze_image=AsyncMock(return_value=({"item_count": 1, "detected_titles": [], "line_items": []}, None)),
        )
        self.stack.enter_context(patch.object(main, "get_openrouter_provider", return_value=self.provider))
        self.stack.enter_context(patch.object(main, "_get_text_llm_provider", return_value=self.provider))
        self.stack.enter_context(patch.object(main, "_search_book_context", return_value=""))
        @asynccontextmanager
        async def admitted(*_args):
            yield 'mock-lease'
        self.stack.enter_context(patch.object(inference_boundary.budget, 'reserve', admitted))
        self.stack.enter_context(patch.object(inference_boundary, 'opaque_principal', return_value='0' * 64))
        main.summary_cache.clear()
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test")
        self.addAsyncCleanup(self.client.aclose)

    def authenticate_admin(self):
        admin = UserContext(user_id="resource-test-admin", roles=["ADMIN"], is_superuser=True)
        self.stack.enter_context(patch.object(main, "get_user_context", AsyncMock(return_value=admin)))
        self.stack.enter_context(patch.object(main.ai_policy, "get_user_context", AsyncMock(return_value=admin)))
        self.stack.enter_context(patch("catalog_access.catalog_access_error", AsyncMock(return_value=None)))
        return {"Authorization": "Bearer test-admin-token"}

    async def test_anonymous_summary_aliases_never_reach_billable_provider(self):
        for path in ("/generate-book-summary", "/api/ai/generate-book-summary", "/generate-summary-vi"):
            with self.subTest(path=path):
                self.provider.chat.reset_mock()
                response = await self.client.post(path, json={"title": "Boundary book", "author": "Author"})
                self.assertEqual((response.status_code, self.provider.chat.await_count), (401, 0))

    async def test_anonymous_paid_metadata_modes_never_reach_billable_provider(self):
        for mode in ("keywords", "short_summary", "normalize_description", "suggest_categories"):
            with self.subTest(mode=mode):
                self.provider.chat.reset_mock()
                response = await self.client.post("/enrich-book-metadata", json={"title": "Boundary book", "description": "Existing book description", "mode": mode})
                self.assertEqual((response.status_code, self.provider.chat.await_count), (401, 0))

    async def test_plain_post_isbn_enrichment_has_same_auth_boundary_as_stream_alias(self):
        suggestions = AsyncMock(return_value={"provider": "mock", "keywords": []})
        with patch.object(main, "lookup_book_by_isbn", AsyncMock(return_value={"success": True, "title": "Book"})), \
             patch.object(main, "_normalize_with_catalog_authority", AsyncMock(return_value=(None, None))), \
             patch.object(main, "_build_post_isbn_ai_suggestions", suggestions):
            response = await self.client.post("/enrich-book-after-isbn", json={"isbn": "9786041234567"})
        self.assertEqual((response.status_code, suggestions.await_count), (401, 0))

    async def test_anonymous_warehouse_vision_never_reaches_billable_provider(self):
        for path in ("/scan-receipt", "/verify-packing-photo"):
            with self.subTest(path=path):
                self.provider.analyze_image.reset_mock()
                response = await self.client.post(path, files={"file": ("image.png", picture(), "image/png")})
                self.assertEqual((response.status_code, self.provider.analyze_image.await_count), (401, 0))

    async def test_anonymous_storage_explanation_never_reaches_billable_provider(self):
        response = await self.client.post("/explain-storage-suggestion", json={
            "book": {"title": "Book"}, "suggestions": [{"location_code": "A1", "reasons": ["Same category"]}],
        })
        self.assertEqual((response.status_code, self.provider.chat.await_count), (401, 0))

    async def test_image_mime_label_cannot_send_non_image_bytes_to_provider(self):
        headers = self.authenticate_admin()
        for path in ("/scan-receipt", "/verify-packing-photo"):
            with self.subTest(path=path):
                self.provider.analyze_image.reset_mock()
                response = await self.client.post(path, headers=headers,
                    files={"file": ("pretend.png", b"<html>not an image</html>", "image/png")})
                self.assertIn(response.status_code, (400, 415))
                self.provider.analyze_image.assert_not_awaited()

    async def test_oversized_legacy_images_are_refused_before_provider(self):
        headers = self.authenticate_admin()
        payload = picture() + b"x" * image_input.MAX_IMAGE_BYTES
        for path in ("/scan-receipt", "/verify-packing-photo"):
            with self.subTest(path=path):
                self.provider.analyze_image.reset_mock()
                response = await self.client.post(path, headers=headers, files={"file": ("large.png", payload, "image/png")})
                self.assertEqual((response.status_code, self.provider.analyze_image.await_count), (413, 0))

    async def test_chunked_multipart_is_stopped_before_entire_body_is_spooled(self):
        headers = self.authenticate_admin()
        headers["Content-Type"] = "multipart/form-data; boundary=resource-boundary"
        block = b"x" * (64 * 1024)
        consumed = 0

        async def chunks():
            nonlocal consumed
            yield b'--resource-boundary\r\nContent-Disposition: form-data; name="file"; filename="large.png"\r\nContent-Type: image/png\r\n\r\n'
            yield picture()
            for _ in range(2 * image_input.MAX_IMAGE_BYTES // len(block)):
                consumed += len(block)
                yield block
            yield b"\r\n--resource-boundary--\r\n"

        response = await self.client.post("/scan-receipt", headers=headers, content=chunks())
        self.assertEqual((response.status_code, self.provider.analyze_image.await_count), (413, 0))
        self.assertLessEqual(consumed, image_input.MAX_IMAGE_BYTES + 2 * len(block), "reject while receiving, before spooling the full oversized body")

    async def test_public_chat_and_discover_remain_available_without_login(self):
        with patch.object(main, "_prepare_chat_turn", AsyncMock(return_value={"abstain": True})), \
             patch.object(main, "_chat_abstention_payload", return_value={"reply": "Public library help"}):
            chat = await self.client.post("/chat", json={"message": "Library hours?"})
        routes_public_discover._cache.clear()
        with patch.object(routes_public_discover, "discover", AsyncMock(return_value={"results": [], "status": "NO_EVIDENCE"})):
            discover = await self.client.get("/public/discover", params={"q": "public library book"})
        self.assertEqual(chat.status_code, 200)
        self.assertEqual(discover.status_code, 200)
        self.provider.chat.assert_not_awaited()
        self.provider.analyze_image.assert_not_awaited()

    async def test_internal_inventory_key_is_scoped_to_warehouse_helpers(self):
        with patch.dict(os.environ, {'INTERNAL_SERVICE_KEY': 'test-inventory-ai-secret'}):
            allowed = await self.client.post('/verify-packing-photo', headers={'x-internal-service-key': 'test-inventory-ai-secret'},
                files={'file': ('image.png', picture(), 'image/png')})
            denied = await self.client.post('/scan-receipt', headers={'x-internal-service-key': 'test-inventory-ai-secret'},
                files={'file': ('image.png', picture(), 'image/png')})
        self.assertEqual(allowed.status_code, 200)
        self.assertEqual(denied.status_code, 401)
        self.assertEqual(self.provider.analyze_image.await_count, 1)

    async def test_public_isbn_lookup_is_budgeted_but_paid_summary_aliases_require_login(self):
        seen = []
        @asynccontextmanager
        async def admitted(feature, principal):
            seen.append(feature)
            yield 'test'
        with patch.object(inference_boundary.budget, 'reserve', admitted), \
             patch.object(main, 'lookup_book_by_isbn', AsyncMock(return_value={'success': True})):
            for path in ('/lookup-book-by-isbn', '/isbn-intelligence'):
                public = await self.client.post(path, json={'isbn': '9786041234567', 'generateVietnameseSummary': False})
                paid = await self.client.post(path, json={'isbn': '9786041234567', 'generateVietnameseSummary': True})
                self.assertEqual(public.status_code, 200)
                self.assertEqual(paid.status_code, 401)
        self.assertEqual(seen, ['public-isbn', 'public-isbn'])

    async def test_quota_denial_or_unavailable_store_never_reaches_provider(self):
        headers = self.authenticate_admin()
        from fastapi import HTTPException
        for status in (429, 503):
            @asynccontextmanager
            async def denied(*args):
                raise HTTPException(status, 'mock admission denied')
                yield
            with patch.object(inference_boundary.budget, 'reserve', denied):
                response = await self.client.post('/generate-book-summary', headers=headers, json={'title': 'Book', 'author': 'Author'})
            self.assertEqual(response.status_code, status)
        self.provider.chat.assert_not_awaited()

    async def test_unverified_revocation_and_missing_capability_fail_before_provider(self):
        headers = self.authenticate_admin()
        for user, expected in [(UserContext(user_id='reader', revocation_verified=False), 503),
                               (UserContext(user_id='reader', roles=['CUSTOMER'], permissions=[]), 403)]:
            with patch.object(main.ai_policy, 'get_user_context', AsyncMock(return_value=user)):
                response = await self.client.post('/verify-packing-photo', headers=headers, files={'file': ('image.png', picture(), 'image/png')})
            self.assertEqual(response.status_code, expected)
        self.provider.analyze_image.assert_not_awaited()

    async def test_provider_only_receives_normalized_image_and_pixel_limit_is_enforced(self):
        headers = self.authenticate_admin()
        response = await self.client.post('/scan-receipt', headers=headers,
            files={'file': ('image.png', picture() + b'private trailing bytes', 'image/png')})
        self.assertEqual(response.status_code, 200)
        actual = self.provider.analyze_image.await_args.args[0]
        self.assertEqual(image_input.sniff_format(actual), 'JPEG')
        self.assertNotIn(b'private trailing bytes', actual)
        self.provider.analyze_image.reset_mock()
        with patch.object(image_input, 'MAX_IMAGE_PIXELS', 100):
            response = await self.client.post('/scan-receipt', headers=headers, files={'file': ('image.png', picture(), 'image/png')})
        self.assertEqual(response.status_code, 413)
        self.provider.analyze_image.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
