"""Thin router; dependencies injected by main to avoid import cycles."""
from fastapi import APIRouter, HTTPException, Request
from metadata_intelligence.schemas import ExtractionRequest


def build_router(extract, enabled):
    router = APIRouter(tags=['metadata-intelligence'])

    @router.get('/metadata-intelligence/capabilities')
    async def capabilities():
        return {'enabled': enabled(), 'inputTypes': ['isbn', 'html', 'text']}

    @router.post('/metadata-intelligence/extract')
    async def endpoint(body: ExtractionRequest, request: Request):
        if not enabled():
            raise HTTPException(404, 'Metadata intelligence v2 is disabled')
        # Same catalog authorization boundary as draft storage, verified by Inventory.
        import os
        import httpx
        authorization = request.headers.get('authorization')
        if not authorization:
            raise HTTPException(401, 'Authentication required')
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                response = await client.get(os.getenv('INVENTORY_SERVICE_URL', 'http://inventory-service:3002').rstrip('/')
                                            + '/api/metadata-reconciliations/capabilities',
                                            headers={'Authorization': authorization})
            if response.status_code != 200:
                raise HTTPException(response.status_code if response.status_code in (401, 403) else 503, 'Catalog authorization unavailable')
        except httpx.HTTPError:
            raise HTTPException(503, 'Catalog authorization unavailable')
        return await extract(body.input)

    return router
