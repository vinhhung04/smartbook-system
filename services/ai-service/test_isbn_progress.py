"""ISBN lookup progress telemetry (isbn_progress.py) - offline, no network."""
import asyncio
import json
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

import isbn_progress
import isbn_rounds
from isbn_rounds import BookProvider, run_round1, run_round2

ISBN = "9780132350884"
TARGETS = {ISBN}
BOOK = {"title": "Clean Code", "authors": ["Robert C. Martin"], "publisher": "Prentice Hall"}


def record(code=ISBN, **fields):
    return {**BOOK, **fields, "identifiers": [code], "sourceUrl": f"https://src.test/{code}"}


def provider(name, by_code=None, by_title=None, round1=False, **kwargs):
    kwargs.setdefault("retries", 0)
    return BookProvider(name, by_code=by_code, by_title=by_title, round1=round1, **kwargs)


def parse(chunks):
    """[(event, data)] from SSE chunks; comments (heartbeats) are skipped."""
    events = []
    for chunk in chunks:
        if chunk.startswith(":"):
            continue
        lines = dict(line.split(": ", 1) for line in chunk.strip().split("\n"))
        events.append((lines["event"], json.loads(lines["data"])))
    return events


async def collect(run, heartbeat=10.0):
    return parse([chunk async for chunk in isbn_progress.stream(run, heartbeat=heartbeat)])


