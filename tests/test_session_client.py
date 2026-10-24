"""Session channel contracts: DPAPI store, form driver parsing, queue, endpoints."""
import http.cookiejar
import http.server
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
import session_client
import spinshare_portable as portable


AUTHED_HOME = """<!doctype html><html><body><main><aside><nav class="items-right">
<div class="item item-notifications" tabindex="0"><i class="mdi mdi-bell"></i></div>
<div class="item item-user" tabindex="0">
  <div class="user-avatar"></div>
  <div class="user-actions">
    <a href="/user/42/charts" class="user-action-item"><span>My Charts</span></a>
    <a href="/user/42/playlists" class="user-action-item"><span>My Playlists</span></a>
    <a href="/user/42/reviews" class="user-action-item"><span>My Reviews</span></a>
  </div>
</div>
</nav></aside></main></body></html>"""

ANON_HOME = """<!doctype html><html><body><nav class="items-right">
<a href="/login" class="button">Login</a></nav></body></html>"""

LOGIN_PAGE = """<!doctype html><html><body><form action="/login" method="post">
<input type="text" id="username" name="_username" required>
<input type="password" id="password" name="_password" required>
<input type="hidden" name="_csrf_token" value="tok">
</form></body></html>"""

SONG_PAGE = """<!doctype html><html><body>
<form action="" method="POST" class="overlay-content">
<input type="checkbox" name="playlist_0" checked>
<input type="checkbox" name="playlist_1">
<input type="checkbox" name="playlist_2" checked>
<input type="submit" value="Save" name="submitPlaylist">
</form></body></html>"""

CREATE_PAGE = """<!doctype html><html><body><form name="playlist" method="post">
<input type="hidden" name="playlist[_token]" value="csrf-123">
<input type="text" name="playlist[title]" required>
<textarea name="playlist[description]"></textarea>
<select name="playlist[visibility]"><option value="public" selected>Public</option></select>
</form></body></html>"""


def make_cookie(name="PHPSESSID", value="abc123", domain="spinsha.re", path="/",
                expires=None, secure=False):
    dotted = domain.startswith(".")
    return http.cookiejar.Cookie(
        version=0, name=name, value=value, port=None, port_specified=False,
        domain=domain, domain_specified=dotted, domain_initial_dot=dotted,
        path=path, path_specified=True, secure=secure, expires=expires,
        discard=expires is None, comment=None, comment_url=None, rest={}, rfc2109=False)


class FakeSite(http.server.ThreadingHTTPServer):
    """Serves the pages the contract tests assert against."""

    def __init__(self, *, home=AUTHED_HOME, user_api='{"version":1,"status":200,"data":{"id":42,"username":"tester"}}'):
        self.site_home = home
        self.user_api = user_api
        self.seen = []
        super().__init__(("127.0.0.1", 0), Handler)
        self.daemon_threads = True

    @property
    def origin(self):
        return "http://127.0.0.1:" + str(self.server_address[1])


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _record(self):
        self.server.seen.append({"method": self.command, "path": self.path,
                                 "cookie": self.headers.get("Cookie", ""),
                                 "content_type": self.headers.get("Content-Type", ""),
                                 "user_agent": self.headers.get("User-Agent", ""),
                                 "body": self.rfile.read(int(self.headers.get("Content-Length", 0) or 0))})

    def _html(self, body, status=200):
        payload = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        if status == 302:
            self.send_header("Location", "/login")
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        self._record()
        if self.path == "/":
            self._html(self.server.site_home)
        elif self.path.startswith("/api/user/"):
            payload = self.server.user_api.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        elif self.path == "/bounce":
            self._html("", status=302)
        else:
            self._html(ANON_HOME)

    def do_POST(self):
        self._record()
        self._html(AUTHED_HOME)


