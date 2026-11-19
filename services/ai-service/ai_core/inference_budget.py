"""Cross-worker admission budgets. Database failure never permits paid work."""
from __future__ import annotations

import hashlib
import asyncio
import hmac
import os
import uuid
from contextlib import asynccontextmanager

from fastapi import HTTPException
from sqlalchemy import text

from db import get_session
from metrics import ai_budget_admission_total


def setting(name: str, default: int, minimum: int = 1) -> int:
    value = int(os.getenv(name, str(default)))
    if value < minimum:
        raise ValueError(f"Invalid {name}")
    return value


def opaque_principal(identity: str) -> str:
    salt = os.getenv("AI_BUDGET_PRINCIPAL_SALT") or os.getenv("INTERNAL_SERVICE_KEY")
    if not salt or not identity:
        raise HTTPException(503, "Chưa cấu hình ngân sách AI.")
    return hmac.new(salt.encode(), identity.encode(), hashlib.sha256).hexdigest()


class InferenceBudget:
    def __init__(self, session_factory=get_session):
        self.session_factory = session_factory

    async def admit(self, feature: str, principal_hash: str) -> str:
        try:
            hourly = setting("AI_PAID_USER_HOURLY_REQUESTS", 40)
            daily = setting("AI_PAID_USER_DAILY_REQUESTS", 100)
            if feature == 'public-isbn':
                hourly = setting('AI_PUBLIC_ISBN_HOURLY_REQUESTS', 10)
                daily = setting('AI_PUBLIC_ISBN_DAILY_REQUESTS', 30)
            global_daily = setting("AI_PAID_GLOBAL_DAILY_REQUESTS", 1000)
            concurrency = setting("AI_PAID_MAX_CONCURRENT", 4)
            deadline = min(setting("AI_PAID_REQUEST_TIMEOUT_SECONDS", 120), 180)
            lease_seconds = min(max(setting("AI_PAID_LEASE_SECONDS", 180), deadline + 60), 360)
            lease_id = str(uuid.uuid4())
            async with self.session_factory() as session, session.begin():
                await session.execute(text("SET LOCAL lock_timeout = '3s'"))
                await session.execute(text("SET LOCAL statement_timeout = '5s'"))
                await session.execute(text("SELECT pg_advisory_xact_lock(hashtextextended('ai-paid-admission-v1', 0))"))
                counts = (await session.execute(text("""
                    SELECT count(*) FILTER (WHERE created_at >= date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS total_daily,
                           count(*) FILTER (WHERE principal_hash=:principal AND feature=:feature AND created_at >= CURRENT_TIMESTAMP - INTERVAL '1 hour') AS user_hourly,
                           count(*) FILTER (WHERE principal_hash=:principal AND feature=:feature AND created_at >= date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS user_daily,
                           count(*) FILTER (WHERE completed_at IS NULL AND expires_at > CURRENT_TIMESTAMP) AS active
                    FROM ai_inference_leases
                    WHERE created_at >= LEAST(CURRENT_TIMESTAMP - INTERVAL '1 hour', date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
                """), {"principal": principal_hash, "feature": feature})).mappings().one()
                if counts['total_daily'] >= global_daily or counts['user_hourly'] >= hourly or counts['user_daily'] >= daily or counts['active'] >= concurrency:
                    raise HTTPException(429, "Đã đạt giới hạn sử dụng AI. Vui lòng thử lại sau.")
                await session.execute(text("""INSERT INTO ai_inference_leases(id,feature,principal_hash,expires_at)
                    VALUES(CAST(:id AS uuid),:feature,:principal,CURRENT_TIMESTAMP + (:seconds * INTERVAL '1 second'))"""),
                    {"id": lease_id, "feature": feature, "principal": principal_hash, "seconds": lease_seconds})
            return lease_id
        except HTTPException as exc:
            ai_budget_admission_total.labels(feature=feature, outcome="quota" if exc.status_code == 429 else "unavailable").inc()
            raise
        except Exception as exc:
            ai_budget_admission_total.labels(feature=feature, outcome="unavailable").inc()
            raise HTTPException(503, "Chưa xác minh được ngân sách AI. Vui lòng thử lại sau.") from exc

    async def complete(self, lease_id: str):
        async with self.session_factory() as session, session.begin():
            await session.execute(text("UPDATE ai_inference_leases SET completed_at=CURRENT_TIMESTAMP WHERE id=CAST(:id AS uuid) AND completed_at IS NULL"), {"id": lease_id})

    @asynccontextmanager
    async def reserve(self, feature: str, principal_hash: str):
        try:
            lease_id = await asyncio.wait_for(self.admit(feature, principal_hash), timeout=10)
        except asyncio.TimeoutError as exc:
            ai_budget_admission_total.labels(feature=feature, outcome="unavailable").inc()
            raise HTTPException(503, "Chưa xác minh được ngân sách AI.") from exc
        try:
            yield lease_id
        finally:
            try:
                await asyncio.wait_for(self.complete(lease_id), timeout=5)
            except Exception:
                # No admission fallback. A failed release occupies capacity until
                # its bounded lease expires, and still consumes the daily budget.
                pass


budget = InferenceBudget()
