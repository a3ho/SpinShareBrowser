"""Login-window watcher keeps polling while the user types and never dies.

Regression guard: release 2.3.3 shipped _watch_session_login calling
_try_capture_session/_close_login_window after those methods were dropped in
a refactor — the first capture attempt raised AttributeError after 20s, the
watcher cancelled the login, and the app showed "sign-in timed out" while the
user was still typing the password. These tests run the real watcher loop
against a fake clock, so a missing method fails here instead of in production.
"""
import sys
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
import desktop


class FakeClock:
    """Deterministic time.monotonic/time.sleep pair with an runaway guard."""

    def __init__(self, start=1000.0, limit=5000):
        self.now = float(start)
        self.limit = limit
        self.sleeps = 0

    def monotonic(self):
        return self.now

    def sleep(self, seconds):
        self.sleeps += 1
        if self.sleeps > self.limit:
            raise AssertionError("The login watcher loop did not terminate.")
        self.now += float(seconds)


class FakeLoginWindow:
    """pywebview login window double: URL, DOM identity, cookies, destroy."""

    def __init__(self, url="/login", signed_in_after=None):
        self.url = url
        self.signed_in_after = signed_in_after
        self.cleared = False
        self.destroyed = False
        self.cookie_reads = 0
        self.dom_reads = 0

    def dom_state(self, clock):
        self.dom_reads += 1
        if self.signed_in_after is not None and clock.now >= self.signed_in_after:
            return '["/user/42/playlists", "/user/42"]'
        return "[]"

    def get_current_url(self):
        return self.url

    def evaluate_js(self, script):
        if "navigator.userAgent" in script:
            return "TestAgent/1.0"
        return self.dom_state(_CLOCK[0])

    def get_cookies(self):
        self.cookie_reads += 1
        return [{"SPINSHARE_SESSION": "cookie-value"}]

    def clear_cookies(self):
        self.cleared = True

    def destroy(self):
        self.destroyed = True


_CLOCK = [None]


def run_watcher(window, clock):
    instance = object.__new__(desktop.Desktop)
    instance.login_lock = threading.Lock()
    instance.login_window = window
    instance.exiting = False
    _CLOCK[0] = clock
    try:
        desktop.Desktop._watch_session_login(instance, window)
    finally:
        _CLOCK[0] = None
    return instance


class LoginWatcherTests(unittest.TestCase):
    def test_capture_succeeds_after_signin_and_closes_window(self):
        clock, window = FakeClock(), FakeLoginWindow(signed_in_after=1010)
        with patch("time.monotonic", clock.monotonic), \
                patch("time.sleep", clock.sleep), \
                patch("session_client.complete_login", return_value=True) as complete:
            run_watcher(window, clock)
        self.assertEqual(complete.call_count, 1)
        cookies, user_agent, user_id = complete.call_args[0]
        self.assertEqual(user_agent, "TestAgent/1.0")
        self.assertEqual(user_id, 42)
        self.assertEqual(window.cookie_reads, 1)
        self.assertTrue(window.cleared, "Stored sessions leave no cookies behind")
        self.assertTrue(window.destroyed)
        # First capture waits out the 5s gap: no attempt before t=1005.
        self.assertGreaterEqual(clock.now - 1000.0, 5.0)

    def test_typing_password_never_cancels_the_login(self):
        # 60s of typing with no signed-in DOM: attempts keep failing and the
        # watcher keeps polling — this is the 2.3.3 "premature timeout" bug.
        clock, window = FakeClock(), FakeLoginWindow(signed_in_after=1060)
        with patch("time.monotonic", clock.monotonic), \
                patch("time.sleep", clock.sleep), \
                patch("session_client.complete_login", return_value=True) as complete:
            run_watcher(window, clock)
        self.assertEqual(complete.call_count, 1, "Only the signed-in state completes")
        self.assertGreaterEqual(window.dom_reads, 10, "Failed captures keep retrying")
        self.assertEqual(window.cookie_reads, 1, "Cookies are read only once signed in")
        self.assertTrue(window.destroyed)
        self.assertTrue(window.cleared)

    def test_deadline_cancels_and_closes_the_window(self):
        clock = FakeClock()

        def fast_forward(seconds):
            clock.sleeps += 1
            if clock.sleeps > 3:
                clock.now = 99999.0  # Jump past the 600s deadline.
            else:
                clock.now += float(seconds)

        window = FakeLoginWindow()  # Never signs in.
        with patch("time.monotonic", clock.monotonic), \
                patch("time.sleep", fast_forward), \
                patch("session_client.cancel_login") as cancel:
            run_watcher(window, clock)
        cancel.assert_called_once()
        self.assertTrue(window.destroyed)
        self.assertFalse(window.cleared)

    def test_window_api_failure_cancels_login(self):
        clock, window = FakeClock(), FakeLoginWindow()
        window.get_current_url = None  # Window died: every call raises.
        with patch("time.monotonic", clock.monotonic), \
                patch("time.sleep", clock.sleep), \
                patch("session_client.cancel_login") as cancel:
            run_watcher(window, clock)
        cancel.assert_called_once()
        self.assertTrue(window.destroyed)

    def test_login_window_closed_event_releases_state_once(self):
        instance = object.__new__(desktop.Desktop)
        instance.login_lock = threading.Lock()
        instance.login_window = object()
        with patch("session_client.cancel_login") as cancel:
            desktop.Desktop._login_window_closed(instance)
            desktop.Desktop._login_window_closed(instance)  # Second event: no-op.
        cancel.assert_called_once()
        self.assertIsNone(instance.login_window)


if __name__ == "__main__":
    unittest.main()
