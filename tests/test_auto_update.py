"""Chart auto-update contracts: baseline rules, planning, toggle, endpoints."""
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
import auto_update
import spinshare_portable as portable


def make_song(song_id, reference, update_hash):
    return {"id": song_id, "fileReference": reference, "updateHash": update_hash}


def write_srtb(directory, reference, content: bytes):
    (directory / (reference + ".srtb")).write_bytes(content)


class PlanningTests(unittest.TestCase):
    def test_up_to_date_refreshes_baseline(self):
        rows = [(1, "spinshare_a", "0" * 32)]
        installed = {"spinshare_a": "0" * 32}
        to_update, baseline = auto_update.plan_auto_update(rows, installed, {})
        self.assertEqual(to_update, [])
        self.assertEqual(baseline, {"spinshare_a": "0" * 32})

    def test_untouched_file_with_moved_cloud_updates(self):
        rows = [(1, "spinshare_a", "1" * 32)]
        installed = {"spinshare_a": "0" * 32}
        baseline = {"spinshare_a": "0" * 32}
        to_update, next_baseline = auto_update.plan_auto_update(rows, installed, baseline)
        self.assertEqual(to_update, [1])
        # The baseline keeps the last known local match; it is refreshed when
        # the reinstall lands and the next pass sees the new hash.
        self.assertEqual(next_baseline.get("spinshare_a"), "0" * 32)

    def test_user_modified_file_is_never_touched(self):
        rows = [(1, "spinshare_a", "1" * 32)]
        installed = {"spinshare_a": "2" * 32}  # differs from both
        baseline = {"spinshare_a": "0" * 32}
        to_update, _ = auto_update.plan_auto_update(rows, installed, baseline)
        self.assertEqual(to_update, [])

    def test_first_sighting_follows_owners_literal_rule(self):
        rows = [(1, "spinshare_a", "1" * 32)]
        installed = {"spinshare_a": "0" * 32}
        to_update, _ = auto_update.plan_auto_update(rows, installed, {})
        self.assertEqual(to_update, [1], "pre-feature installs update to latest")

    def test_removed_upstream_is_kept(self):
        rows = [(1, "spinshare_b", "1" * 32)]
        installed = {"spinshare_a": "0" * 32}
        to_update, baseline = auto_update.plan_auto_update(rows, installed, {"spinshare_a": "0" * 32})
        self.assertEqual(to_update, [])
        self.assertEqual(baseline, {"spinshare_a": "0" * 32})


class BaselineIOTests(unittest.TestCase):
    def setUp(self):
        temporary_root = ROOT / ".qa" / "tmp"
        temporary_root.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix="auto-update-", dir=temporary_root)
        self.state = Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def test_baseline_roundtrip_and_corruption_tolerance(self):
        auto_update.save_baseline(self.state, portable, {"spinshare_a": "0" * 32})
        self.assertEqual(auto_update.load_baseline(self.state, portable), {"spinshare_a": "0" * 32})
        (self.state / portable.UPDATE_BASELINE_NAME).write_bytes(b"not json")
        self.assertEqual(auto_update.load_baseline(self.state, portable), {})

    def test_scan_installed_charts(self):
        target = self.state / "Custom"
        target.mkdir()
        write_srtb(target, "spinshare_a", b"one")
        write_srtb(target, "spinshare_b", b"two")
        (target / "junk.txt").write_bytes(b"x")
        scanned = auto_update.scan_installed_charts(target, portable)
        self.assertEqual(set(scanned), {"spinshare_a", "spinshare_b"})
        import hashlib
        self.assertEqual(scanned["spinshare_a"], hashlib.md5(b"one").hexdigest())


