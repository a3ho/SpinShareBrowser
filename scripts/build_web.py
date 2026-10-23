"""Assemble the shipped web artifacts from modular sources under web/src.

Zero-dependency (standard library only). Concatenation is order-only and
byte-exact: the generated artifacts are the module files joined in manifest
order, preceded by the generated banner comment.

Usage:
    python scripts/build_web.py            rebuild web/app.js + web/interface.css
    python scripts/build_web.py --check    verify artifacts match sources (exit 1 on drift)
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "web" / "src"

JS_BANNER = "// Generated from web/src/js/* — edit the modules and run scripts/build_web.py.\n"
CSS_BANNER = "/* Generated from web/src/css/* — edit the layers and run scripts/build_web.py. */\n"

# artifact path (relative to ROOT) -> banner + module files (relative to SRC)
MANIFEST = {
    "web/app.js": (JS_BANNER, "js", (
        "prologue.js",
        "i18n.js",
        "core-state.js",
        "motion.js",
        "status.js",
        "settings.js",
        "dialogs.js",
        "settings-panel.js",
        "window-regions.js",
        "filters.js",
        "search-tags.js",
        "choice-menus.js",
        "format-covers.js",
        "preview-player.js",
        "chart-popovers.js",
        "installer-client.js",
        "installation.js",
        "activity.js",
        "reviews.js",
        "pagination.js",
        "render.js",
        "catalog-sync.js",
        "json-response.js",
        "page-details.js",
        "apply-boot.js",
    )),
    "web/interface.css": (CSS_BANNER, "css", (
        "base.css",
        "desktop-shell.css",
        "title-bar.css",
        "volume.css",
        "filters.css",
        "search.css",
        "cards.css",
        "tag-layer.css",
        "window-chrome.css",
        "queue-dock.css",
        "catalog-sync.css",
        "utility.css",
        "reflow.css",
    )),
}


def assemble(artifact: str) -> tuple[str, str]:
    banner, folder, modules = MANIFEST[artifact]
    parts = [banner]
    for name in modules:
        path = SRC / folder / name
        content = path.read_bytes().decode("utf-8")
        if not content.endswith("\n"):
            raise SystemExit(f"module must end with a newline: {path}")
        parts.append(content)
    return artifact, "".join(parts)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true",
                        help="verify that the artifacts match the sources instead of writing")
    args = parser.parse_args()

    drift = False
    for artifact in MANIFEST:
        relative, content = assemble(artifact)
        target = ROOT / relative
        current = target.read_text(encoding="utf-8") if target.exists() else None
        if args.check:
            if current != content:
                drift = True
                print(f"DRIFT: {relative} does not match web/src modules")
            else:
                print(f"ok: {relative}")
        elif current != content:
            target.write_text(content, encoding="utf-8", newline="\n")
            print(f"wrote: {relative}")
    if args.check and drift:
        print("Run: python scripts/build_web.py")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
