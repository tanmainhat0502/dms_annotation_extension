import json
from pathlib import Path

EXT_DIR = Path(__file__).resolve().parents[1] / "extension"


def read_organizer_script() -> str:
    manifest = json.loads((EXT_DIR / "manifest.json").read_text(encoding="utf-8"))
    files = [f for f in manifest["content_scripts"][0]["js"] if f != "preload.js"]
    return "\n".join((EXT_DIR / name).read_text(encoding="utf-8") for name in files)