class DpapiStoreTests(unittest.TestCase):
    def setUp(self):
        temporary_root = ROOT / ".qa" / "tmp"
        temporary_root.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix="session-store-", dir=temporary_root)
        self.state = Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def test_dpapi_roundtrip_and_garbage_rejection(self):
        secret = "session-data-写到文件里必须可解回".encode("utf-8")
        protected = session_client.protect_bytes(secret)
        self.assertNotIn(secret, protected)
        self.assertEqual(session_client.unprotect_bytes(protected), secret)
        with self.assertRaises(session_client.SessionError):
            session_client.unprotect_bytes(b"not-dpapi-at-all")
        with self.assertRaises(session_client.SessionError):
            session_client.protect_bytes("text")

    def test_store_save_load_roundtrip_and_corruption_tolerance(self):
        store = session_client.SessionStore(self.state)
        self.assertIsNone(store.load())
        state = {"schemaVersion": 1,
                 "identity": {"userId": 42, "username": "tester", "userAgent": "UA"},
                 "cookies": [session_client.cookie_to_record(make_cookie())]}
        store.save(state)
        self.assertEqual(store.load()["identity"]["username"], "tester")
        # No cookie values leak into the raw file.
        raw = store.path.read_bytes()
        self.assertNotIn(b"abc123", raw)
        self.assertGreater(len(raw), 100)
        store.path.write_bytes(b"corrupted")
        self.assertIsNone(store.load())
        store.path.write_bytes(session_client.protect_bytes(b'{"schemaVersion":9}'))
        self.assertIsNone(store.load())
        store.clear()
        self.assertIsNone(store.load())

    def test_store_rejects_invalid_state(self):
        store = session_client.SessionStore(self.state)
        for invalid in (
            {"schemaVersion": 2, "identity": {"userId": 1, "username": "a", "userAgent": "u"}, "cookies": []},
            {"schemaVersion": 1, "identity": {"userId": 0, "username": "a", "userAgent": "u"}, "cookies": []},
            {"schemaVersion": 1, "identity": {"userId": 1, "username": "", "userAgent": "u"}, "cookies": []},
        ):
            with self.assertRaises(session_client.SessionError):
                store.save(dict(invalid, cookies=[session_client.cookie_to_record(make_cookie())]))

    def test_cookie_record_roundtrip(self):
        cookie = make_cookie(expires=1893456000, secure=True)
        record = session_client.cookie_to_record(cookie)
        restored = session_client.record_to_cookie(record)
        self.assertEqual((restored.name, restored.value, restored.domain, restored.path,
                          restored.expires, restored.secure),
                         (cookie.name, cookie.value, cookie.domain, cookie.path,
                          cookie.expires, cookie.secure))


class ParserTests(unittest.TestCase):
    def test_csrf_token_extraction(self):
        # Symfony's createFormBuilder renders form[_token]; the wiki-style
        # playlist form uses the entity name as the block prefix.
        html = '<form><input type="hidden" name="form[_token]" value="tok-9"></form>'
        self.assertEqual(session_client.parse_csrf_token(html), "tok-9")
        self.assertEqual(session_client.parse_csrf_token(CREATE_PAGE.replace("playlist[", "form[")), "csrf-123")
        self.assertIsNone(session_client.parse_csrf_token("<form></form>"))

    def test_checkbox_index_parsing(self):
        indexes = session_client.parse_checkbox_indexes(SONG_PAGE)
        self.assertEqual(indexes, {0: True, 1: False, 2: True})
        self.assertEqual(session_client.parse_checkbox_indexes(LOGIN_PAGE), {})

    def test_login_page_detection(self):
        self.assertTrue(session_client.looks_like_login_page("https://spinsha.re/login", ANON_HOME))
        self.assertTrue(session_client.looks_like_login_page("https://spinsha.re/", LOGIN_PAGE))
        self.assertFalse(session_client.looks_like_login_page("https://spinsha.re/", AUTHED_HOME))

    def test_signed_in_identity_parsing(self):
        self.assertEqual(session_client.parse_signed_in_user_id(AUTHED_HOME), 42)
        self.assertIsNone(session_client.parse_signed_in_user_id(ANON_HOME))
        # A user link outside the user-actions block does not count.
        self.assertIsNone(session_client.parse_signed_in_user_id(
            '<a href="/user/7/charts">charts</a>' + AUTHED_HOME.replace("user-actions", "user-actions-x")))


