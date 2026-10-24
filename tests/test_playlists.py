"""Playlist channel contracts against a stateful fake spinsha.re.

The fake reproduces the production behaviors verified on 2026-10-24:
multipart create with a mandatory cover (silently re-renders without one),
CSRF form tokens, immediate deletes, and the replace-set membership POST whose
checkbox names are positions in the user's playlist order.
"""
import http.cookiejar
import http.server
import json
from pathlib import Path
import re
import sys
import tempfile
import threading
import unittest
from unittest import mock
import urllib.parse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
import playlists
import session_client
import spinshare_portable as portable


class FakePlaylistSite(http.server.ThreadingHTTPServer):
    def __init__(self):
        self.next_playlist_id = 900
        self.playlists = []  # [{id,title,description,songs:set}]
        self.requests = []
        self.expire_session = False
        super().__init__(("127.0.0.1", 0), FakePlaylistHandler)
        self.daemon_threads = True

    @property
    def origin(self):
        return "http://127.0.0.1:" + str(self.server_address[1])

    def envelope(self, data, status=200):
        return json.dumps({"version": 1, "status": status, "data": data})


class FakePlaylistHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _body(self):
        return self.rfile.read(int(self.headers.get("Content-Length", 0) or 0))

    def _send(self, payload, status=200, content_type="text/html; charset=utf-8", location=None):
        if isinstance(payload, str):
            payload = payload.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        if location:
            self.send_header("Location", location)
        self.end_headers()
        self.wfile.write(payload)

    def _login_page(self):
        self._send('<form action="/login" method="post"><input type="text" id="username" name="_username"></form>')

    def _expired(self):
        return self.server.expire_session

    def do_GET(self):
        site = self.server
        site.requests.append(("GET", self.path))
        path = urllib.parse.urlparse(self.path).path
        # Public API endpoints ignore the session; only form flows need it.
        form_flow = path.startswith("/playlist") or re.fullmatch(r"/song/\d+", path)
        if self._expired() and form_flow:
            return self._login_page()
        if path == "/api/user/42/playlists":
            # Production returns the newest playlist first — the reverse of the
            # song-page checkbox order. This trap is the reason membership is
            # mapped through titles.
            return self._send(site.envelope([
                {"id": entry["id"], "title": entry["title"], "description": entry["description"],
                 "songs": len(entry["songs"]), "cover": "https://x/cover%d.png" % entry["id"]}
                for entry in reversed(site.playlists)]), content_type="application/json")
        match = re.fullmatch(r"/api/playlist/(\d+)", path)
        if match:
            entry = next((e for e in site.playlists if e["id"] == int(match.group(1))), None)
            if entry is None:
                return self._send(site.envelope([], status=404), content_type="application/json")
            return self._send(site.envelope({
                "id": entry["id"], "title": entry["title"], "description": entry["description"],
                "songs": [{"id": song_id, "title": "song%d" % song_id} for song_id in sorted(entry["songs"])]}),
                content_type="application/json")
        if path == "/playlist/create":
            return self._send('<form name="form" method="post" enctype="multipart/form-data">'
                              '<input type="text" name="form[title]">'
                              '<textarea name="form[description]"></textarea>'
                              '<input type="file" name="form[coverPath]" required="required">'
                              '<button type="submit" name="form[save]">'
                              '<input type="hidden" name="form[_token]" value="tok-1"></form>')
        match = re.fullmatch(r"/song/(\d+)", path)
        if match:
            song_id = int(match.group(1))
            labels = []
            for position, entry in enumerate(site.playlists):
                checked = " checked" if song_id in entry["songs"] else ""
                labels.append('<label class="playlist-item"><input type="checkbox" name="playlist_%d"%s />'
                              '<span>%s</span></label>' % (position, checked, entry["title"]))
            return self._send('<form action="" method="POST" class="overlay-content">'
                              '<div class="title">ADD TO PLAYLIST</div><div class="playlist-list">%s</div>'
                              '<input type="submit" value="Save" name="submitPlaylist" class="button" /></form>'
                              % "".join(labels))
        match = re.fullmatch(r"/playlist/(\d+)/delete", path)
        if match:
            site.playlists = [e for e in site.playlists if e["id"] != int(match.group(1))]
            return self._send("<html>deleted</html>")
        self._send("<html>ok</html>")

    def do_POST(self):
        site = self.server
        body = self._body()
        content_type = self.headers.get("Content-Type", "")
        path = urllib.parse.urlparse(self.path).path
        if self._expired():
            return self._login_page()  # every POST here is a form flow
        if path == "/playlist/create":
            site.requests.append(("POST-CREATE", body.decode("latin-1")))
            has_cover_file = ('name="form[coverPath]"; filename="') .encode("utf-8") in body
            has_title = b'name="form[title]"' in body
            if not (has_cover_file and has_title and b'name="form[_token]"' in body):
                # Production quirk: silently re-render the form, create nothing.
                return self._send('<form name="form" method="post" enctype="multipart/form-data"></form>')
            title = re.search(rb'name="form\[title\]"\r\n\r\n([^\r]*)\r\n', body)
            description = re.search(rb'name="form\[description\]"\r\n\r\n([^\r]*)\r\n', body)
            site.next_playlist_id += 1
            site.playlists.append({"id": site.next_playlist_id,
                                   "title": (title.group(1) if title else b"").decode("utf-8"),
                                   "description": (description.group(1) if description else b"").decode("utf-8"),
                                   "songs": set()})
            return self._send("<html>created</html>", status=302, location="/playlist/%d" % site.next_playlist_id)
        match = re.fullmatch(r"/song/(\d+)", path)
        if match:
            song_id = int(match.group(1))
            site.requests.append(("POST-SONG", body.decode("latin-1")))
            fields = urllib.parse.parse_qs(body.decode("utf-8"), keep_blank_values=True)
            if fields.get("submitPlaylist") != ["1"]:
                return self._send("<html>ignored</html>")
            wanted = set()
            for key, values in fields.items():
                index = re.fullmatch(r"playlist_(\d+)", key)
                if index and values == ["on"] and int(index.group(1)) < len(site.playlists):
                    wanted.add(int(index.group(1)))
            for position, entry in enumerate(site.playlists):
                if position in wanted:
                    entry["songs"].add(song_id)
                else:
                    entry["songs"].discard(song_id)
            return self._send("<html>saved</html>")
        self._send("<html>ok</html>")


