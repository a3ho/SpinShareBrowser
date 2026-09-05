"""Offline checks for split frontend resources and safe inline page assembly."""
import importlib.util
import http.client
import json
from pathlib import Path
import re
import sys
import tempfile
import threading
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
import spinshare_portable as portable

TEMPLATE = """<!doctype html>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src __SPINSHARE_CONNECT_ORIGIN__; media-src __SPINSHARE_MEDIA_ORIGIN__">
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
        for placeholder in ("__SPINSHARE_RUNTIME_CONFIG__", "__SPINSHARE_CONNECT_ORIGIN__", "__SPINSHARE_MEDIA_ORIGIN__", "__SPINSHARE_UI_CATALOG__"):
            self.assertEqual(page.count(placeholder), 1, placeholder)

    def test_live_csp_allows_only_the_preview_cdn_and_paired_local_media(self):
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
        self.assertEqual(directives.get("media-src"), ["https://spinshare.b-cdn.net", "__SPINSHARE_MEDIA_ORIGIN__"])
        self.assertNotIn("blob:", directives["media-src"])
        self.assertNotIn("data:", directives["media-src"])

    def test_live_ui_does_not_create_native_title_tooltips(self):
        sources = {
            name: (ROOT / "web" / name).read_text(encoding="utf-8")
            for name in ("index.html", "chart-card.js", "app.js")
        }
        self.assertIsNone(re.search(r"\s(?:title|data-ui-attr-title)=", sources["index.html"], re.I))
        for name in ("chart-card.js", "app.js"):
            with self.subTest(name=name):
                self.assertIsNone(re.search(r"uiAttr\([^;\n]*,\s*['\"]title['\"]", sources[name]))
                self.assertIsNone(re.search(r"\.[Tt]itle\s*=", sources[name]))
        self.assertNotIn("['aria-label','title']", sources["app.js"])

    def test_system_prompt_copy_omits_terminal_full_stops(self):
        catalog = json.loads((ROOT / "web" / "locales.json").read_text(encoding="utf-8"))
        for language, messages in catalog.items():
            for key, value in messages.items():
                with self.subTest(language=language, key=key):
                    self.assertFalse(value.endswith((".", "。")), value)
                    self.assertNotIn("...", value, "Loading copy uses one typographic ellipsis")

        template = (ROOT / "web" / "index.html").read_text(encoding="utf-8")
        static_text = re.compile(
            r'<(?P<tag>[A-Za-z][\w:-]*)\b[^>]*\bdata-ui-static="[^"]+"[^>]*>'
            r'(?P<text>[^<]*)</(?P=tag)>'
        )
        for match in static_text.finditer(template):
            text = match.group("text")
            with self.subTest(fallback=text):
                self.assertFalse(text.endswith((".", "。")))
                self.assertNotIn("...", text)


class PlayerShortcutPersistenceTests(unittest.TestCase):
    def setUp(self):
        temporary_root = ROOT / ".qa" / "tmp"
        temporary_root.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix="player-shortcut-", dir=temporary_root)
        self.root = Path(self.temporary.name)
        self.target_patch = mock.patch.object(portable.installer, "default_target_directory",
                                              return_value=self.root / "Custom")
        self.target_patch.start()

    def tearDown(self):
        self.target_patch.stop()
        self.temporary.cleanup()

    def test_old_config_adds_false_and_non_boolean_is_rejected(self):
        store = portable.ConfigStore(self.root / "state")
        legacy = {
            "schemaVersion": 1,
            "token": "1" * 64,
            "customDirectory": None,
            "revision": "2" * 32,
            "language": "zh-CN",
            "closeBehavior": "ask",
            "trayNoticeShown": False,
            "windowSize": None,
        }
        store.path.write_bytes(portable._json_bytes(legacy))

        migrated = store.load()

        self.assertIs(migrated["playerShortcutHintShown"], False)
        self.assertIs(json.loads(store.path.read_bytes())["playerShortcutHintShown"], False)
        store.path.write_bytes(portable._json_bytes(dict(migrated, playerShortcutHintShown=0)))
        with self.assertRaises(portable.PortableError):
            store.load()

    def test_seen_endpoint_persists_true_and_updates_bootstrap(self):
        state = self.root / "state"
        app = portable.PortableApplication(state)
        worker = threading.Thread(target=app.serve_forever, daemon=True)
        worker.start()
        self.assertTrue(app.started.wait(2))
        try:
            self.assertIs(app.bootstrap()["playerShortcutHintShown"], False)
            connection = http.client.HTTPConnection(portable.HOST, app.port, timeout=3)
            try:
                connection.request("POST", "/v1/player-shortcuts-seen", body=b"{}", headers={
                    "Origin": app.origin,
                    "X-SpinShare-Key": app.token,
                    "Content-Type": "application/json",
                })
                response = connection.getresponse()
                self.assertEqual(response.status, 200)
                self.assertEqual(json.loads(response.read()), {"shown": True})
            finally:
                connection.close()
            self.assertIs(app.bootstrap()["playerShortcutHintShown"], True)
        finally:
            app.close()
            worker.join(3)
            self.assertFalse(worker.is_alive())
        self.assertIs(portable.ConfigStore(state).load()["playerShortcutHintShown"], True)


if __name__ == "__main__":
    unittest.main()