class WebClientTests(unittest.TestCase):
    def setUp(self):
        self.site = FakeSite()
        self.thread = threading.Thread(target=self.site.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.site.shutdown()
        self.site.server_close()
        self.thread.join(3)

    def client(self):
        return session_client.SpinShareWeb([make_cookie(domain="127.0.0.1")], "TestUA/1.0")

    def test_get_sends_cookies_and_user_agent(self):
        url, html = self.client().get(self.site.origin + "/")
        self.assertEqual(url, self.site.origin + "/")
        self.assertIn("user-actions", html)
        request = self.site.seen[-1]
        self.assertIn("PHPSESSID=abc123", request["cookie"])
        self.assertEqual(request["user_agent"], "TestUA/1.0")

    def test_post_form_and_multipart(self):
        client = self.client()
        url, html = client.post_form(self.site.origin + "/", {"submitPlaylist": "1", "playlist_0": "on"})
        self.assertIn("user-actions", html)
        request = self.site.seen[-1]
        self.assertTrue(request["content_type"].startswith("application/x-www-form-urlencoded"))
        self.assertIn(b"playlist_0=on", request["body"])

        body, content_type = session_client.encode_multipart(
            {"form[title]": "My List"}, [("form[coverPath]", "cover.png", b"\x89PNG", "image/png")],
            "BOUNDARY")
        self.assertEqual(content_type, "multipart/form-data; boundary=BOUNDARY")
        self.assertIn(b'name="form[title]"', body)
        self.assertIn(b'filename="cover.png"', body)
        self.assertIn(b"\x89PNG", body)
        url, _ = client.post_multipart(self.site.origin + "/", {"form[title]": "My List"},
                                       [("form[coverPath]", "cover.png", b"\x89PNG", "image/png")])
        request = self.site.seen[-1]
        self.assertTrue(request["content_type"].startswith("multipart/form-data; boundary="))
        self.assertIn(b"form[coverPath]", request["body"])

    def test_redirect_to_login_is_detected_as_expired(self):
        client = self.client()
        url, _ = client.get(self.site.origin + "/bounce")
        self.assertTrue(url.startswith(self.site.origin + "/") or "/login" in url)
        with self.assertRaises(session_client.SessionExpired):
            client.ensure_not_login(url, ANON_HOME)
        client.ensure_not_login(self.site.origin + "/", AUTHED_HOME)

    def test_unreachable_origin_raises_web_error(self):
        with self.assertRaises(session_client.WebError):
            self.client().get("http://127.0.0.1:9/")


class QueueTests(unittest.TestCase):
    def test_serial_order_spacing_and_no_retry(self):
        queue = session_client.WriteQueue(minimum_gap=0.05)
        order = []
        calls = []

        def make(label, fail=False):
            def operation():
                calls.append(label)
                order.append(label)
                if fail:
                    raise session_client.SessionError("boom")
                return label
            return operation

        self.assertEqual(queue.submit(make("a")), "a")
        with self.assertRaises(session_client.SessionError):
            queue.submit(make("b", fail=True))
        self.assertEqual(queue.submit(make("c")), "c")
        self.assertEqual(order, ["a", "b", "c"])
        # Failed operations are not retried anywhere.
        self.assertEqual(calls, ["a", "b", "c"])

    def test_spacing_is_enforced_between_operations(self):
        queue = session_client.WriteQueue(minimum_gap=0.25)
        start = time.monotonic()
        queue.submit(lambda: None)
        queue.submit(lambda: None)
        queue.submit(lambda: None)
        self.assertGreaterEqual(time.monotonic() - start, 0.5)


class ModuleStateTests(unittest.TestCase):
    def setUp(self):
        temporary_root = ROOT / ".qa" / "tmp"
        temporary_root.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix="session-state-", dir=temporary_root)
        self.state = Path(self.temporary.name)
        session_client.initialize(self.state)
        session_client.set_login_window_opener(None)
        session_client.cancel_login()
        session_client.disconnect()

    def tearDown(self):
        session_client.set_login_window_opener(None)
        session_client.cancel_login()
        session_client.disconnect()
        self.temporary.cleanup()

    def test_login_gate_errors(self):
        with self.assertRaises(session_client.SessionError) as caught:
            session_client.request_login()
        self.assertEqual(str(caught.exception), "session_window_unavailable")

        opened = []
        session_client.set_login_window_opener(lambda: opened.append(True))
        session_client.request_login()
        self.assertEqual(opened, [True])
        self.assertTrue(session_client.status_summary()["loginActive"])
        with self.assertRaises(session_client.SessionError) as caught:
            session_client.request_login()
        self.assertEqual(str(caught.exception), "session_login_busy")
        session_client.cancel_login()
        self.assertFalse(session_client.status_summary()["loginActive"])

    def test_complete_login_and_disconnect(self):
        site = FakeSite()
        thread = threading.Thread(target=site.serve_forever, daemon=True)
        thread.start()
        try:
            session_client.set_login_window_opener(lambda: None)
            session_client.request_login()
            self.assertTrue(session_client.complete_login(
                [make_cookie(domain="127.0.0.1"), make_cookie(name="other", domain="example.com")],
                "UA", origin=site.origin, cookie_domain="127.0.0.1"))
            summary = session_client.status_summary()
            self.assertEqual(summary, {"connected": True, "username": "tester",
                                       "userId": 42, "loginActive": False})
            # The web client replays the stored cookies and user agent.
            client = session_client.web_client()
            url, html = client.get(site.origin + "/")
            self.assertIn("user-actions", html)
            self.assertEqual(site.seen[-1]["user_agent"], "UA")
            session_client.disconnect()
            self.assertFalse(session_client.status_summary()["connected"])
            with self.assertRaises(session_client.NotConnected):
                session_client.web_client()
        finally:
            site.shutdown()
            site.server_close()
            thread.join(3)

    def test_complete_login_rejects_anonymous_and_login_pages(self):
        for home in (ANON_HOME, LOGIN_PAGE):
            site = FakeSite(home=home)
            thread = threading.Thread(target=site.serve_forever, daemon=True)
            thread.start()
            try:
                self.assertFalse(session_client.complete_login(
                    [make_cookie(domain="127.0.0.1")], "UA", origin=site.origin,
                    cookie_domain="127.0.0.1"))
                self.assertFalse(session_client.status_summary()["connected"])
            finally:
                site.shutdown()
                site.server_close()
                thread.join(3)


