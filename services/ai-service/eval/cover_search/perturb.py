"""Track B: controlled image perturbations of gallery images.

Every output is labelled CONTROLLED_IMAGE_PERTURBATION and linked to its parent
asset, transform name, exact parameters, seed and SHA-256. These are synthetic
transformations of the gallery image itself — NOT real photographs — so Track B
measures robustness to controlled degradations, never real-world retrieval.

Usage:
    python perturb.py            # (re)creates missing derivatives, appends manifest rows
"""
from __future__ import annotations

import hashlib
import io
import random
import time
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

from common import DATASET_DIR
from dataset_loader import read_csv, write_csv

LABEL = "CONTROLLED_IMAGE_PERTURBATION"
BASE_SEED = 20261112
FILL = (245, 245, 245)


def _seed(asset_id: str, transform: str) -> int:
    digest = hashlib.sha256(f"{BASE_SEED}|{asset_id}|{transform}".encode()).hexdigest()
    return int(digest[:12], 16)


def _perspective_coeffs(src, dst):
    """Solve the 8 projective coefficients PIL expects (maps output->input)."""
    import numpy as np
    matrix, vector = [], []
    for (x, y), (u, v) in zip(dst, src):
        matrix.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); vector.append(u)
        matrix.append([0, 0, 0, x, y, 1, -v * x, -v * y]); vector.append(v)
    return list(np.linalg.solve(np.array(matrix, dtype=float), np.array(vector, dtype=float)))


def apply(image: Image.Image, transform: str, rng: random.Random) -> tuple[Image.Image | bytes, dict]:
    w, h = image.size
    if transform == "rot_p4":
        return image.rotate(4, resample=Image.Resampling.BICUBIC, expand=True, fillcolor=FILL), \
            {"degrees": 4, "expand": True, "fill": FILL}
    if transform == "rot_m4":
        return image.rotate(-4, resample=Image.Resampling.BICUBIC, expand=True, fillcolor=FILL), \
            {"degrees": -4, "expand": True, "fill": FILL}
    if transform == "perspective":
        m = 0.08
        jitter = [(rng.uniform(0, m) * w, rng.uniform(0, m) * h) for _ in range(4)]
        dst = [(jitter[0][0], jitter[0][1]), (w - jitter[1][0], jitter[1][1]),
               (w - jitter[2][0], h - jitter[2][1]), (jitter[3][0], h - jitter[3][1])]
        src = [(0, 0), (w, 0), (w, h), (0, h)]
        coeffs = _perspective_coeffs(src, dst)
        out = image.transform((w, h), Image.Transform.PERSPECTIVE, coeffs, Image.Resampling.BICUBIC, fillcolor=FILL)
        return out, {"max_corner_shift_fraction": m, "dst_corners": [[round(a, 1), round(b, 1)] for a, b in dst]}
    if transform == "gaussian_blur":
        radius = round(max(1.0, 0.004 * max(w, h)), 2)
        return image.filter(ImageFilter.GaussianBlur(radius=radius)), {"radius_px": radius, "rule": "max(1, 0.004*long_side)"}
    if transform == "low_light":
        return ImageEnhance.Brightness(image).enhance(0.45), {"brightness_factor": 0.45}
    if transform == "low_contrast":
        return ImageEnhance.Contrast(image).enhance(0.5), {"contrast_factor": 0.5}
    if transform == "jpeg_q20":
        buffer = io.BytesIO()
        image.save(buffer, format="JPEG", quality=20)
        return buffer.getvalue(), {"jpeg_quality": 20}
    if transform == "occlusion":
        ow, oh = int(w * 0.45), int(h * 0.45)  # ~20% of the area
        x0, y0 = rng.randint(0, w - ow), rng.randint(0, h - oh)
        out = image.copy()
        ImageDraw.Draw(out).rectangle([x0, y0, x0 + ow, y0 + oh], fill=(128, 128, 128))
        return out, {"box_xyxy": [x0, y0, x0 + ow, y0 + oh], "area_fraction": round(ow * oh / (w * h), 3), "fill": [128, 128, 128]}
    if transform == "mild_crop":
        fractions = [rng.uniform(0.03, 0.08) for _ in range(4)]
        box = (int(fractions[0] * w), int(fractions[1] * h), w - int(fractions[2] * w), h - int(fractions[3] * h))
        return image.crop(box), {"crop_box_xyxy": list(box), "side_fractions_lrtb": [round(f, 3) for f in fractions]}
    raise ValueError(transform)


TRANSFORMS = ("rot_p4", "rot_m4", "perspective", "gaussian_blur", "low_light",
              "low_contrast", "jpeg_q20", "occlusion", "mild_crop")


def main() -> None:
    manifest_path = DATASET_DIR / "manifest" / "dataset_manifest.csv"
    assets = read_csv(manifest_path)
    existing = {row["asset_id"] for row in assets}
    out_dir = DATASET_DIR / "assets" / "derived"
    out_dir.mkdir(parents=True, exist_ok=True)
    new_rows = []
    parents = [row for row in assets if row["role"] == "gallery" and row["status"] == "INCLUDED"]
    for parent in parents:
        source = Image.open(DATASET_DIR / parent["local_path"]).convert("RGB")
        for transform in TRANSFORMS:
            asset_id = f"{parent['asset_id']}__{transform}"
            if asset_id in existing:
                continue
            seed = _seed(parent["asset_id"], transform)
            result, params = apply(source, transform, random.Random(seed))
            path = out_dir / f"{asset_id}.jpg"
            if isinstance(result, bytes):
                path.write_bytes(result)
            else:
                result.save(path, format="JPEG", quality=95)
            data = path.read_bytes()
            with Image.open(path) as check:
                width, height = check.size
            new_rows.append({
                "asset_id": asset_id, "role": "query_perturbation", "status": "INCLUDED",
                "book_id": parent["book_id"], "edition_id": parent["edition_id"],
                "parent_asset_id": parent["asset_id"], "query_type": LABEL,
                "transform_name": transform, "transform_parameters": repr(params), "random_seed": str(seed),
                "local_path": str(path.relative_to(DATASET_DIR)).replace("\\", "/"),
                "mime": "image/jpeg", "width": str(width), "height": str(height), "bytes": str(len(data)),
                "sha256": hashlib.sha256(data).hexdigest(),
                "retrieved_or_created_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "source_platform": "derived (local transformation)",
                "image_condition": transform,
            })
    write_csv(manifest_path, assets + new_rows)
    print(f"parents={len(parents)} new_derivatives={len(new_rows)}")


if __name__ == "__main__":
    main()
