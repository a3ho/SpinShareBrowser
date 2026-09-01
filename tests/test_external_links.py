"""Validate author links without opening a browser or contacting any server."""
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from src.desktop import Desktop, external_url_allowed


class ExternalLinkTests(unittest.TestCase):
    def test_web_links_keep_paths_queries_and_unicode(self):
        for url in (
            "https://spinsha.re/song/15294",
            "https://lowiro.bandcamp.com/album/arcaea-next-stage-crossing-collection",
            "http://example.com/path?q=music#notes",
            "https://EXAMPLE.com.:8443/a%20b",
            "https://例子.测试/路径?名字=值",
            "http://127.0.0.1:8080/",
            "https://[2001:db8::1]:443/",
        ):
            with self.subTest(url=url):
                self.assertTrue(external_url_allowed(url))

    def test_rejects_unsafe_or_ambiguous_urls(self):
        invalid = (
            None, 1, b"https://example.com", "", "//example.com", "https:example.com",
            "https:///example.com", "https://", "javascript:alert(1)", "file:///C:/test",
            "data:text/html,test", "mailto:person@example.com", "ftp://example.com",
            "https://user@example.com", "https://user:pass@example.com", "https://@example.com",
            "https://example.com:", "https://example.com:0", "https://example.com:-1",
            "https://example.com:65536", "https://example.com:abc", "https://example.com:８０",
            "https://.example.com", "https://example..com", "https://-example.com",
            "https://example-.com", "https://exa_mple.com", "https://exam%70le.com",
            "https://[::1]extra", "https://[::1]:", "https://[fe80::1%eth0]",
            "https://[v1.example]", "https://[127.0.0.1]", "https://::1/",
            "http://999.1.1.1", "http://127.1", "http://2130706433", "http://0x7f000001",
            "http://0177.0.0.1", "http://127.0.0.0x1", "https://example.com\\@other.com",
            "https://" + "a" * 64 + ".com", "https://" + ("a" * 63 + ".") * 4 + "com",
            "https://example.com/" + "a" * 8192,
        )
        for url in invalid:
            with self.subTest(url=url):
                self.assertFalse(external_url_allowed(url))
        for char in (" ", "\t", "\r", "\n", "\0", "\x7f", "\x85", "\u200b", "\u202e", "\ud800"):
            with self.subTest(char=repr(char)):
                self.assertFalse(external_url_allowed("https://example.com/" + char))

    def test_external_navigation_still_requires_user_action_and_trusted_source(self):
        page = SimpleNamespace(security_ready=True, _trusted=lambda _: False, _open_external=Mock())
        for initiated, redirected in ((False, False), (False, True), (True, True)):
            event = SimpleNamespace(Uri="https://example.com", IsUserInitiated=initiated,
                                    IsRedirected=redirected, Cancel=False)
            Desktop._navigation(page, None, event)
            self.assertTrue(event.Cancel)
        page._open_external.assert_not_called()
        event.IsUserInitiated, event.IsRedirected = True, False
        Desktop._navigation(page, None, event)
        page._open_external.assert_called_once_with("https://example.com")

        page._open_external.reset_mock()
        for ready, initiated in ((False, False), (False, True), (True, False)):
            page.security_ready = ready
            event = SimpleNamespace(Uri="https://example.com", IsUserInitiated=initiated, Handled=False)
            Desktop._new_window(page, None, event)
            self.assertTrue(event.Handled)
        page._open_external.assert_not_called()
        event.IsUserInitiated = True
        Desktop._new_window(page, None, event)
        page._open_external.assert_called_once_with("https://example.com")

        page.form = SimpleNamespace(webview=SimpleNamespace(Source="https://untrusted.example"))
        with patch("src.desktop.threading.Thread") as thread:
            Desktop._open_external(page, "https://example.com")
            thread.assert_not_called()
            page._trusted = lambda _: True
            Desktop._open_external(page, "javascript:alert(1)")
            thread.assert_not_called()


if __name__ == "__main__":
    unittest.main()