class ProgressBase(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self._backoff = patch("isbn_rounds.RETRY_BACKOFF_SECONDS", 0)
        self._backoff.start()
        isbn_rounds.reset_politeness_state()

    def tearDown(self):
        self._backoff.stop()


class StreamTests(ProgressBase):
    async def test_emit_without_a_channel_is_a_no_op(self):
        self.assertFalse(isbn_progress.active())
        isbn_progress.emit("stage", stage="x", state="done")  # must not raise

    async def test_progress_then_exactly_one_result(self):
        async def run():
            isbn_progress.stage("validate", "done", kind="ISBN13")
            isbn_progress.stage("round1", "started", order=["a"])
            return {"found": True}

        events = await collect(run)
        self.assertEqual([name for name, _ in events], ["progress", "progress", "result"])
        self.assertEqual(events[-1][1], {"found": True})
        seqs = [data["seq"] for name, data in events if name == "progress"]
        self.assertEqual(seqs, sorted(seqs))
        self.assertEqual(events[0][1]["detail"], {"kind": "ISBN13"})

    async def test_concurrent_requests_never_mix_events(self):
        async def run(tag):
            for index in range(5):
                isbn_progress.emit("source", state="done", source=f"{tag}{index}")
                await asyncio.sleep(0)
            return {"tag": tag}

        first, second = await asyncio.gather(collect(lambda: run("a")), collect(lambda: run("b")))
        for tag, events in (("a", first), ("b", second)):
            sources = [data["source"] for name, data in events if name == "progress"]
            self.assertEqual(sources, [f"{tag}{i}" for i in range(5)])
            self.assertEqual(events[-1], ("result", {"tag": tag}))

    async def test_unexpected_error_is_reported_without_its_text(self):
        async def run():
            raise RuntimeError("secret connection string postgres://user:pw@db")

        events = await collect(run)
        self.assertEqual(events[-1][0], "error")
        self.assertEqual(events[-1][1], {"status": 500, "message": "Tra cứu thất bại"})
        self.assertNotIn("secret", json.dumps(events))

    async def test_http_exception_keeps_its_own_message(self):
        async def run():
            raise HTTPException(422, "A valid ISBN-10 or ISBN-13 is required")

        events = await collect(run)
        self.assertEqual(events[-1], ("error", {"status": 422, "message": "A valid ISBN-10 or ISBN-13 is required"}))

    async def test_heartbeat_while_waiting(self):
        async def run():
            await asyncio.sleep(0.05)
            return {}

        chunks = [chunk async for chunk in isbn_progress.stream(run, heartbeat=0.01)]
        self.assertTrue(any(chunk.startswith(": ping") for chunk in chunks))

    async def test_client_disconnect_does_not_cancel_the_lookup(self):
        finished = asyncio.Event()

        async def run():
            await asyncio.sleep(0.05)
            finished.set()
            return {}

        generator = isbn_progress.stream(run, heartbeat=0.01)
        await generator.__anext__()  # ": open"
        await generator.aclose()     # the browser went away
        await asyncio.wait_for(finished.wait(), timeout=1)

    async def test_public_outcome_drops_raw_errors(self):
        self.assertEqual(isbn_progress.public_outcome({"source": "a", "status": "ERROR", "error": "HTTP 403"})["errorCode"], "HTTP 403")
        raw = isbn_progress.public_outcome({"source": "a", "status": "ERROR", "error": "ValueError: bad html at /srv/x.py"})
        self.assertNotIn("errorCode", raw)
        self.assertNotIn("sourceUrl", isbn_progress.public_outcome({"source": "a", "sourceUrl": "javascript:alert(1)"}))


class RoundTelemetryTests(ProgressBase):
    def providers(self):
        miss = AsyncMock(return_value=None)
        hit = AsyncMock(return_value=record())
        # No printed code on the title hit: accepted as the same work (TITLE_MATCH), not by code.
        by_title = AsyncMock(return_value=[{**BOOK, "sourceUrl": "https://src.test/d"}])
        return [provider("a", miss, round1=True), provider("b", hit, round1=True),
                provider("c", AsyncMock(return_value=record()), round1=True),
                provider("d", by_title=by_title), provider("off", disabled_reason="INACTIVE: test")]

    async def run_both_rounds(self, providers):
        round1 = await run_round1([p for p in providers if p.round1], ISBN, TARGETS, True)
        round2 = await run_round2(providers, round1, ISBN, TARGETS)
        return round1, round2

    @staticmethod
    def comparable(outcomes):
        return [{k: v for k, v in o.items() if k not in ("durationMs", "retrievedAt")} for o in outcomes]

    async def test_events_follow_the_real_order_and_outcomes_are_unchanged(self):
        plain1, plain2 = await self.run_both_rounds(self.providers())
        isbn_rounds.reset_politeness_state()

        captured = {}

        async def run():
            captured["rounds"] = await self.run_both_rounds(self.providers())
            return {}

        events = [data for name, data in await collect(run) if name == "progress"]
        streamed1, streamed2 = captured["rounds"]
        # Telemetry observes only: same identity, same outcomes, same metadata.
        self.assertEqual(streamed1["identity"], plain1["identity"])
        self.assertEqual(self.comparable(streamed1["outcomes"]), self.comparable(plain1["outcomes"]))
        self.assertEqual(self.comparable(streamed2["outcomes"]), self.comparable(plain2["outcomes"]))
        self.assertEqual(set(streamed2["metadata"]), set(plain2["metadata"]))

        round1 = [(e["state"], e["source"], e.get("status")) for e in events if e["type"] == "source" and e["round"] == 1]
        self.assertEqual(round1, [("started", "a", None), ("done", "a", "NOT_FOUND"),
                                  ("started", "b", None), ("done", "b", "SUCCESS"),
                                  ("done", "c", "SKIPPED")])
        stages = [(e["stage"], e["state"]) for e in events if e["type"] == "stage"]
        self.assertEqual(stages, [("round1", "started"), ("round1", "done"), ("round2", "started"), ("round2", "done")])
        round2_done = {e["source"]: e for e in events if e["type"] == "source" and e["round"] == 2 and e["state"] == "done"}
        self.assertEqual(round2_done["off"]["status"], "DISABLED")
        self.assertEqual(round2_done["d"]["verification"], "TITLE_MATCH")
        self.assertEqual(round2_done["d"]["query"], "title")


if __name__ == "__main__":
    unittest.main()
