"""Show one image at every mosaic level the board uses.

Answers "how illegible is a clue?" without touching the real pack: point it at
a stand-in and it renders the same ramp a player will see, 200 through 1000.

Usage: python3 scripts/mosaic-ramp.py <stage-dir> <slug> <out.png> <m1,m2,...> [values]
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

TILE = 300
PAD = 10
LABEL = 26


def mosaic(image: Image.Image, blocks: int) -> Image.Image:
    ratio = image.height / image.width
    down = image.resize((blocks, max(2, round(blocks * ratio))), Image.BOX)
    return down.resize(image.size, Image.NEAREST)


def main():
    stage, slug, out = Path(sys.argv[1]), sys.argv[2], Path(sys.argv[3])
    mosaics = [int(m) for m in sys.argv[4].split(',')]
    values = sys.argv[5].split(',') if len(sys.argv) > 5 else [''] * len(mosaics)

    meta = json.loads((stage / 'meta.json').read_text())
    source = Image.open(stage / meta[slug]['file']).convert('RGB')

    cells = []
    for blocks in mosaics:
        cell = mosaic(source, blocks).copy()
        cell.thumbnail((TILE, TILE), Image.NEAREST)
        cells.append(cell)
    # The untouched original, for comparison at the end of the ramp.
    original = source.copy()
    original.thumbnail((TILE, TILE), Image.LANCZOS)
    cells.append(original)
    values = [*values, 'REVEAL']

    height = max(c.height for c in cells)
    sheet = Image.new(
        'RGB',
        (len(cells) * (TILE + PAD) + PAD, height + LABEL + PAD * 2),
        (18, 16, 26),
    )
    draw = ImageDraw.Draw(sheet)
    for i, (cell, value) in enumerate(zip(cells, values)):
        x = PAD + i * (TILE + PAD)
        sheet.paste(cell, (x + (TILE - cell.width) // 2, PAD))
        caption = value if i == len(cells) - 1 else f'{value}  ({mosaics[i]} blocks)'
        draw.text((x + 4, PAD + height + 6), caption, fill=(235, 230, 245))

    sheet.save(out)
    print(f'{out} ({sheet.width}x{sheet.height})')


if __name__ == '__main__':
    main()
