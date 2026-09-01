"""Offline checks for split frontend resources and safe inline page assembly."""
import importlib.util
import json
from pathlib import Path
import re
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
import spinshare_portable as portable

TEMPLATE = """<!doctype html>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src __SPINSHARE_CONNECT_ORIGIN__">
<style>/*__SPINSHARE_STYLES__*/</style>
<script>
'use strict';
/*__SPINSHARE_CARDS__*/
/*__SPINSHARE_APP__*/
</script>
"""
STYLES = ".chart-card{min-width:0}"
CARDS = "function createChartCard(){return APP_CONFIG;}"
APP = "const UI_CATALOG=__SPINSHARE_UI_CATALOG__;\nconst APP_CONFIG=validateRuntimeConfig(__SPINSHARE_RUNTIME_CONFIG__);"


class WebResourceTests(unittest.TestCase):
    def assemble(self, template=TEMPLATE):
        return portable.assemble_web_template(template, styles=STYLES, cards=CARDS, app=APP)

    def test_one_classic_script_keeps_strict_mode_and_declaration_order(self):
        page = self.assemble()
        self.assertEqual(re.findall(r"<script\b[^>]*>", page), ["<script>"])
        self.assertEqual(page.count("<style>"), 1)
        self.assertRegex(page, r"<script>\s*'use strict';")
        self.assertLess(page.index(CARDS), page.index(APP))
        self.assertIn("<style>" + STYLES + "</style>", page)
        self.assertNotIn("type=\"module\"", page)

    def test_missing_or_duplicate_fragment_fails_instead_of_partial_page(self):
        for name in ("STYLES", "CARDS", "APP"):
            marker = "/*__SPINSHARE_" + name + "__*/"
            for template in (TEMPLATE.replace(marker, ""), TEMPLATE + marker):
                with self.subTest(name=name, duplicate=template.endswith(marker)):
                    with self.assertRaises(portable.PortableError):
                        self.assemble(template)

    def test_inserted_fragment_markers_are_not_expanded_again(self):
        styles = "/*__SPINSHARE_APP__*/"
        page = portable.assemble_web_template(TEMPLATE, styles=styles, cards=CARDS, app=APP)
        self.assertIn("<style>" + styles + "</style>", page)
        self.assertEqual(page.count(APP), 1)

    def test_runtime_injection_still_escapes_values_without_recursive_replacement(self):
        config = {"origin": "http://127.0.0.1:12345", "note": "</script>\u2028&",
                  "literal": "__SPINSHARE_UI_CATALOG__"}
        catalog = {"en": {"key": "<content>"}, "zh-CN": {"key": "内容"}}
        page = portable.render_page(self.assemble(), config, catalog)
        self.assertEqual(page.count("<script>"), 1)
        self.assertEqual(page.count("</script>"), 1)
        self.assertIn(r"\u003c/script\u003e\u2028\u0026", page)
        start = page.index("const APP_CONFIG=validateRuntimeConfig(") + len("const APP_CONFIG=validateRuntimeConfig(")
        self.assertEqual(json.JSONDecoder().raw_decode(page[start:])[0], config)
        duplicated = portable.assemble_web_template(TEMPLATE, styles=STYLES, cards=CARDS,
                                                    app=APP + "\n__SPINSHARE_UI_CATALOG__")
        with self.assertRaises(portable.PortableError):
            portable.render_page(duplicated, config, catalog)

    def test_source_and_frozen_loaders_read_the_same_fixed_resource_set(self):
        temporary_root = ROOT / ".qa" / "tmp"
        temporary_root.mkdir(parents=True, exist_ok=True)
        temporary = tempfile.TemporaryDirectory(prefix="web-resources-", dir=temporary_root)
        root = Path(temporary.name)
        try:
            self.assertEqual(root.resolve().parent, temporary_root.resolve())
            web = root / "web"
            web.mkdir()
            for name, value in {"index.html": TEMPLATE, "interface.css": STYLES,
                                "chart-card.js": CARDS, "app.js": APP}.items():
                (web / name).write_text(value, encoding="utf-8")
            with mock.patch.object(portable, "__file__", str(root / "src" / "spinshare_portable.py")), \
                    mock.patch.object(sys, "frozen", False, create=True):
                self.assertEqual(portable.load_web_template(), self.assemble())
            with mock.patch.object(sys, "frozen", True, create=True), \
                    mock.patch.object(sys, "_MEIPASS", str(root), create=True):
                self.assertEqual(portable.load_web_template(), self.assemble())
                (web / "chart-card.js").unlink()
                with self.assertRaises(FileNotFoundError):
                    portable.load_web_template()
        finally:
            self.assertEqual(root.resolve().parent, temporary_root.resolve())
            temporary.cleanup()

    def test_live_template_and_release_manifest_include_all_frontend_sources(self):
        spec = importlib.util.spec_from_file_location("web_resource_build", ROOT / "scripts" / "build.py")
        build = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(build)
        resources = {"web/index.html", "web/interface.css", "web/chart-card.js", "web/app.js", "web/locales.json"}
        self.assertEqual(set(build.WEB_FILES), resources)
        self.assertTrue(resources | {"tests/read_web_template.cjs", "tests/test_web_resources.py", "tests/test_audio_player.cjs"}
                        <= set(build.SOURCE_FILES))
        self.assertEqual(len(build.SOURCE_FILES), len(set(build.SOURCE_FILES)))
        for name in resources:
            self.assertTrue((ROOT / name).is_file(), name)
        page = portable.load_web_template()
        self.assertEqual(re.findall(r"<script\b[^>]*>", page), ["<script>"])
        self.assertRegex(page, r"<script>\s*'use strict';")
        for placeholder in ("__SPINSHARE_RUNTIME_CONFIG__", "__SPINSHARE_CONNECT_ORIGIN__", "__SPINSHARE_UI_CATALOG__"):
            self.assertEqual(page.count(placeholder), 1, placeholder)

    def test_live_csp_allows_only_the_preview_cdn_for_media(self):
        template = (ROOT / "web" / "index.html").read_text(encoding="utf-8")
        tag = re.search(r'<meta\b[^>]*http-equiv="Content-Security-Policy"[^>]*>', template, re.I)
        self.assertIsNotNone(tag)
        content = re.search(r'\bcontent="([^"]*)"', tag.group(0), re.I)
        self.assertIsNotNone(content)
        directives = {}
        for raw in content.group(1).split(";"):
            fields = raw.split()
            if fields:
                self.assertNotIn(fields[0], directives)
                directives[fields[0]] = fields[1:]
        self.assertEqual(directives.get("default-src"), ["'none'"])
        self.assertEqual(directives.get("media-src"), ["https://spinshare.b-cdn.net"])
        self.assertNotIn("blob:", directives["media-src"])
        self.assertNotIn("data:", directives["media-src"])


if __name__ == "__main__":
    unittest.main()
