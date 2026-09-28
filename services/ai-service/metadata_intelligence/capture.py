"""Request-local snapshots from existing provider adapters; no shared mutable capture."""
from contextvars import ContextVar
from .sources import document

collector = ContextVar('metadata_source_collector', default=None)


def capture(provider, kind, payload, url=None):
    sink = collector.get()
    if sink is None or len(sink) >= 5:
        return
    try:
        doc = document(provider, kind, payload, url)
    except (ValueError, TypeError):
        return
    if not any(d['id'] == doc['id'] for d in sink):
        sink.append(doc)
