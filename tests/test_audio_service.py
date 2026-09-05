"""Local audio is authenticated, read-only, seekable, and independent of installs."""
import http.client
import json
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
import spinshare_portable as portable


class AudioServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="spinshare-audio-")
        self.root = Path(self.temp.name).resolve()
        self.target = self.root / "Custom"
        self.target.mkdir()
        self.audio = self.root / "game.ogg"
        self.payload = b"OggS" + bytes(range(256)) * 512
        self.audio.write_bytes(self.payload)
        self.target_patch = mock.patch.object(portable.installer, "default_target_directory", return_value=self.target)
        self.target_patch.start()
        self.app = portable.PortableApplication(self.root / "state")
        self.worker = threading.Thread(target=self.app.serve_forever, daemon=True)
        self.worker.start()
        self.assertTrue(self.app.started.wait(2))

    def tearDown(self):
        self.app.close()
        self.worker.join(3)
        self.target_patch.stop()
        self.temp.cleanup()

    def request(self, method, path, data=None, *, media=False, headers=None, authenticated=True):
        base = {"Origin": self.app.origin, "Content-Type": "application/json"}
        if authenticated:
            base["X-SpinShare-Key"] = self.app.token
        if media:
            base = {"Sec-Fetch-Site": "same-origin", "Sec-Fetch-Mode": "no-cors", "Sec-Fetch-Dest": "audio"}
        base.update(headers or {})
        connection = http.client.HTTPConnection(portable.HOST, self.app.port, timeout=3)
        try:
            connection.request(method, path, body=json.dumps(data) if data is not None else None, headers=base)
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def resolve(self, reference="spinshare_ab12", update_hash="a" * 32):
        status, _, body = self.request("POST", "/v1/preview/resolve", {"fileReference": reference, "updateHash": update_hash})
        return status, json.loads(body)

    def test_resolution_is_authenticated_strict_and_never_exposes_paths(self):
        with mock.patch.object(portable.audio_preview, "resolve_preview", return_value=self.audio) as resolve:
            for value in [None, 12, "../file", "spinshare_", "spinshare_ab/ff"]:
                self.assertEqual(self.resolve(value)[0], 400)
            self.assertEqual(self.request("POST", "/v1/preview/resolve", {"fileReference": "spinshare_ab"}, authenticated=False)[0], 403)
            self.assertEqual(self.request("POST", "/v1/preview/resolve", {"fileReference": "spinshare_ab", "path": str(self.audio)})[0], 400)
            resolve.assert_not_called()
            status, result = self.resolve()
            self.assertEqual(status, 200)
            self.assertRegex(result["url"], r"^/v1/preview/audio/[a-f0-9]{48}$")
            self.assertNotIn(str(self.root), json.dumps(result))
            self.assertEqual(self.resolve()[1], result)
            resolve.assert_called_once_with("spinshare_ab12", self.target)
            self.assertNotEqual(self.resolve(update_hash="b" * 32)[1], result, "A chart update must resolve its current music")
            self.assertNotEqual(self.resolve(update_hash="")[1], self.resolve(update_hash="")[1], "Without a version, do not reuse metadata")
            self.assertFalse(self.app.manager.jobs)
            self.assertEqual(list(self.target.iterdir()), [])

    def test_media_stream_and_ranges_are_exact_and_read_only(self):
        with mock.patch.object(portable.audio_preview, "resolve_preview", return_value=self.audio):
            path = self.resolve()[1]["url"]
        for value, expected in [(None, self.payload), ("bytes=0-3", b"OggS"), ("bytes=4-", self.payload[4:]),
                                ("bytes=-8", self.payload[-8:]), ("bytes=4-999999", self.payload[4:])]:
            status, headers, body = self.request("GET", path, media=True, headers={"Range": value} if value else {})
            self.assertEqual(status, 206 if value else 200)
            self.assertEqual(body, expected)
            self.assertEqual(headers["Content-Type"], "audio/ogg")
            self.assertEqual(headers["Accept-Ranges"], "bytes")
            self.assertEqual(int(headers["Content-Length"]), len(expected))
            self.assertEqual(headers["Cache-Control"], "no-store")
        status, headers, body = self.request("HEAD", path, media=True)
        self.assertEqual((status, body), (200, b""))
        self.assertEqual(int(headers["Content-Length"]), len(self.payload))
        for value in ["bytes=-0", "bytes=-", "bytes=999999-", "bytes=4-2", "bytes=0-1,3-4", "other=1-2"]:
            self.assertEqual(self.request("GET", path, media=True, headers={"Range": value})[0], 416)
        self.assertEqual(self.audio.read_bytes(), self.payload)

    def test_media_rejects_other_sites_unknown_tokens_changed_and_expired_files(self):
        with mock.patch.object(portable.audio_preview, "resolve_preview", return_value=self.audio):
            path = self.resolve()[1]["url"]
        for headers in [{"Sec-Fetch-Site": "cross-site"}, {"Origin": "https://example.com"}, {"Host": "localhost:" + str(self.app.port)}]:
            self.assertEqual(self.request("GET", path, media=True, headers=headers)[0], 403)
        self.assertEqual(self.request("GET", "/v1/preview/audio/" + "0" * 48, media=True)[0], 404)
        self.assertEqual(self.request("GET", path + "?path=secret", media=True)[0], 403)
        self.audio.write_bytes(b"OggSchanged")
        self.assertEqual(self.request("GET", path, media=True)[0], 404)
        key = path.rsplit("/", 1)[-1]
        entry = self.app.manager.preview_sources[key]
        self.app.manager.preview_sources[key] = (*entry[:4], time.monotonic() - 1)
        self.assertEqual(self.request("GET", path, media=True)[0], 404)

    def test_lookup_does_not_hold_install_lock_and_busy_is_bounded(self):
        entered, finish = threading.Event(), threading.Event()
        def slow(*args):
            entered.set()
            finish.wait(3)
            return self.audio
        with mock.patch.object(portable.audio_preview, "resolve_preview", side_effect=slow):
            resolver = threading.Thread(target=self.resolve)
            resolver.start()
            try:
                self.assertTrue(entered.wait(2))
                self.assertEqual(self.request("GET", "/v1/health")[0], 200)
                self.assertEqual(self.request("GET", "/v1/activity")[0], 200)
                self.assertTrue(self.app.manager.preview_resolvers.acquire(blocking=False))
                try:
                    self.assertEqual(self.resolve("spinshare_cd")[0], 429)
                finally:
                    self.app.manager.preview_resolvers.release()
            finally:
                finish.set()
                resolver.join(3)

    def test_classified_failures_and_shutdown_do_not_issue_media_access(self):
        for code, status in [("game_audio_not_found", 404), ("preview_unavailable", 404), ("preview_lookup_failed", 502)]:
            with mock.patch.object(portable.audio_preview, "resolve_preview", side_effect=portable.audio_preview.PreviewError(code, "Audio unavailable")):
                actual, body = self.resolve()
                self.assertEqual((actual, body["code"]), (status, code))
        self.assertEqual(self.app.manager.preview_sources, {})
        self.app.manager.begin_exit()
        self.assertEqual(self.resolve()[0], 409)


if __name__ == "__main__":
    unittest.main()
