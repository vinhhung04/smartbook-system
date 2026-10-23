"""Catalog authorization for ai-service routes, decided by inventory-service.

Metadata Intelligence's original check, shared: the caller's own token is
forwarded to an inventory capability endpoint whose middleware enforces the
catalog permission (auth-service signature, revocation and fresh roles all
apply), so ai-service never re-implements RBAC. Fail-closed: if inventory
cannot be reached the request is refused.
"""
from __future__ import annotations

import os

import httpx

METADATA_CAPABILITY = "/api/metadata-reconciliations/capabilities"
# Manager decision + inventory.catalog.write - the same gate as creating the
# reconciliation draft the AI Import page saves through.
CATALOG_IMPORT_CAPABILITY = "/api/metadata-reconciliations/capabilities/import"


async def catalog_access_error(authorization: str | None, capability_path: str = METADATA_CAPABILITY) -> tuple[int, str] | None:
    """None when allowed, else (HTTP status, message)."""
    if not authorization:
        return 401, "Authentication required"
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(
                os.getenv("INVENTORY_SERVICE_URL", "http://inventory-service:3002").rstrip("/") + capability_path,
                headers={"Authorization": authorization},
            )
    except httpx.HTTPError:
        return 503, "Catalog authorization unavailable"
    if response.status_code != 200:
        return (response.status_code if response.status_code in (401, 403) else 503), "Catalog authorization unavailable"
    return None