def make_cookie(name="PHPSESSID", value="abc", domain="127.0.0.1"):
    return http.cookiejar.Cookie(
        version=0, name=name, value=value, port=None, port_specified=False,
        domain=domain, domain_specified=False, domain_initial_dot=False,
        path="/", path_specified=True, secure=False, expires=None, discard=True,
        comment=None, comment_url=None, rest={}, rfc2109=False)


class PlaylistTests(unittest.TestCase):
    def setUp(self):
        temporary_root = ROOT / ".qa" / "tmp"
        temporary_root.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix="playlists-", dir=temporary_root)
        self.state = Path(self.temporary.name)
        session_client.initialize(self.state)
        session_client.SessionStore(self.state).save({
            "schemaVersion": 1,
            "identity": {"userId": 42, "username": "tester", "userAgent": "UA", "connectedAt": "x"},
            "cookies": [session_client.cookie_to_record(make_cookie())]})
        self.site = FakePlaylistSite()
        self.site.playlists.append({"id": 901, "title": "Favorites", "description": "", "songs": {5}})
        self.site.playlists.append({"id": 902, "title": "Rave", "description": "", "songs": set()})
        self.site.next_playlist_id = 1000  # seeded ids stay below the counter
        self.thread = threading.Thread(target=self.site.serve_forever, daemon=True)
        self.thread.start()
        self._origin = playlists.SITE
        playlists.SITE = self.site.origin
        session_client._write_queue = session_client.WriteQueue(minimum_gap=0.0)

    def tearDown(self):
        playlists.SITE = self._origin
        self.site.shutdown()
        self.site.server_close()
        self.thread.join(3)
        session_client.disconnect()
        self.temporary.cleanup()

    def test_reads_shapes(self):
        mine = playlists.my_playlists(42)
        # The API returns the newest playlist first.
        self.assertEqual([(e["id"], e["title"], e["songs"]) for e in mine],
                         [(902, "Rave", 0), (901, "Favorites", 1)])
        detail = playlists.playlist_detail(901)
        self.assertEqual(detail["songIds"], [5])

    def test_create_requires_cover_and_verifies_by_diff(self):
        created = playlists.create_playlist("测试歌单", "描述")
        self.assertEqual(created["title"], "测试歌单")
        self.assertIn(created["id"], [e["id"] for e in playlists.my_playlists(42)])
        # The multipart post carried a real cover file part.
        create_posts = [r for r in self.site.requests if r[0] == "POST-CREATE"]
        self.assertTrue(create_posts and 'name="form[coverPath]"; filename="cover.png"' in create_posts[-1][1])

    def test_create_validates_title(self):
        for bad in ("", "   ", "x" * 65):
            with self.assertRaises(playlists.PlaylistError):
                playlists.create_playlist(bad)

    def test_delete_verifies_by_diff(self):
        playlists.delete_playlist(902)
        self.assertEqual([e["id"] for e in playlists.my_playlists(42)], [901])
        with self.assertRaises(playlists.PlaylistError):
            playlists.delete_playlist(9999)

    def test_membership_maps_titles_through_the_reversed_overlay_order(self):
        # Production trap: the API lists the newest playlist first while the
        # song-page checkboxes run oldest-first. "Rave" (902) is API position 0
        # but checkbox playlist_1 — only title mapping stays correct.
        updated = playlists.set_song_membership(7, {902})
        self.assertIn(7, playlists.playlist_detail(902)["songIds"])
        self.assertNotIn(7, playlists.playlist_detail(901)["songIds"])
        posts = [r for r in self.site.requests if r[0] == "POST-SONG"]
        self.assertTrue(posts)
        body = posts[-1][1]
        self.assertIn("playlist_1=on", body)
        self.assertNotIn("playlist_0=on", body)
        self.assertIn("submitPlaylist=1", body)
        gets = [r for r in self.site.requests if r[0] == "GET" and re.fullmatch(r"/song/7", r[1])]
        self.assertTrue(gets, "the overlay page is parsed before the POST")
        counts = {e["id"]: e["songs"] for e in updated}
        self.assertEqual(counts, {901: 1, 902: 1})

    def test_membership_move_between_playlists(self):
        # Song 5 currently in "Favorites" (901): move it to "Rave" (902).
        playlists.set_song_membership(5, {902})
        self.assertEqual(playlists.playlist_detail(901)["songIds"], [])
        self.assertEqual(playlists.playlist_detail(902)["songIds"], [5])

    def test_membership_clears_everything_when_wanted_empty(self):
        playlists.set_song_membership(5, set())
        self.assertEqual(playlists.playlist_detail(901)["songIds"], [])

    def test_membership_rejects_title_missing_from_overlay(self):
        # A playlist the overlay page does not know (created after render)
        # aborts before any POST.
        with self.assertRaises(playlists.PlaylistConflict):
            playlists.set_song_membership(7, {901, 902, 7777})
        self.assertEqual([r for r in self.site.requests if r[0] == "POST-SONG"], [])

    def test_membership_rejects_unknown_playlist(self):
        with self.assertRaises(playlists.PlaylistConflict):
            playlists.set_song_membership(7, {4242})

    def test_expired_session_surfaces_as_session_error(self):
        self.site.expire_session = True
        with self.assertRaises(session_client.SessionExpired):
            playlists.create_playlist("nope")
        with self.assertRaises(session_client.SessionExpired):
            playlists.set_song_membership(7, {901})

    def test_default_cover_is_a_valid_png(self):
        cover = playlists.default_cover_png()
        self.assertTrue(cover.startswith(b"\x89PNG\r\n\x1a\n"))
        self.assertGreater(len(cover), 1000)
        self.assertLess(len(cover), 20000)


