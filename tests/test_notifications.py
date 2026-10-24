"""Notification channel contracts against a stateful fake spinsha.re."""
import http.cookiejar
import http.server
from pathlib import Path
import sys
import tempfile
import threading
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
import notifications
import session_client

ITEMS = {
    11: {"text": "Someone reviewed your chart <strong>Foo</strong>.", "icon": "https://spinsha.re/uploads/thumbnail/spinshare_a.jpg"},
    12: {"text": "Server maintenance tonight.", "icon": None},
    13: {"text": "You received a profile card.", "icon": "https://spinsha.re/uploads/card/x.png"},
}


def render_page(site):
    items = "".join(
        '<a href="https://spinsha.re/notification/clear/{0}?returnUrl=https://spinsha.re/" class="notification-item">'
        '<div class="notification-icon">{1}</div>'
        '<div class="notification-text">{2}</div></a>'.format(
            item_id,
        '<div class="cover" style="background-image: url({0});"></div>'.format(data["icon"]) if data["icon"] else '<i class="mdi mdi-server"></i>',
        data["text"])
        for item_id, data in sorted(site.items.items()))
    return ('<!doctype html><html><body><aside><nav class="items-right">'
            '<div class="item item-notifications" tabindex="0"><i class="mdi mdi-bell"></i>'
            '<div class="notification-box"><header><span>Notifications</span>'
            '<a href="/notification/clearAll?returnUrl=https://spinsha.re/" class="button">Clear all</a></header>'
            '<div class="notification-list">' + items + '</div></div></div>'
            '<div class="item item-user" tabindex="0"><div class="user-actions">'
            '<a href="/user/42/charts" class="user-action-item"></a></div></div></nav></aside></body></html>')


class FakeNotificationSite(http.server.ThreadingHTTPServer):
    def __init__(self):
        self.items = dict(ITEMS)
        self.expire_session = False
        super().__init__(("127.0.0.1", 0), FakeNotificationHandler)
        self.daemon_threads = True

    @property
    def origin(self):
        return "http://127.0.0.1:" + str(self.server_address[1])


class FakeNotificationHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _page(self):
        if self.server.expire_session:
            payload = '<form action="/login" method="post"><input type="text" id="username" name="_username"></form>'
        else:
            payload = render_page(self.server)
        data = payload.encode("utf-8")
        self.send_response(302 if False else 200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/":
            return self._page()
        if path.startswith("/notification/clear/"):
            self.server.items.pop(int(path.rsplit("/", 1)[-1]), None)
            return self._page()
        if path == "/notification/clearAll":
            self.server.items.clear()
            return self._page()
        self._page()


def make_cookie():
    return http.cookiejar.Cookie(
        version=0, name="PHPSESSID", value="abc", port=None, port_specified=False,
        domain="127.0.0.1", domain_specified=False, domain_initial_dot=False,
        path="/", path_specified=True, secure=False, expires=None, discard=True,
        comment=None, comment_url=None, rest={}, rfc2109=False)


class NotificationTests(unittest.TestCase):
    def setUp(self):
        temporary_root = ROOT / ".qa" / "tmp"
        temporary_root.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix="notifications-", dir=temporary_root)
        self.state = Path(self.temporary.name)
        session_client.initialize(self.state)
        session_client.SessionStore(self.state).save({
            "schemaVersion": 1,
            "identity": {"userId": 42, "username": "tester", "userAgent": "UA", "connectedAt": "x"},
            "cookies": [session_client.cookie_to_record(make_cookie())]})
        self.site = FakeNotificationSite()
        self.thread = threading.Thread(target=self.site.serve_forever, daemon=True)
        self.thread.start()
        self._origin = notifications.SITE
        self._return = notifications.RETURN_URL
        notifications.SITE = self.site.origin
        notifications.RETURN_URL = self.site.origin + "/"
        session_client._write_queue = session_client.WriteQueue(minimum_gap=0.0)

    def tearDown(self):
        notifications.SITE = self._origin
        notifications.RETURN_URL = self._return
        self.site.shutdown()
        self.site.server_close()
        self.thread.join(3)
        session_client.disconnect()
        self.temporary.cleanup()

    def test_fetch_parses_items_ids_text_and_icons(self):
        result = notifications.fetch_notifications()
        self.assertEqual(result["unread"], 3)
        by_id = {item["id"]: item for item in result["notifications"]}
        self.assertEqual(set(by_id), {11, 12, 13})
        self.assertIn("reviewed your chart", by_id[11]["text"])
        self.assertIn("Foo", by_id[11]["text"], "strong tags collapse into readable text")
        self.assertIn("spinshare_a.jpg", by_id[11]["icon"])
        self.assertIsNone(by_id[12]["icon"])

    def test_clear_one_verifies_disappearance(self):
        result = notifications.clear_notification(12)
        self.assertEqual(result["unread"], 2)
        self.assertNotIn(12, self.site.items)

    def test_clear_all_verifies_empty(self):
        result = notifications.clear_all_notifications()
        self.assertEqual(result, {"unread": 0})
        self.assertEqual(self.site.items, {})

    def test_expired_session_surfaces(self):
        self.site.expire_session = True
        with self.assertRaises(session_client.SessionExpired):
            notifications.fetch_notifications()


if __name__ == "__main__":
    unittest.main()
