"""Annotation aid: tile downloaded images into numbered contact sheets so the
annotator can verify, per asset, that the image is a front cover of the
expected book and whether the title is legible. Sheets are written to
research-inputs/cover-search-dataset/assets/contact_sheets/ (git-ignored with
the images, since they contain the images).

    python contact_sheet.py --prefix G-EN --per-sheet 12
"""
from __future__ import annotations

import argparse
import textwrap

from PIL import Image, ImageDraw, ImageFont

from common import DATASET_DIR
from dataset_loader import read_csv

CELL_W, CELL_H, LABEL_H = 300, 400, 54


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--prefix", default="")
    parser.add_argument("--ids", default="")
    parser.add_argument("--per-sheet", type=int, default=12)
    parser.add_argument("--cols", type=int, default=4)
    parser.add_argument("--name", default="sheet")
    args = parser.parse_args()

    rows = [r for r in read_csv(DATASET_DIR / "manifest" / "dataset_manifest.csv")
            if r.get("local_path") and r["asset_id"].startswith(args.prefix)]
    if not rows:  # manifest not written yet: read straight from assets/raw + selection.csv
        names = {r["asset_id"]: r["commons_file"] for r in read_csv(DATASET_DIR / "manifest" / "selection.csv")}
        rows = []
        for path in sorted((DATASET_DIR / "assets" / "raw").iterdir()):
            if path.stem.startswith(args.prefix):
                with Image.open(path) as im:
                    w, h = im.size
                rows.append({"asset_id": path.stem, "local_path": f"assets/raw/{path.name}", "width": w, "height": h,
                             "commons_file": names.get(path.stem, "")})
    if args.ids:
        wanted = args.ids.split(",")
        rows = [r for r in rows if r["asset_id"] in wanted]
    out_dir = DATASET_DIR / "assets" / "contact_sheets"
    out_dir.mkdir(parents=True, exist_ok=True)
    try:
        font = ImageFont.truetype("arial.ttf", 13)
    except OSError:
        font = ImageFont.load_default()
    paths = []
    for start in range(0, len(rows), args.per_sheet):
        chunk = rows[start:start + args.per_sheet]
        n_rows = (len(chunk) + args.cols - 1) // args.cols
        sheet = Image.new("RGB", (args.cols * CELL_W, n_rows * (CELL_H + LABEL_H)), "white")
        draw = ImageDraw.Draw(sheet)
        for i, row in enumerate(chunk):
            x, y = (i % args.cols) * CELL_W, (i // args.cols) * (CELL_H + LABEL_H)
            with Image.open(DATASET_DIR / row["local_path"]) as image:
                image = image.convert("RGB")
                image.thumbnail((CELL_W - 8, CELL_H - 8))
                sheet.paste(image, (x + (CELL_W - image.width) // 2, y + 4))
            label = f"{row['asset_id']} {row.get('width')}x{row.get('height')}\n" + \
                textwrap.shorten(row.get("commons_file", "").replace("File:", ""), 80)
            draw.multiline_text((x + 4, y + CELL_H), "\n".join(textwrap.wrap(label, 44))[:200], fill="black", font=font)
        path = out_dir / f"{args.name}_{start // args.per_sheet + 1:02d}.jpg"
        sheet.save(path, quality=85)
        paths.append(str(path))
    print("\n".join(paths))


if __name__ == "__main__":
    main()
