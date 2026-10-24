"""Upload channel contracts against a stateful fake spinsha.re."""
import http.cookiejar
import http.server
import json
from pathlib import Path
import re
import sys
import tempfile
import threading
import unittest
import urllib.parse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
import session_client
import upload


class FakeUploadSite(http.server.ThreadingHTTPServer):
    def __init__(self):
        self.my_charts = {9646, 7470}
        self.next_song_id = 16000
        self.uploads = []  # (song_id, fields, had_zip)
        self.expire_session = False
        super().__init__(("127.0.0.1", 0), FakeUploadHandler)
        self.daemon_threads = True

    @property
    def origin(self):
        return "http://127.0.0.1:" + str(self.server_address[1])


def upload_form():
    return ('<form name="form" method="post" enctype="multipart/form-data">'
            '<input type="file" name="form[backupPath]" required="required" accept=".zip">'
            '<input type="text" name="form[tags]">'
            '<textarea name="form[description]"></textarea>'
            '<select name="form[dlc]"><option value="0">None</option>'
            '<option value="1">Supporter Pack</option></select>'
            '<select name="form[publicationStatus]"><option value="0">Public</option>'
            '<option value="1">Hide from lists</option><option value="2">Unlisted</option></select>'
            '<input type="checkbox" name="form[isExplicit]" value="1">'
            '<button type="submit" name="form[save]">'
            '<input type="hidden" name="form[_token]" value="tok-1"></form>')


class FakeUploadHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, payload, status=200, location=None, content_type="text/html; charset=utf-8"):
        if isinstance(payload, str):
            payload = payload.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        if location:
            self.send_header("Location", location)
        self.end_headers()
        self.wfile.write(payload)

    def _login(self):
        self._send('<form action="/login" method="post"><input type="text" id="username" name="_username"></form>')

    def _charts_envelope(self, site):
        return json.dumps({"version": 1, "status": 200,
                           "data": [{"id": cid} for cid in sorted(site.my_charts)]})

    def do_GET(self):
        site = self.server
        path = urllib.parse.urlparse(self.path).path
        if site.expire_session:
            return self._login()
        if path == "/api/user/42/charts":
            return self._send(self._charts_envelope(site), content_type="application/json")
        if path == "/upload":
            return self._send(upload_form())
        match = re.fullmatch(r"/song/(\d+)/update", path)
        if match:
            return self._send(upload_form().replace('required="required"', ""))
        match = re.fullmatch(r"/song/(\d+)/delete", path)
        if match:
            site.my_charts.discard(int(match.group(1)))
            return self._send("<html>deleted</html>", status=302, location="/user/42/charts")
        self._send("<html>ok</html>")

    def do_POST(self):
        site = self.server
        body = self.rfile.read(int(self.headers.get("Content-Length", 0) or 0))
        parsed = urllib.parse.urlparse(self.path)
        if site.expire_session:
            return self._login()
        if parsed.path == "/upload":
            had_zip = b'name="form[backupPath]"; filename="' in body
            has_token = b'name="form[_token]"' in body
            if not (had_zip and has_token):
                return self._send(upload_form())  # validation failure re-renders
            site.next_song_id += 1
            site.my_charts.add(site.next_song_id)
            site.uploads.append((site.next_song_id, body, True))
            return self._send("<html>created</html>", status=302,
                              location="/song/%d" % site.next_song_id)
        match = re.fullmatch(r"/song/(\d+)/update", parsed.path)
        if match:
            song_id = int(match.group(1))
            if song_id not in site.my_charts:
                return self._send(upload_form())
            site.uploads.append((song_id, body, b'filename="' in body))
            return self._send("<html>updated</html>", status=302, location="/song/%d" % song_id)
        self._send("<html>ok</html>")


def make_cookie():
    return http.cookiejar.Cookie(
        version=0, name="PHPSESSID", value="abc", port=None, port_specified=False,
        domain="127.0.0.1", domain_specified=False, domain_initial_dot=False,
        path="/", path_specified=True, secure=False, expires=None, discard=True,
        comment=None, comment_url=None, rest={}, rfc2109=False)


