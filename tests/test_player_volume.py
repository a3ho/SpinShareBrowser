"""Persist the header-player volume through config.json and /v1/player-volume."""
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
import maintenance
import spinshare_portable as portable


class PlayerVolumeTests(unittest.TestCase):
    def setUp(self):
        temporary_root = ROOT / ".qa" / "tmp"
        temporary_root.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix="player-volume-", dir=temporary_root)
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

    def legacy_config(self, **extra):
        config = {
            "schemaVersion": 1,
            "token": "1" * 64,
            "customDirectory": None,
            "revision": "2" * 32,
            "language": "zh-CN",
            "closeBehavior": "ask",
            "trayNoticeShown": False,
            "playerShortcutHintShown": False,
            "installDirectoryConfirmed": False,
            "windowSize": None,
        }
        return dict(config, **extra)

    def test_legacy_config_migrates_default_and_rejects_invalid_volumes(self):
        store = portable.ConfigStore(self.root / "state")
        store.path.write_bytes(portable._json_bytes(self.legacy_config()))
        migrated = store.load()
        self.assertEqual(migrated["playerVolume"], 1.0)
        self.assertEqual(json.loads(store.path.read_bytes())["playerVolume"], 1.0)
        for invalid in (-0.01, 1.01, True, "0.5", None):
            store.path.write_bytes(portable._json_bytes(self.legacy_config(playerVolume=invalid)))
            with self.assertRaises(portable.PortableError):
                store.load()

    def test_maintenance_parser_accepts_legacy_and_rejects_invalid_volume(self):
        self.assertNotIn("playerVolume", maintenance._parse_config(portable._json_bytes(self.legacy_config())))
        self.assertEqual(
            maintenance._parse_config(portable._json_bytes(self.legacy_config(playerVolume=0.35)))["playerVolume"], 0.35)
        for invalid in (2, True, "loud"):
            with self.assertRaises(maintenance.MaintenanceError):
                maintenance._parse_config(portable._json_bytes(self.legacy_config(playerVolume=invalid)))

    def test_volume_endpoint_is_authenticated_validated_and_persistent(self):
        state = self.root / "state"
        app = portable.PortableApplication(state)
        worker = threading.Thread(target=app.serve_forever, daemon=True)
        worker.start()
        self.assertTrue(app.started.wait(2))
        try:
            self.assertEqual(app.bootstrap()["playerVolume"], 1.0)
            self.assertEqual(self.request(app, "/v1/player-volume", {"volume": 0.5}, authenticated=False)[0], 403)
            self.assertEqual(self.request(app, "/v1/player-volume", {})[0], 400)
            self.assertEqual(self.request(app, "/v1/player-volume", {"volume": 0.5, "extra": 1})[0], 400)
            for invalid in (1.5, -1, True, "0.2"):
                status, result = self.request(app, "/v1/player-volume", {"volume": invalid})
                self.assertEqual((status, result["code"]), (400, "invalid_player_volume"))
            self.assertEqual(app.manager.config["playerVolume"], 1.0)

            status, result = self.request(app, "/v1/player-volume", {"volume": 0.35})
            self.assertEqual((status, result), (200, {"volume": 0.35}))
            self.assertEqual(app.manager.config["playerVolume"], 0.35)
            self.assertEqual(app.bootstrap()["playerVolume"], 0.35)

            # Integer bounds are accepted and normalized to float.
            self.assertEqual(self.request(app, "/v1/player-volume", {"volume": 0})[1], {"volume": 0.0})
            self.assertEqual(self.request(app, "/v1/player-volume", {"volume": 1})[1], {"volume": 1.0})

            app.manager.begin_exit()
            status, result = self.request(app, "/v1/player-volume", {"volume": 0.6})
            self.assertEqual((status, result["code"]), (409, "shutting_down"))
            self.assertEqual(app.manager.config["playerVolume"], 1.0)
        finally:
            app.manager.begin_exit()
            app.close()
            worker.join(3)
            self.assertFalse(worker.is_alive())

        self.assertEqual(portable.ConfigStore(state).load()["playerVolume"], 1.0)


if __name__ == "__main__":
    unittest.main()
