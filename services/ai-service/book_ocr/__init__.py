"""Multi-image book OCR import: front cover / back cover / copyright page ->
reviewable, evidence-carrying metadata proposals for the AI Import form.

OCR here only proposes: nothing in this package writes to the catalog.
Pipeline (service.scan_book_images): images.prepare -> extractor (one
multimodal OpenRouter call) -> validation (normalize, ground, aggregate per
field) -> existing ISBN lookup (injected) -> reconcile (field-level proposals).
"""