class EndpointTests(unittest.TestCase):
    def setUp(self):
        temporary_root = ROOT / ".qa" / "tmp"
        temporary_root.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix="session-api-", dir=temporary_root)
        self.root = Path(self.temporary.name)
        self.default_target = self.root / "Custom"
        self.default_target.mkdir()
        self.target_patch = mock.patch.object(
            portable.installer, "default_target_directory", return_value=self.default_target)
        self.target_patch.start()
        session_client.set_login_window_opener(None)
        session_client.cancel_login()
        session_client.disconnect()

    def tearDown(self):
        self.target_patch.stop()
        session_client.set_login_window_opener(None)
        session_client.disconnect()
        self.temporary.cleanup()

    def request(self, app, method, path, body=None, *, authenticated=True):
        headers = {"Origin": app.origin}
        if body is not None:
            headers["Content-Type"] = "application/json"
        if authenticated:
            headers["X-SpinShare-Key"] = app.token
        connection = http.client.HTTPConnection(portable.HOST, app.port, timeout=3)
        try:
            connection.request(method, path, body=json.dumps(body) if body is not None else None,
                               headers=headers)
            response = connection.getresponse()
            raw = response.read()
            return response.status, json.loads(raw) if raw else None
        finally:
            connection.close()

    def test_session_endpoints_are_gated_and_wired(self):
        app = portable.PortableApplication(self.root / "state")
        worker = threading.Thread(target=app.serve_forever, daemon=True)
        worker.start()
        self.assertTrue(app.started.wait(2))
        try:
            self.assertEqual(app.bootstrap()["session"], {"connected": False, "username": None,
                                                          "userId": None, "loginActive": False})
            self.assertEqual(self.request(app, "GET", "/v1/session/status", authenticated=False)[0], 403)
            status, summary = self.request(app, "GET", "/v1/session/status")
            self.assertEqual((status, summary["connected"]), (200, False))

            status, result = self.request(app, "POST", "/v1/session/login", {})
            self.assertEqual((status, result["code"]), (409, "session_window_unavailable"))

            session_client.set_login_window_opener(lambda: None)
            status, result = self.request(app, "POST", "/v1/session/login", {})
            self.assertEqual((status, result), (202, {"accepted": True}))
            status, summary = self.request(app, "GET", "/v1/session/status")
            self.assertTrue(summary["loginActive"])

            status, result = self.request(app, "POST", "/v1/session/login", {"x": 1})
            self.assertEqual(status, 400)
            status, result = self.request(app, "POST", "/v1/session/logout", {})
            self.assertEqual((status, result), (200, {"connected": False}))

            app.manager.begin_exit()
            status, result = self.request(app, "POST", "/v1/session/login", {})
            self.assertEqual((status, result["code"]), (409, "shutting_down"))
        finally:
            app.manager.begin_exit()
            app.close()
            worker.join(3)


if __name__ == "__main__":
    unittest.main()
