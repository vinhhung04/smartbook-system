"""Thin router; dependencies injected by main to avoid import cycles."""
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
import isbn_progress
from catalog_access import catalog_access_error
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
        denied = await catalog_access_error(request.headers.get('authorization'))
        if denied:
            raise HTTPException(*denied)
        return await extract(body.input)

    @router.post('/metadata-intelligence/extract/stream')
    async def stream_endpoint(body: ExtractionRequest, request: Request):
        """The same extraction with SSE progress events, then one `result` event."""
        if not enabled():
            raise HTTPException(404, 'Metadata intelligence v2 is disabled')
        denied = await catalog_access_error(request.headers.get('authorization'))
        if denied:
            raise HTTPException(*denied)
        return StreamingResponse(isbn_progress.stream(lambda: extract(body.input)), media_type='text/event-stream',
                                 headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})

    return router
