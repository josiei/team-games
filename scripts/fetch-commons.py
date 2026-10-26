"""Fetch Wikimedia Commons files by title into a staging directory.

Writes <stage>/<slug>.<ext> plus <stage>/meta.json carrying the descriptor
page URL, licence and author for every file, so the pack can record real
provenance rather than a bare link.

Usage: python3 scripts/fetch-commons.py <stage-dir> <titles-json>
"""
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://commons.wikimedia.org/w/api.php"
UA = "team-games-pack/1.0 (jocelyn.icaza@gmail.com)"


def api(params):
    url = f"{API}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.load(response)


def main():
    stage = Path(sys.argv[1])
    stage.mkdir(parents=True, exist_ok=True)
    wanted = json.loads(Path(sys.argv[2]).read_text())

    meta = {}
    for slug, title in wanted.items():
        data = api({
            "action": "query", "format": "json", "prop": "imageinfo",
            "iiprop": "url|extmetadata|size", "titles": title,
        })
        pages = data["query"]["pages"]
        page = next(iter(pages.values()))
        if "imageinfo" not in page:
            print(f"MISSING {slug}: {title}")
            continue
        info = page["imageinfo"][0]
        extra = info.get("extmetadata", {})

        ext = info["url"].rsplit(".", 1)[-1].lower()
        out = stage / f"{slug}.{ext}"
        req = urllib.request.Request(info["url"], headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=60) as response:
            out.write_bytes(response.read())

        meta[slug] = {
            "file": out.name,
            "title": title,
            "descriptor": info["descriptionurl"],
            "license": extra.get("LicenseShortName", {}).get("value", "?"),
            "author": extra.get("Artist", {}).get("value", "?"),
            "width": info.get("width"),
            "height": info.get("height"),
        }
        print(f"ok {slug}: {out.name} ({info.get('width')}x{info.get('height')}) "
              f"{meta[slug]['license']}")

    (stage / "meta.json").write_text(json.dumps(meta, indent=2) + "\n")


if __name__ == "__main__":
    main()
