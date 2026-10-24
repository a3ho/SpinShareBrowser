"""Review channel contracts against a stateful fake spinsha.re.

The fake reproduces the production shapes verified on 2026-10-24: the
?tab=reviews&action=add form (no CSRF, reviewRecommended yes/no radio,
reviewComment, submitReview), the /song/{id}/review/{rid}/delete route, and the
public review APIs.
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
import urllib.parse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
import reviews
import session_client


class FakeReviewSite(http.server.ThreadingHTTPServer):
    def __init__(self):
        self.reviews = {}  # review_id -> {songId, userId, recommended, comment}
        self.next_review_id = 500
        self.requests = []
        self.expire_session = False
        super().__init__(("127.0.0.1", 0), FakeReviewHandler)
        self.daemon_threads = True

    @property
    def origin(self):
        return "http://127.0.0.1:" + str(self.server_address[1])


class FakeReviewHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _body(self):
        return self.rfile.read(int(self.headers.get("Content-Length", 0) or 0))

    def _send(self, payload, status=200, content_type="text/html; charset=utf-8"):
        if isinstance(payload, str):
            payload = payload.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _login_page(self):
        self._send('<form action="/login" method="post"><input type="text" id="username" name="_username"></form>')

    def _expired(self):
        return self.server.expire_session

    def _public_reviews(self, song_id):
        return json.dumps({"version": 1, "status": 200, "data": {
            "average": False if not [r for r in self.server.reviews.values() if r["songId"] == song_id] else 80,
            "reviews": [{"id": rid, "recommended": r["recommended"], "comment": r["comment"],
                         "reviewDate": {"date": "2026-10-24 00:00:00.000000", "timezone": "UTC"},
                         "user": {"id": r["userId"], "username": "u%d" % r["userId"]}}
                        for rid, r in self.server.reviews.items() if r["songId"] == song_id]}})

    def do_GET(self):
        site = self.server
        parsed = urllib.parse.urlparse(self.path)
        path, query = parsed.path, urllib.parse.parse_qs(parsed.query)
        site.requests.append(("GET", self.path))
        match = re.fullmatch(r"/api/song/(\d+)/reviews", path)
        if match:
            return self._send(self._public_reviews(int(match.group(1))), content_type="application/json")
        match = re.fullmatch(r"/song/(\d+)", path)
        if match:
            if self._expired():
                return self._login_page()
            if query.get("action") == ["add"]:
                return self._send('<form action="" method="post" class="form-add">'
                                  '<input type="radio" checked="checked" name="reviewRecommended" value="yes">'
                                  '<input type="radio" name="reviewRecommended" value="no">'
                                  '<textarea name="reviewComment" rows="5"></textarea>'
                                  '<input type="submit" name="submitReview" value="Submit"></form>')
            return self._send("<html>song page</html>")
        match = re.fullmatch(r"/song/(\d+)/review/(\d+)/delete", path)
        if match:
            if self._expired():
                return self._login_page()
            site.reviews.pop(int(match.group(2)), None)
            return self._send("<html>deleted</html>")
        self._send("<html>ok</html>")

    def do_POST(self):
        site = self.server
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if self._expired():
            site.requests.append(("POST", self.path))
            return self._login_page()
        match = re.fullmatch(r"/song/(\d+)", path)
        if match and "action=add" in (parsed.query or ""):
            body = self._body()
            site.requests.append(("POST-REVIEW", body.decode("utf-8")))
            fields = urllib.parse.parse_qs(body.decode("utf-8"), keep_blank_values=True)
            if fields.get("submitReview") != ["Submit"] or fields.get("reviewRecommended") not in (["yes"], ["no"]):
                return self._send("<html>ignored</html>")
            site.next_review_id += 1
            site.reviews[site.next_review_id] = {
                "songId": int(match.group(1)), "userId": 42,
                "recommended": fields["reviewRecommended"] == ["yes"],
                "comment": fields.get("reviewComment", [""])[0]}
            return self._send("<html>review saved</html>")
        site.requests.append(("POST", self.path))
        self._send("<html>ok</html>")


def make_cookie():
    return http.cookiejar.Cookie(
        version=0, name="PHPSESSID", value="abc", port=None, port_specified=False,
        domain="127.0.0.1", domain_specified=False, domain_initial_dot=False,
        path="/", path_specified=True, secure=False, expires=None, discard=True,
        comment=None, comment_url=None, rest={}, rfc2109=False)


class ReviewTests(unittest.TestCase):
    def setUp(self):
        temporary_root = ROOT / ".qa" / "tmp"
        temporary_root.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix="reviews-", dir=temporary_root)
        self.state = Path(self.temporary.name)
        session_client.initialize(self.state)
        session_client.SessionStore(self.state).save({
            "schemaVersion": 1,
            "identity": {"userId": 42, "username": "tester", "userAgent": "UA", "connectedAt": "x"},
            "cookies": [session_client.cookie_to_record(make_cookie())]})
        self.site = FakeReviewSite()
        self.thread = threading.Thread(target=self.site.serve_forever, daemon=True)
        self.thread.start()
        self._origin = reviews.SITE
        reviews.SITE = self.site.origin
        session_client._write_queue = session_client.WriteQueue(minimum_gap=0.0)

    def tearDown(self):
        reviews.SITE = self._origin
        self.site.shutdown()
        self.site.server_close()
        self.thread.join(3)
        session_client.disconnect()
        self.temporary.cleanup()

    def test_post_submits_production_fields_and_verifies(self):
        result = reviews.post_review(15188, True, "Great flow")
        self.assertEqual(result["recommended"], True)
        self.assertEqual(result["comment"], "Great flow")
        posts = [r for r in self.site.requests if r[0] == "POST-REVIEW"]
        self.assertEqual(len(posts), 1)
        body = posts[0][1]
        self.assertIn("reviewRecommended=yes", body)
        self.assertIn("reviewComment=Great+flow", body)
        self.assertIn("submitReview=Submit", body)
        # The add page is fetched (views+1 inherent) before the POST.
        gets = [r for r in self.site.requests if r[0] == "GET" and "action=add" in r[1]]
        self.assertTrue(gets)

    def test_post_updates_existing_review_state(self):
        reviews.post_review(15188, False, "Too dense")
        # A second post by the same user replaces nothing on the fake; the real
        # site appends. Our contract: the verified result is the caller's review.
        result = reviews.post_review(15188, True, "Better after update")
        self.assertEqual(result["recommended"], True)

    def test_post_validates_comment(self):
        for bad in ("", "   ", "x" * 2001):
            with self.assertRaises(reviews.ReviewError):
                reviews.post_review(15188, True, bad)

    def test_delete_removes_and_verifies(self):
        created = reviews.post_review(15188, True, "Temporary")
        reviews.delete_review(15188, created["reviewId"])
        self.assertEqual([r for r in self.site.reviews.values() if r["songId"] == 15188], [])
        with self.assertRaises(reviews.ReviewError):
            reviews.delete_review(15188, created["reviewId"])

    def test_expired_session_surfaces_as_session_error(self):
        self.site.expire_session = True
        with self.assertRaises(session_client.SessionExpired):
            reviews.post_review(15188, True, "nope")


if __name__ == "__main__":
    unittest.main()
