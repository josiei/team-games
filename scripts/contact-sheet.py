"""Build a contact sheet so every candidate image can be eyed at once.

Two modes:
  full    the photographs as they are, to judge subject, framing and safety
  mosaic  each one at its proposed block count, to judge whether the row's
          value is honest — a cheap clue must be gettable, a dear one must not

Usage: python3 scripts/contact-sheet.py <stage-dir> <out.png> full|mosaic [mosaics.json]
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

TILE_W = 340
TILE_H = 430
COLS = 5
PAD = 8
LABEL_H = 22


def mosaic(image: Image.Image, blocks: int) -> Image.Image:
    ratio = image.height / image.width
    down = image.resize((blocks, max(2, round(blocks * ratio))), Image.BOX)
    return down.resize(image.size, Image.NEAREST)


def main():
    stage = Path(sys.argv[1])
    out = Path(sys.argv[2])
    mode = sys.argv[3]
    mosaics = json.loads(Path(sys.argv[4]).read_text()) if len(sys.argv) > 4 else {}

    meta = json.loads((stage / "meta.json").read_text())
    slugs = list(meta)
    rows = (len(slugs) + COLS - 1) // COLS

    sheet = Image.new(
        "RGB",
        (COLS * (TILE_W + PAD) + PAD, rows * (TILE_H + LABEL_H + PAD) + PAD),
        (18, 16, 26),
    )
    draw = ImageDraw.Draw(sheet)

    for i, slug in enumerate(slugs):
        with Image.open(stage / meta[slug]["file"]) as source:
            image = source.convert("RGB")
            if mode == "mosaic":
                image = mosaic(image, mosaics.get(slug, 12))
            image.thumbnail((TILE_W, TILE_H), Image.NEAREST if mode == "mosaic"
                            else Image.LANCZOS)

            x = PAD + (i % COLS) * (TILE_W + PAD)
            y = PAD + (i // COLS) * (TILE_H + LABEL_H + PAD)
            sheet.paste(image, (x + (TILE_W - image.width) // 2, y))
            label = slug if mode == "full" else f"{slug} @{mosaics.get(slug, 12)}"
            draw.text((x + 2, y + TILE_H + 4), label, fill=(230, 226, 240))

    sheet.save(out)
    print(f"{out} ({sheet.width}x{sheet.height})")


if __name__ == "__main__":
    main()