class PlaylistEndpointTests(unittest.TestCase):
    def setUp(self):
        temporary_root = ROOT / ".qa" / "tmp"
        temporary_root.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix="playlists-api-", dir=temporary_root)
        self.root = Path(self.temporary.name)
        self.default_target = self.root / "Custom"
        self.default_target.mkdir()
        self.target_patch = mock.patch.object(
            portable.installer, "default_target_directory", return_value=self.default_target)
        self.target_patch.start()

    def tearDown(self):
        self.target_patch.stop()
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

    def test_playlist_endpoints_require_a_session(self):
        app = portable.PortableApplication(self.root / "state")
        worker = threading.Thread(target=app.serve_forever, daemon=True)
        worker.start()
        self.assertTrue(app.started.wait(2))
        try:
            self.assertEqual(self.request(app, "GET", "/v1/playlists", authenticated=False)[0], 403)
            status, result = self.request(app, "GET", "/v1/playlists")
            self.assertEqual((status, result["code"]), (409, "session_disconnected"))
            status, result = self.request(app, "POST", "/v1/playlists/create", {"title": "x"})
            self.assertEqual((status, result["code"]), (409, "session_disconnected"))
            status, result = self.request(app, "POST", "/v1/playlists/song", {"songId": 1, "playlistIds": []})
            self.assertEqual((status, result["code"]), (409, "session_disconnected"))
            status, result = self.request(app, "POST", "/v1/playlists/create", {"title": ""})
            self.assertEqual(status, 400)
            status, result = self.request(app, "POST", "/v1/playlists/delete", {"playlistId": "1"})
            self.assertEqual(status, 400)
            status, result = self.request(app, "POST", "/v1/playlists/song", {"songId": 1, "playlistIds": ["a"]})
            self.assertEqual(status, 400)
        finally:
            app.manager.begin_exit()
            app.close()
            worker.join(3)


if __name__ == "__main__":
    unittest.main()
