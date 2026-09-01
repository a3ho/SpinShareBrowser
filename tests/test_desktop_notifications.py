import sys
from pathlib import Path
import inspect
import threading
import unittest
from unittest.mock import patch


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
import desktop


class CatalogNotificationTests(unittest.TestCase):
    def make_desktop(self):
        instance = object.__new__(desktop.Desktop)
        instance.exit_lock = threading.RLock()
        instance.catalog_failure_key = None
        instance.catalog_sync_due = 0.0
        instance.catalog_sync_thread = None
        instance.exiting = instance.final_close = False
        instance.finished = threading.Event()
        instance.posted = []
        instance.post = lambda callback: instance.posted.append(callback) is None
        instance._queue_toast = lambda kind, body: instance.posted.append((kind, body))
        return instance

    def test_only_changed_success_or_attempted_failure_posts(self):
        instance = self.make_desktop()
        self.assertFalse(instance.notify_catalog_sync({"attempted": False, "changed": True}))
        self.assertFalse(instance.notify_catalog_sync({"attempted": True, "changed": False}))
        self.assertTrue(instance.notify_catalog_sync({"attempted": True, "changed": True}))
        instance.posted.pop()()
        self.assertEqual(instance.posted, [("success", "")])

        instance.posted.clear()
        failure = {"attempted": True, "refreshError": "remote failed",
                   "automaticLastAttemptAt": 10, "errorCode": "charts_network_error"}
        self.assertTrue(instance.notify_catalog_sync(failure))
        instance.posted.pop()()
        self.assertEqual(instance.posted, [("error", "")], "Technical errors stay inside the app")
        self.assertFalse(instance.notify_catalog_sync(failure), "One automatic attempt must notify only once")
        self.assertFalse(instance.notify_catalog_sync(dict(failure, refreshError="different detail")),
                         "Changing technical detail must not duplicate one automatic attempt")
        self.assertTrue(instance.notify_catalog_sync(dict(failure, automaticLastAttemptAt=11)))

    def test_environmental_suppression_defers_without_starting_network_work(self):
        instance = self.make_desktop()
        called = []
        instance.application = type("Application", (), {
            "check_chart_catalog_automatically": lambda self: called.append(True)})()
        with (patch.object(desktop.time, "monotonic", return_value=100.0),
              patch.object(desktop, "_fullscreen_app_active", return_value=True),
              patch.object(desktop, "_battery_saver_active", return_value=False),
              patch.object(desktop, "_metered_network_active", return_value=False)):
            instance._start_catalog_sync()
        self.assertEqual(instance.catalog_sync_due, 100.0 + desktop.CATALOG_POLL_SECONDS)
        self.assertIsNone(instance.catalog_sync_thread)
        self.assertEqual(called, [])

    def test_notice_text_is_single_line_and_bounded(self):
        value = desktop._clean_notice_text("  first\nsecond  " + "x" * 300)
        self.assertNotIn("\n", value)
        self.assertLessEqual(len(value), 220)
        self.assertTrue(value.endswith("…"))
        self.assertEqual(desktop._clean_notice_text("Update complete."), "Update complete")
        self.assertEqual(desktop._clean_notice_text("更新完成。"), "更新完成")
        self.assertEqual(desktop._clean_notice_text("Working..."), "Working...")

    def test_exit_worker_hands_window_destruction_back_to_ui_without_closing_runtime(self):
        instance = object.__new__(desktop.Desktop)
        events = []
        instance.manager = type("Manager", (), {
            "work": type("Work", (), {"join": lambda self: events.append("work")})(),
        })()
        instance.application = type("Application", (), {
            "close": lambda self: events.append("runtime-close"),
        })()
        instance.security_ready = False
        instance.window_size = None
        instance.finished = threading.Event()
        instance.exit_lock = threading.RLock()
        instance.exit_thread = object()
        instance.exit_failed = False
        instance.post = lambda callback: events.append(("post", callback.__name__)) is None
        instance.activity_changed = lambda: events.append("activity")

        instance._finish_exit()

        self.assertEqual(events, ["work", ("post", "_destroy")])
        self.assertTrue(instance.finished.is_set())
        self.assertNotIn("runtime-close", events)

    def test_main_loop_waits_for_exit_and_server_threads_before_returning(self):
        source = inspect.getsource(desktop.run)
        self.assertLess(source.index("exit_thread.join()"), source.index("application.close()"))
        self.assertLess(source.index("application.close()"), source.index("desktop.server_thread.join()"))
        self.assertNotIn("desktop.server_thread.join(5)", source)

    def test_exit_worker_uses_native_close_if_ui_dispatch_is_already_unavailable(self):
        calls = []

        class Function:
            def __call__(self, *args):
                calls.append(args)
                return 1

        instance = object.__new__(desktop.Desktop)
        instance.manager = type("Manager", (), {
            "work": type("Work", (), {"join": lambda self: None})(),
        })()
        instance.security_ready = False
        instance.window_size = None
        instance.finished = threading.Event()
        instance.exit_lock = threading.RLock()
        instance.exit_thread = object()
        instance.exit_failed = instance.final_close = False
        instance.form = type("Form", (), {
            "Handle": type("Handle", (), {"ToInt64": lambda self: 123})(),
        })()
        instance.post = lambda callback: False
        instance.activity_changed = lambda: None
        user = type("User", (), {"PostMessageW": Function()})()

        with patch.object(desktop.ctypes, "WinDLL", return_value=user):
            instance._finish_exit()

        self.assertTrue(instance.final_close)
        self.assertEqual(calls, [(123, 0x10, 0, 0)])

    def test_window_close_still_runs_when_ui_resource_disposal_fails(self):
        instance = object.__new__(desktop.Desktop)
        closed = []
        instance.final_close = False
        instance.toast_pending = object()
        instance.toast_timer = instance.timer = instance.tray = instance.menu = None
        instance.form = type("Form", (), {"Close": lambda self: closed.append(True)})()
        instance._dispose_toast = lambda: (_ for _ in ()).throw(OSError("fixture disposal failure"))

        with self.assertRaises(OSError):
            instance._destroy()

        self.assertTrue(instance.final_close)
        self.assertEqual(closed, [True])

    def test_compact_geometry_tracks_each_monitor_working_area_and_dpi(self):
        class Work:
            def __init__(self, left, top, right, bottom):
                self.Left, self.Top, self.Right, self.Bottom = left, top, right, bottom
                self.Width, self.Height = right - left, bottom - top

        cases = (
            (Work(0, 0, 1920, 1040), 1.0, 184, (184, 58)),
            (Work(-1920, 0, 0, 1040), 1.0, 244, (244, 58)),
            (Work(-2560, 40, 0, 1440), 1.5, 366, (366, 87)),
            (Work(0, 0, 170, 1080), 1.0, 184, (170, 58)),
        )
        for work, scale, requested_width, expected in cases:
            with self.subTest(work=(work.Left, work.Top, work.Right, work.Bottom), scale=scale):
                left, top, width, height = desktop._toast_geometry(work, scale, requested_width)
                self.assertEqual((width, height), expected)
                self.assertEqual(work.Right, left + width)
                self.assertEqual(work.Bottom, top + height)
                self.assertGreaterEqual(left, work.Left)
                self.assertGreaterEqual(top, work.Top)

    def test_adaptive_width_distinguishes_short_long_and_truncated_titles(self):
        short = desktop._toast_width(1920, 1.0, brand_text_width=92, status_text_width=86)
        short_english = desktop._toast_width(1920, 1.0, brand_text_width=92, status_text_width=135)
        long = desktop._toast_width(1920, 1.0, brand_text_width=92, status_text_width=215)
        truncated = desktop._toast_width(1920, 1.0, brand_text_width=92, status_text_width=900)
        self.assertEqual(short, 184)
        self.assertEqual(short_english, 184)
        self.assertEqual(long, 239)
        self.assertEqual(truncated, 280)
        self.assertEqual(desktop._toast_width(170, 1.0, 92, 900), 170)
        self.assertLess(short, long)

    def test_both_rows_are_centered_from_their_measured_content(self):
        for width, scale, brand_width, status_width in (
                (184, 1.0, 92, 86), (184, 1.0, 92, 135),
                (246, 1.0, 92, 215), (280, 1.0, 92, 900),
                (322, 1.75, 161, 151)):
            with self.subTest(width=width, scale=scale, status_width=status_width):
                (icon_left, text_left, brand_draw_width, dot_left,
                 status_left, status_draw_width) = desktop._toast_layout(
                     width, scale, brand_width, status_width)
                icon_size = round(17 * scale)
                dot_size = round(6 * scale)
                brand_right = dot_left + dot_size
                self.assertLessEqual(abs(icon_left - (width - brand_right)), 1)
                self.assertEqual(text_left, icon_left + icon_size + round(7 * scale))
                status_right = status_left + status_draw_width
                self.assertLessEqual(abs(status_left - (width - status_right)), 1)
                self.assertLessEqual(status_draw_width, width - round(24 * scale))

    def test_smooth_fades_reach_opaque_hold_without_moving_bounds(self):
        class Form:
            IsDisposed = False
            Opacity = 0.0
            Left, Top, Width, Height = -184, 900, 184, 58

            @staticmethod
            def Invalidate():
                pass

            @staticmethod
            def Update():
                pass

        instance = self.make_desktop()
        instance.toast_form = Form()
        instance.toast_phase = "enter"
        instance.toast_phase_started = 0.0
        instance.toast_deadline = 0.0
        instance.toast_last_tick = 0.0
        instance.toast_timer = type("Timer", (), {"Interval": 16})()
        original_bounds = (instance.toast_form.Left, instance.toast_form.Top,
                           instance.toast_form.Width, instance.toast_form.Height)
        self.assertGreaterEqual(desktop.TOAST_ENTER_SECONDS, 0.40)
        self.assertGreaterEqual(desktop.TOAST_EXIT_SECONDS, 0.34)
        with patch.object(desktop.time, "monotonic", return_value=desktop.TOAST_ENTER_SECONDS / 2):
            instance._animate_toast()
        self.assertAlmostEqual(instance.toast_form.Opacity, 0.5)
        self.assertEqual(instance.toast_phase, "enter")
        self.assertEqual((instance.toast_form.Left, instance.toast_form.Top,
                          instance.toast_form.Width, instance.toast_form.Height), original_bounds)
        with patch.object(desktop.time, "monotonic", return_value=desktop.TOAST_ENTER_SECONDS):
            instance._animate_toast()
        self.assertEqual(instance.toast_form.Opacity, 1.0)
        self.assertEqual(instance.toast_phase, "hold")
        self.assertEqual((instance.toast_form.Left, instance.toast_form.Top,
                          instance.toast_form.Width, instance.toast_form.Height), original_bounds)
        instance.toast_phase = "exit"
        instance.toast_phase_started = 0.0
        with patch.object(desktop.time, "monotonic", return_value=desktop.TOAST_EXIT_SECONDS / 2):
            instance._animate_toast()
        self.assertAlmostEqual(instance.toast_form.Opacity, 0.5)
        self.assertEqual((instance.toast_form.Left, instance.toast_form.Top,
                          instance.toast_form.Width, instance.toast_form.Height), original_bounds)


if __name__ == "__main__":
    unittest.main()