class UploadTests(unittest.TestCase):
    def setUp(self):
        temporary_root = ROOT / ".qa" / "tmp"
        temporary_root.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix="upload-", dir=temporary_root)
        self.state = Path(self.temporary.name)
        session_client.initialize(self.state)
        session_client.SessionStore(self.state).save({
            "schemaVersion": 1,
            "identity": {"userId": 42, "username": "tester", "userAgent": "UA", "connectedAt": "x"},
            "cookies": [session_client.cookie_to_record(make_cookie())]})
        self.site = FakeUploadSite()
        self.thread = threading.Thread(target=self.site.serve_forever, daemon=True)
        self.thread.start()
        self._origin = upload.SITE
        upload.SITE = self.site.origin
        session_client._write_queue = session_client.WriteQueue(minimum_gap=0.0)
        self.zip_path = self.state / "backup.zip"
        self.zip_path.write_bytes(b"PK\x03\x04 fake zip bytes")

    def tearDown(self):
        upload.SITE = self._origin
        self.site.shutdown()
        self.site.server_close()
        self.thread.join(3)
        session_client.disconnect()
        self.temporary.cleanup()

    def test_options_parse_dlc_and_publication(self):
        options = upload.upload_options()
        self.assertEqual(options["dlc"], [{"value": 0, "label": "None"}, {"value": 1, "label": "Supporter Pack"}])
        self.assertEqual([entry["value"] for entry in options["publication"]], [0, 1, 2])

    def test_upload_posts_multipart_with_zip_and_verifies_by_diff(self):
        result = upload.upload_chart(str(self.zip_path), "desc", "jcore", 0, 0, False)
        self.assertEqual(result["songId"], self.site.next_song_id)
        self.assertEqual(len(self.site.uploads), 1)
        body = self.site.uploads[0][1]
        self.assertIn(b'name="form[backupPath]"; filename="backup.zip"', body)
        self.assertIn(b"PK\x03\x04 fake zip bytes", body, "the zip bytes stream into the multipart body")
        self.assertIn(b'name="form[dlc]"\r\n\r\n0', body)
        self.assertIn(b'name="form[publicationStatus]"\r\n\r\n0', body)
        self.assertIn(b'name="form[save]"', body)
        self.assertIn(b'name="form[_token]"', body)

    def test_upload_rejects_bad_local_files(self):
        missing = self.state / "missing.zip"
        for bad in (str(missing), str(self.state), ""):
            with self.assertRaises(upload.UploadError):
                upload.upload_chart(bad, "", "", 0, 0, False)
        not_zip = self.state / "backup.txt"
        not_zip.write_bytes(b"x")
        with self.assertRaises(upload.UploadError):
            upload.upload_chart(str(not_zip), "", "", 0, 0, False)
        self.assertEqual(self.site.uploads, [])

    def test_upload_rejects_invalid_fields(self):
        with self.assertRaises(upload.UploadError):
            upload.upload_chart(str(self.zip_path), "", "", 9, 0, False)
        with self.assertRaises(upload.UploadError):
            upload.upload_chart(str(self.zip_path), "", "", 0, 7, False)
        self.assertEqual(self.site.uploads, [])

    def test_update_own_chart_without_zip(self):
        result = upload.update_chart(9646, "new desc", "tag", 1, 2, True)
        self.assertEqual(result, {"songId": 9646})
        self.assertEqual(len(self.site.uploads), 1)
        self.assertFalse(self.site.uploads[0][2], "update sends no zip part")
        body = self.site.uploads[0][1]
        self.assertIn(b'name="form[isExplicit]"\r\n\r\n1', body)
        self.assertIn(b'name="form[dlc]"\r\n\r\n1', body)
        self.assertIn(b'name="form[publicationStatus]"\r\n\r\n2', body)

    def test_update_rejects_foreign_chart(self):
        with self.assertRaises(upload.UploadError):
            upload.update_chart(15188, "", "", 0, 0, False)
        self.assertEqual(self.site.uploads, [])

    def test_delete_own_chart_verifies(self):
        upload.delete_chart(7470)
        self.assertNotIn(7470, self.site.my_charts)
        with self.assertRaises(upload.UploadError):
            upload.delete_chart(15188)

    def test_expired_session_surfaces(self):
        self.site.expire_session = True
        with self.assertRaises(session_client.SessionExpired):
            upload.upload_chart(str(self.zip_path), "", "", 0, 0, False)


if __name__ == "__main__":
    unittest.main()
