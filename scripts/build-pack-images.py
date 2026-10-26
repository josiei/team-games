"""Publish a pack's images under content-hashed names and write its pack.json.

Filenames are content hashes on purpose. "hockey-mask.jpg" would put the
answer in the file tree, in `git log`, and in the URL every player's browser
requests BEFORE the reveal — a leak to the players and to the repo's owner,
who is going to play this game.

Images are copied into the web client's static assets, because that is what
serves them; the pack stores the public URL it will be fetched by.

Usage: python3 scripts/build-pack-images.py <spec.json>
"""
import hashlib
import io
import json
import sys
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parent.parent
PUBLIC = REPO / "packages" / "web" / "public" / "games" / "fright-night" / "clues"
URL_BASE = "/games/fright-night/clues"

# The mosaic never exceeds ~24 blocks across and the reveal renders at about
# 280 CSS pixels, so a 1200px long edge is already generous. Shipping the
# Commons originals meant 40MB of clue images, several of them over 4MB, on a
# clock that gives a photograph 26 seconds to arrive before the buzzer arms.
MAX_EDGE = 1200
JPEG_QUALITY = 82


def publish(source: Path) -> str:
    """Downscale `source`, store it under a content-hashed name, return its URL."""
    with Image.open(source) as image:
        image = image.convert("RGB")
        image.thumbnail((MAX_EDGE, MAX_EDGE), Image.LANCZOS)
        buffer = io.BytesIO()
        image.save(buffer, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    data = buffer.getvalue()

    # Hash what is actually served, so the name always matches the bytes.
    name = f"{hashlib.sha256(data).hexdigest()[:16]}.jpg"
    PUBLIC.mkdir(parents=True, exist_ok=True)
    (PUBLIC / name).write_bytes(data)
    return f"{URL_BASE}/{name}"


def main():
    spec = json.loads(Path(sys.argv[1]).read_text())
    stage = REPO / spec["stage"]
    meta = json.loads((stage / "meta.json").read_text())
    trivia = json.loads((REPO / spec["trivia"]).read_text())

    categories = []
    for category in spec["imageCategories"]:
        clues = []
        for clue in category["clues"]:
            slug = clue["slug"]
            source = stage / meta[slug]["file"]
            clues.append({
                "value": clue["value"],
                "kind": "image",
                "file": publish(source),
                "mosaic": clue["mosaic"],
                "prompt": category.get("prompt", "Who is this?"),
                "choices": clue["choices"],
                # Real provenance: the Commons page, its licence and its author.
                "source": meta[slug]["descriptor"],
                "license": meta[slug]["license"],
                "author": meta[slug]["author"],
                "verifiedAt": spec["verifiedAt"],
            })
        categories.append({"id": category["id"], "name": category["name"], "clues": clues})

    pack = {
        "id": spec["id"],
        "name": spec["name"],
        "values": spec["values"],
        "categories": categories + trivia["categories"],
    }
    out = REPO / spec["out"]
    out.write_text(json.dumps(pack, indent=2) + "\n")

    counts = {c["id"]: len(c["clues"]) for c in pack["categories"]}
    print(f"wrote {out.relative_to(REPO)}")
    print(f"categories: {counts}")
    print(f"images published to {PUBLIC.relative_to(REPO)}")


if __name__ == "__main__":
    main()
