"""Fire-and-forget HTTP push to the Socket.IO gateway."""
import os
import logging
import httpx

logger = logging.getLogger(__name__)

# Support both GATEWAY_URL (standard) and SMARTBOOK_GATEWAY_URL (legacy ai-service convention)
GATEWAY_URL = os.getenv("GATEWAY_URL") or os.getenv("SMARTBOOK_GATEWAY_URL", "http://api-gateway:3000")
INTERNAL_SERVICE_KEY = os.getenv("INTERNAL_SERVICE_KEY", "smartbook_internal_key")
SERVICE_NAME = "ai-service"

_HEADERS = {
    "Content-Type": "application/json",
    "X-Internal-Service-Key": INTERNAL_SERVICE_KEY,
    "X-Service-Name": SERVICE_NAME,
}


async def push_realtime_events(events: list[dict]) -> None:
    """Push multiple events to the gateway. Silently logs on failure."""
    if not events:
        return
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.post(
                f"{GATEWAY_URL}/internal/push-events",
                headers=_HEADERS,
                json={"events": events},
            )
            if resp.status_code >= 400:
                logger.warning("[ai-socket-emitter] push failed %s", resp.status_code)
    except Exception as exc:
        logger.warning("[ai-socket-emitter] push error (gateway unreachable): %s", exc)


async def push_ai_action_event(
    event: str,
    action_id: str,
    action_type: str,
    user_id: str | None,
    extra: dict | None = None,
) -> None:
    """Emit an ai_action:* event to admin room + the creating user's room."""
    payload = {
        "action_id": action_id,
        "action_type": action_type,
        **(extra or {}),
    }
    events = [{"room": "admin", "event": event, "data": payload}]
    if user_id:
        events.append({"room": f"user:{user_id}", "event": event, "data": payload})
    await push_realtime_events(events)
