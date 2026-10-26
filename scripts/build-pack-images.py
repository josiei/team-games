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
import json
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PUBLIC = REPO / "packages" / "web" / "public" / "games" / "fright-night" / "clues"
URL_BASE = "/games/fright-night/clues"


def publish(source: Path) -> str:
    """Copy `source` under a content-hashed name; return its public URL."""
    digest = hashlib.sha256(source.read_bytes()).hexdigest()[:16]
    name = f"{digest}{source.suffix.lower()}"
    PUBLIC.mkdir(parents=True, exist_ok=True)
    target = PUBLIC / name
    if not target.exists():
        shutil.copy(source, target)
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