class AutoUpdatePassTests(unittest.TestCase):
    def setUp(self):
        temporary_root = ROOT / ".qa" / "tmp"
        temporary_root.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix="auto-pass-", dir=temporary_root)
        self.root = Path(self.temporary.name)
        self.default_target = self.root / "Custom"
        self.default_target.mkdir()
        self.target_patch = mock.patch.object(
            portable.installer, "default_target_directory", return_value=self.default_target)
        self.target_patch.start()
        portable.session_client._write_queue = portable.session_client.WriteQueue(minimum_gap=0.0)

    def tearDown(self):
        self.target_patch.stop()
        self.temporary.cleanup()

    def test_pass_disabled_without_the_switch(self):
        app = portable.PortableApplication(self.root / "state")
        worker = threading.Thread(target=app.serve_forever, daemon=True)
        worker.start()
        self.assertTrue(app.started.wait(2))
        try:
            self.assertEqual(auto_update.run_auto_update_pass(app.manager, app.chart_cache),
                             {"enabled": False, "updated": 0})
        finally:
            app.manager.begin_exit()
            app.close()
            worker.join(3)

    def test_pass_updates_stale_and_skips_user_edits(self):
        app = portable.PortableApplication(self.root / "state")
        worker = threading.Thread(target=app.serve_forever, daemon=True)
        worker.start()
        self.assertTrue(app.started.wait(2))
        try:
            with app.manager.lock:
                app.manager.config = dict(app.manager.config, autoUpdateCharts=True)
            # catalog: song 1 has a new hash; song 2's local file was user-edited
            catalog = [make_song(1, "spinshare_a", "1" * 32), make_song(2, "spinshare_b", "9" * 32)]
            # seed the cache file so status() returns our rows (schema 1 legacy state)
            seed = {"schemaVersion": 1, "lastAttemptAt": None, "refreshError": None,
                    "data": catalog, "fetchedAt": 1788000000000}
            portable._atomic_write(app.chart_cache.path, portable._json_bytes(seed))
            app.chart_cache.state = None  # force a reload from the seeded file
            write_srtb(self.default_target, "spinshare_a", b"old-a")   # stale
            write_srtb(self.default_target, "spinshare_b", b"edited-b")  # user-modified
            import hashlib as _hashlib
            auto_update.save_baseline(app.store.directory, portable, {
                "spinshare_a": _hashlib.md5(b"old-a").hexdigest(),
                "spinshare_b": "0" * 32})
            submitted = []
            original_submit = app.manager.submit
            with mock.patch.object(app.manager, "submit", side_effect=lambda song_id, request_id, **kw:
                                   (submitted.append(song_id), original_submit(song_id, request_id, **kw))[1]):
                result = auto_update.run_auto_update_pass(app.manager, app.chart_cache)
            self.assertEqual(result["enabled"], True)
            self.assertEqual(submitted, [1], "stale chart reinstalled; user edit skipped")
            # the reinstall runs through the real queue; give it a moment
            for _ in range(50):
                if not app.manager.active_count():
                    break
                threading.Event().wait(0.1)
            baseline = auto_update.load_baseline(app.store.directory, portable)
            self.assertIn("spinshare_a", baseline)
        finally:
            app.manager.begin_exit()
            app.close()
            worker.join(3)

    def test_toggle_endpoint_persists(self):
        app = portable.PortableApplication(self.root / "state")
        worker = threading.Thread(target=app.serve_forever, daemon=True)
        worker.start()
        self.assertTrue(app.started.wait(2))
        try:
            import http.client
            def call(path, body):
                connection = http.client.HTTPConnection(portable.HOST, app.port, timeout=3)
                try:
                    connection.request("POST", path, body=json.dumps(body),
                                       headers={"Origin": app.origin, "Content-Type": "application/json",
                                                "X-SpinShare-Key": app.token})
                    response = connection.getresponse()
                    raw = response.read()
                    return response.status, json.loads(raw) if raw else None
                finally:
                    connection.close()
            self.assertEqual(call("/v1/auto-update", {})[0], 400)
            self.assertEqual(call("/v1/auto-update", {"enabled": "yes"})[0], 400)
            status, result = call("/v1/auto-update", {"enabled": True})
            self.assertEqual((status, result), (200, {"autoUpdateCharts": True}))
            self.assertEqual(app.bootstrap()["autoUpdateCharts"], True)
            status, result = call("/v1/auto-update", {"enabled": False})
            self.assertEqual((status, result), (200, {"autoUpdateCharts": False}))
            app.manager.begin_exit()
            status, result = call("/v1/auto-update", {"enabled": True})
            self.assertEqual((status, result["code"]), (409, "shutting_down"))
        finally:
            app.manager.begin_exit()
            app.close()
            worker.join(3)


if __name__ == "__main__":
    unittest.main()
