"""Reciprocal Rank Fusion — gop nhieu bang xep hang thanh mot.

Chon RRF thay vi cong diem co trong so vi cosine similarity (0..1) va ts_rank
(khong chan tren) la hai thang do khac ban chat; chuan hoa chung lai se dua vao
gia dinh ve phan phoi diem ma khong ai kiem chung. RRF chi dung THU HANG, nen
khong co tham so nao phai tune mu.

Ham thuan, khong I/O.
"""
from __future__ import annotations

from vector_store import Hit

RRF_K = 60  # hang so chuan trong bai goc (Cormack 2009); lam phang chenh lech o top


def reciprocal_rank_fusion(
    rankings: list[list[Hit]], k: int = RRF_K, limit: int | None = None,
) -> list[Hit]:
    """score(doc) = sum over rankings of 1/(k + rank), rank tinh tu 1.

    Gop theo source_id, khong phai chunk_id: hai chunk cua cung mot tai lieu
    la cung mot ket qua duoi goc nhin cua nguoi dung.
    """
    scores: dict[str, float] = {}
    best: dict[str, Hit] = {}
    for ranking in rankings:
        seen: set[str] = set()
        for rank, item in enumerate(ranking, start=1):
            if item.source_id in seen:
                continue  # mot bang xep hang chi duoc gop 1 lan cho moi tai lieu
            seen.add(item.source_id)
            scores[item.source_id] = scores.get(item.source_id, 0.0) + 1.0 / (k + rank)
            if item.source_id not in best:
                best[item.source_id] = item

    ordered = sorted(scores.items(), key=lambda pair: (-pair[1], pair[0]))
    fused = [
        Hit(
            chunk_id=best[source_id].chunk_id, document_id=best[source_id].document_id,
            source_id=source_id, corpus=best[source_id].corpus,
            content=best[source_id].content, score=score,
            metadata=best[source_id].metadata,
        )
        for source_id, score in ordered
    ]
    return fused[:limit] if limit is not None else fused
