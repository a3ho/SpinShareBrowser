"""Persist and revision-bind the one-time chart directory confirmation."""
import http.client
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
import spinshare_portable as portable


class InstallDirectoryConfirmationTests(unittest.TestCase):
    def setUp(self):
        temporary_root = ROOT / ".qa" / "tmp"
        temporary_root.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix="directory-confirmation-", dir=temporary_root)
        self.root = Path(self.temporary.name)
        self.default_target = self.root / "Custom"
        self.default_target.mkdir()
        self.target_patch = mock.patch.object(
            portable.installer, "default_target_directory", return_value=self.default_target
        )
        self.target_patch.start()

    def tearDown(self):
        self.target_patch.stop()
        self.temporary.cleanup()

    def request(self, app, path, body, *, authenticated=True):
        headers = {"Origin": app.origin, "Content-Type": "application/json"}
        if authenticated:
            headers["X-SpinShare-Key"] = app.token
        connection = http.client.HTTPConnection(portable.HOST, app.port, timeout=3)
        try:
            connection.request("POST", path, body=json.dumps(body), headers=headers)
            response = connection.getresponse()
            raw = response.read()
            return response.status, json.loads(raw) if raw else None
        finally:
            connection.close()

    def test_legacy_config_migrates_false_and_rejects_non_boolean(self):
        store = portable.ConfigStore(self.root / "state")
        legacy = {
            "schemaVersion": 1,
            "token": "1" * 64,
            "customDirectory": None,
            "revision": "2" * 32,
            "language": "zh-CN",
            "closeBehavior": "ask",
            "trayNoticeShown": False,
            "playerShortcutHintShown": False,
            "windowSize": None,
        }
        store.path.write_bytes(portable._json_bytes(legacy))

        migrated = store.load()

        self.assertIs(migrated["installDirectoryConfirmed"], False)
        self.assertIs(json.loads(store.path.read_bytes())["installDirectoryConfirmed"], False)
        store.path.write_bytes(portable._json_bytes(dict(migrated, installDirectoryConfirmed=1)))
        with self.assertRaises(portable.PortableError):
            store.load()

    def test_confirmation_is_authenticated_strict_revision_bound_and_persistent(self):
        state = self.root / "state"
        app = portable.PortableApplication(state)
        worker = threading.Thread(target=app.serve_forever, daemon=True)
        worker.start()
        self.assertTrue(app.started.wait(2))
        try:
            revision = app.manager.revision
            self.assertIs(app.bootstrap()["installDirectoryConfirmed"], False)
            self.assertEqual(self.request(app, "/v1/install-directory-confirmation", {"expectedRevision": revision}, authenticated=False)[0], 403)
            self.assertEqual(self.request(app, "/v1/install-directory-confirmation", {})[0], 400)
            self.assertEqual(self.request(app, "/v1/install-directory-confirmation", {"expectedRevision": revision, "extra": True})[0], 400)
            status, stale = self.request(app, "/v1/install-directory-confirmation", {"expectedRevision": "0" * 32})
            self.assertEqual((status, stale["code"]), (409, "settings_changed"))
            self.assertIs(app.manager.config["installDirectoryConfirmed"], False)

            status, result = self.request(app, "/v1/install-directory-confirmation", {"expectedRevision": revision})
            self.assertEqual(status, 200)
            self.assertEqual(result, {
                "confirmed": True,
                "settingsRevision": revision,
                "targetDirectory": str(self.default_target),
            })
            self.assertIs(app.bootstrap()["installDirectoryConfirmed"], True)
            self.assertIs(app.manager.settings()["installDirectoryConfirmed"], True)
        finally:
            app.close()
            worker.join(3)
            self.assertFalse(worker.is_alive())

        self.assertIs(portable.ConfigStore(state).load()["installDirectoryConfirmed"], True)

    def test_install_submission_is_blocked_until_confirmation(self):
        store = portable.ConfigStore(self.root / "blocked-state")
        manager = portable.PortableManager(store, store.load())
        try:
            with self.assertRaises(portable.APIError) as rejected:
                manager.submit(7, "a" * 32, settings_revision=manager.revision)
            self.assertEqual((rejected.exception.status, rejected.exception.code),
                             (409, "directory_confirmation_required"))
            self.assertFalse(manager.jobs)
            manager.confirm_install_directory(manager.revision)
            self.assertIs(manager.config["installDirectoryConfirmed"], True)
        finally:
            self.assertTrue(manager.close_if_idle())
            self.assertTrue(manager.join(3))


if __name__ == "__main__":
    unittest.main()
