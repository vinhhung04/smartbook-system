"""CLIP image embedding for the "find book by cover photo" feature.

Frozen, pretrained model — no training, no training data. Every call degrades
gracefully (returns None on any failure) so a slow/unavailable model never
breaks the OCR-text signal in routes_cover_search.py, matching the contract
already established by embeddings.py for text.
"""
from __future__ import annotations

import io
import logging
import os
import threading

logger = logging.getLogger("uvicorn.error")

CLIP_MODEL_NAME = os.getenv("CLIP_MODEL_NAME", "openai/clip-vit-base-patch32")

# Lazy singleton: loading the model (~600MB download on first run, then cached
# under ~/.cache/huggingface) is too slow to do at import time or per-request.
_model = None
_processor = None
# embed_image() runs on the asyncio-to-thread threadpool, so concurrent callers
# (e.g. the startup warm-up racing a request that arrives immediately after) are
# real OS threads, not coroutines — without this lock, one thread could observe
# _model already set by another thread but _processor still None (the two
# globals are assigned in two separate statements) and crash calling None(...).
# Confirmed in testing: this raced during reindex and silently failed ~13/100
# images with TypeError before this lock was added.
_load_lock = threading.Lock()


def _load_model():
    global _model, _processor
    if _model is not None and _processor is not None:
        return _model, _processor

    with _load_lock:
        if _model is None or _processor is None:
            # Imported here, not at module scope, so importing this module never
            # pays the cost of loading torch/transformers unless the feature is
            # actually used.
            import torch
            from transformers import CLIPModel, CLIPProcessor

            _model = CLIPModel.from_pretrained(CLIP_MODEL_NAME)
            _model.eval()
            torch.set_grad_enabled(False)
            _processor = CLIPProcessor.from_pretrained(CLIP_MODEL_NAME)
    return _model, _processor


def embed_image(image_bytes: bytes) -> list[float] | None:
    """Returns a normalized CLIP image embedding, or None on any decode/inference
    failure — callers must degrade gracefully (fall back to the OCR-text signal
    alone), never raise."""
    try:
        from PIL import Image

        model, processor = _load_model()
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        inputs = processor(images=image, return_tensors="pt")
        features = model.get_image_features(**inputs)
        # Observed on transformers 5.17.0: get_image_features returns a
        # BaseModelOutputWithPooling wrapper (.pooler_output holds the actual
        # projected [1, 512] embedding), not a raw tensor as in older versions.
        # Handle both so a future transformers upgrade doesn't silently break this.
        if hasattr(features, "pooler_output"):
            features = features.pooler_output
        # .flatten() rather than features[0]: collapses whatever batch/singleton
        # dims remain into the one real embedding vector for our single image.
        vector = features.flatten()
        vector = vector / vector.norm()
        return vector.tolist()
    except Exception as exc:
        logger.warning("cover_embeddings: image embedding failed: %s", type(exc).__name__)
        return None


async def warm_up() -> None:
    """Best-effort: load the model into memory before the first real request
    pays that cost, mirroring main.py's _startup_warmup_assistant_model."""
    import asyncio

    try:
        await asyncio.to_thread(_load_model)
    except Exception as exc:
        logger.warning("cover_embeddings: warm-up failed (non-fatal): %s", exc)
