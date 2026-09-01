"""Windows window and notification area for SpinShare Browser."""
from __future__ import annotations

import concurrent.futures
import contextlib
import ctypes
import ipaddress
import json
from pathlib import Path
import re
import secrets
import sys
import threading
import time
import unicodedata
from urllib.parse import urlsplit
import webbrowser


TITLE = "SpinShare Browser"
CATALOG_POLL_SECONDS = 60
TOAST_ENTER_SECONDS = 0.42
TOAST_HOLD_SECONDS = 4.2
TOAST_EXIT_SECONDS = 0.36

_NOTICE_TEXT = {
    "en": {
        "Still running in the tray.": "Still running in the tray",
        "Use the tray icon to reopen it.": "Use the tray icon to reopen it.",
        "Chart data updated.": "Chart data updated",
        "Chart data could not be updated.": "Chart data could not be updated",
        "The latest chart catalog is ready.": "The latest chart catalog is ready.",
        "Open SpinShare Browser for details and retry.": "Open SpinShare Browser for details and retry.",
    },
    "zh-CN": {
        "Still running in the tray.": "已在系统托盘中运行",
        "Use the tray icon to reopen it.": "双击托盘图标即可重新打开。",
        "Chart data updated.": "谱面数据已更新",
        "Chart data could not be updated.": "谱面数据更新失败",
        "The latest chart catalog is ready.": "最新谱面目录已在后台准备完成。",
        "Open SpinShare Browser for details and retry.": "打开 SpinShare Browser 查看详情并重试。",
    },
}


def _clean_notice_text(value, limit=220):
    text = " ".join(str(value or "").split())
    return text if len(text) <= limit else text[:limit - 1].rstrip() + "…"


def _toast_width(work_width, scale, brand_text_width, status_text_width):
    edge = round(12 * scale)
    brand_required = (edge * 2 + round(17 * scale) + round(7 * scale) + brand_text_width +
                      round(8 * scale) + round(6 * scale))
    status_required = edge * 2 + status_text_width
    width = max(round(184 * scale), min(round(280 * scale), max(brand_required, status_required)))
    return min(max(1, work_width), width)


def _toast_layout(width, scale, brand_text_width, status_text_width):
    edge = round(12 * scale)
    icon_size = round(17 * scale)
    icon_gap = round(7 * scale)
    dot_gap = round(8 * scale)
    dot_size = round(6 * scale)
    brand_available = max(1, width - edge * 2 - icon_size - icon_gap - dot_gap - dot_size)
    brand_draw_width = min(brand_text_width, brand_available)
    brand_group_width = icon_size + icon_gap + brand_draw_width + dot_gap + dot_size
    icon_left = max(0, (width - brand_group_width) // 2)
    text_left = icon_left + icon_size + icon_gap
    dot_left = text_left + brand_draw_width + dot_gap
    status_draw_width = min(status_text_width, max(1, width - edge * 2))
    status_left = max(0, (width - status_draw_width) // 2)
    return icon_left, text_left, brand_draw_width, dot_left, status_left, status_draw_width


def _toast_geometry(work, scale, width=None):
    width = min(width if width is not None else round(280 * scale), max(1, work.Width))
    height = min(round(58 * scale), max(1, work.Height))
    return work.Right - width, work.Bottom - height, width, height


def _catalog_sync_result(result=None, **details):
    if isinstance(result, dict):
        details = {**result, **details}
    elif isinstance(result, bool):
        details.setdefault("changed", result)
    attempted = details.get("attempted", True) is True
    changed = details.get("changed", False) is True
    error = next((_clean_notice_text(details.get(name)) for name in ("refreshError", "error", "message")
                  if details.get(name)), "")
    if attempted and details.get("stale") is True and not error:
        error = "The latest chart catalog could not be fetched."
    return attempted, changed, error, details


def _client_animations_enabled():
    if sys.platform != "win32":
        return False
    enabled = ctypes.c_int(1)
    try:
        user = ctypes.WinDLL("user32")
        return bool(user.SystemParametersInfoW(0x1042, 0, ctypes.byref(enabled), 0) and enabled.value)
    except (AttributeError, OSError):
        return True


def _fullscreen_app_active():
    """Use the shell signal first, then a visible-frame fallback for older Windows."""
    if sys.platform != "win32":
        return False
    try:
        state = ctypes.c_int()
        query = ctypes.WinDLL("shell32").SHQueryUserNotificationState
        query.argtypes = [ctypes.POINTER(ctypes.c_int)]
        query.restype = ctypes.c_long
        if query(ctypes.byref(state)) == 0:
            return state.value in {2, 3, 4}  # Full screen/busy, Direct3D full screen, presentation mode.
    except (AttributeError, OSError):
        pass

    class Rect(ctypes.Structure):
        _fields_ = [(name, ctypes.c_long) for name in ("left", "top", "right", "bottom")]

    class MonitorInfo(ctypes.Structure):
        _fields_ = [("size", ctypes.c_uint32), ("monitor", Rect), ("work", Rect), ("flags", ctypes.c_uint32)]

    try:
        user = ctypes.WinDLL("user32")
        user.GetForegroundWindow.restype = ctypes.c_void_p
        user.GetShellWindow.restype = ctypes.c_void_p
        user.GetDesktopWindow.restype = ctypes.c_void_p
        user.GetWindowRect.argtypes = [ctypes.c_void_p, ctypes.POINTER(Rect)]
        user.MonitorFromWindow.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
        user.MonitorFromWindow.restype = ctypes.c_void_p
        user.GetMonitorInfoW.argtypes = [ctypes.c_void_p, ctypes.POINTER(MonitorInfo)]
        hwnd = user.GetForegroundWindow()
        if not hwnd or hwnd in {user.GetShellWindow(), user.GetDesktopWindow()}:
            return False
        bounds = Rect()
        try:
            dwm = ctypes.WinDLL("dwmapi").DwmGetWindowAttribute
            dwm.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_void_p, ctypes.c_uint32]
            if dwm(hwnd, 9, ctypes.byref(bounds), ctypes.sizeof(bounds)) != 0:
                raise OSError
        except (AttributeError, OSError):
            if not user.GetWindowRect(hwnd, ctypes.byref(bounds)):
                return False
        monitor = user.MonitorFromWindow(hwnd, 2)
        info = MonitorInfo(ctypes.sizeof(MonitorInfo))
        if not monitor or not user.GetMonitorInfoW(monitor, ctypes.byref(info)):
            return False
        tolerance = 2
        return (bounds.left <= info.monitor.left + tolerance and bounds.top <= info.monitor.top + tolerance and
                bounds.right >= info.monitor.right - tolerance and bounds.bottom >= info.monitor.bottom - tolerance)
    except (AttributeError, OSError, ValueError):
        return False


def _battery_saver_active():
    if sys.platform != "win32":
        return False

    class PowerStatus(ctypes.Structure):
        _fields_ = [("acLineStatus", ctypes.c_byte), ("batteryFlag", ctypes.c_byte),
                    ("batteryLifePercent", ctypes.c_byte), ("systemStatusFlag", ctypes.c_byte),
                    ("batteryLifeTime", ctypes.c_uint32), ("batteryFullLifeTime", ctypes.c_uint32)]

    try:
        status = PowerStatus()
        return bool(ctypes.WinDLL("kernel32").GetSystemPowerStatus(ctypes.byref(status)) and
                    status.systemStatusFlag)
    except (AttributeError, OSError):
        return False


def _metered_network_active():
    """Read Windows' current connection cost through the documented Network List Manager COM API."""
    if sys.platform != "win32":
        return False

    class Guid(ctypes.Structure):
        _fields_ = [("data1", ctypes.c_uint32), ("data2", ctypes.c_uint16), ("data3", ctypes.c_uint16),
                    ("data4", ctypes.c_ubyte * 8)]

    def guid(value):
        raw = bytes.fromhex(value.replace("-", ""))
        return Guid(int.from_bytes(raw[0:4], "big"), int.from_bytes(raw[4:6], "big"),
                    int.from_bytes(raw[6:8], "big"), (ctypes.c_ubyte * 8)(*raw[8:]))

    ole = None
    manager = ctypes.c_void_p()
    release = None
    initialized = False
    try:
        ole = ctypes.WinDLL("ole32")
        ole.CoInitializeEx.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
        ole.CoInitializeEx.restype = ctypes.c_long
        result = ole.CoInitializeEx(None, 2)
        initialized = result in {0, 1}
        if result not in {0, 1, -2147417850}:  # RPC_E_CHANGED_MODE still permits the current apartment.
            return False
        class_id = guid("dcb00c01-570f-4a9b-8d69-199fdba5723b")
        interface_id = guid("dcb00008-570f-4a9b-8d69-199fdba5723b")
        ole.CoCreateInstance.argtypes = [ctypes.POINTER(Guid), ctypes.c_void_p, ctypes.c_uint32,
                                         ctypes.POINTER(Guid), ctypes.POINTER(ctypes.c_void_p)]
        ole.CoCreateInstance.restype = ctypes.c_long
        if ole.CoCreateInstance(ctypes.byref(class_id), None, 23, ctypes.byref(interface_id),
                                ctypes.byref(manager)) != 0:
            return False
        methods = ctypes.cast(manager, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))).contents
        get_cost = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p,
                                     ctypes.POINTER(ctypes.c_uint32), ctypes.c_void_p)(methods[3])
        release = ctypes.WINFUNCTYPE(ctypes.c_uint32, ctypes.c_void_p)(methods[2])
        cost = ctypes.c_uint32()
        if get_cost(manager, ctypes.byref(cost), None) != 0:
            return False
        return bool(cost.value & (0x2 | 0x4 | 0x10000 | 0x20000 | 0x40000 | 0x80000))
    except (AttributeError, OSError, ValueError):
        return False
    finally:
        if manager.value and release is not None:
            with contextlib.suppress(Exception):
                release(manager)
        if initialized and ole is not None:
            ole.CoUninitialize()


def _icon_path():
    root = Path(sys._MEIPASS) if getattr(sys, "frozen", False) else Path(__file__).resolve().parent.parent
    return root / "assets" / "spinshare-browser.ico"


def _native_prompt(message, choices, icon=None):
    from System.Drawing import Color, Size, SizeF, SystemFonts
    import System.Windows.Forms as Forms

    dialog = Forms.Form()
    dialog.Text = TITLE
    if icon is not None:
        dialog.Icon = icon
    dialog.Font = SystemFonts.MessageBoxFont
    dialog.BackColor = Color.FromArgb(28, 33, 36)
    dialog.ForeColor = Color.FromArgb(224, 229, 233)
    dialog.FormBorderStyle = Forms.FormBorderStyle.FixedDialog
    dialog.StartPosition = Forms.FormStartPosition.CenterParent
    dialog.MinimizeBox = dialog.MaximizeBox = False
    dialog.ShowInTaskbar = False
    dialog.AutoScaleMode = Forms.AutoScaleMode.Dpi
    dialog.AutoScaleDimensions = SizeF(96, 96)
    dialog.AutoSize = True
    dialog.AutoSizeMode = Forms.AutoSizeMode.GrowAndShrink
    dialog.MinimumSize = Size(360, 0)
    content = Forms.FlowLayoutPanel()
    content.AutoSize = True
    content.FlowDirection = Forms.FlowDirection.TopDown
    content.WrapContents = False
    content.Padding = Forms.Padding(20)
    label = Forms.Label()
    label.AutoSize = True
    label.MaximumSize = Size(500, 0)
    label.Text = str(message)
    content.Controls.Add(label)
    actions = Forms.FlowLayoutPanel()
    actions.AutoSize = True
    actions.WrapContents = False
    actions.FlowDirection = Forms.FlowDirection.RightToLeft
    for caption, result in choices:
        button = Forms.Button()
        button.Text = caption
        button.AutoSize = True
        button.MinimumSize = Size(120, 34)
        button.Margin = Forms.Padding(6, 16, 0, 0)
        button.FlatStyle = Forms.FlatStyle.Flat
        button.FlatAppearance.BorderColor = Color.FromArgb(68, 77, 83)
        button.FlatAppearance.MouseOverBackColor = Color.FromArgb(181, 29, 99)
        button.BackColor = Color.FromArgb(47, 54, 58)
        button.ForeColor = dialog.ForeColor
        button.DialogResult = result
        actions.Controls.Add(button)
        if result == Forms.DialogResult.Cancel:
            dialog.AcceptButton = dialog.CancelButton = button
    content.Controls.Add(actions)
    dialog.Controls.Add(content)
    def dark_caption(*_):
        with contextlib.suppress(Exception):
            dark = ctypes.c_int(1)
            set_attribute = ctypes.WinDLL("dwmapi").DwmSetWindowAttribute
            set_attribute.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_void_p, ctypes.c_uint]
            set_attribute(dialog.Handle.ToInt64(), 20, ctypes.byref(dark), ctypes.sizeof(dark))
    dialog.HandleCreated += dark_caption
    return dialog


def show_startup_error(message, button_text="OK"):
    try:
        import clr
        clr.AddReference("System.Windows.Forms")
        clr.AddReference("System.Drawing")
        from System.Drawing import Icon
        from System.Threading import ApartmentState, Thread, ThreadStart
        import System.Windows.Forms as Forms

        errors = []

        def show():
            icon = dialog = None
            try:
                user = ctypes.WinDLL("user32")
                user.SetThreadDpiAwarenessContext.argtypes = [ctypes.c_void_p]
                user.SetThreadDpiAwarenessContext(-4)
                Forms.Application.EnableVisualStyles()
                with contextlib.suppress(Exception):
                    icon = Icon(str(_icon_path()))
                dialog = _native_prompt(message, [(button_text, Forms.DialogResult.Cancel)], icon)
                dialog.StartPosition = Forms.FormStartPosition.CenterScreen
                dialog.ShowInTaskbar = True
                dialog.ShowDialog()
            except Exception as exc:
                errors.append(exc)
            finally:
                if dialog is not None:
                    dialog.Dispose()
                if icon is not None:
                    icon.Dispose()

        thread = Thread(ThreadStart(show))
        thread.SetApartmentState(ApartmentState.STA)
        thread.Start()
        thread.Join()
        if errors:
            raise errors[0]
    except Exception:
        ctypes.windll.user32.MessageBoxW(None, str(message), TITLE, 0x10)


def external_url_allowed(value):
    if (not isinstance(value, str) or not value or len(value) > 8192 or "\\" in value or
            any(char.isspace() or unicodedata.category(char) in {"Cc", "Cf", "Cs"} for char in value)):
        return False
    try:
        parsed = urlsplit(value)
        if parsed.scheme not in {"http", "https"} or parsed.username is not None or parsed.password is not None:
            return False
        host, port = parsed.hostname, parsed.port
        if not host or port is not None and not 1 <= port <= 65535:
            return False
        authority = parsed.netloc.rsplit(":", 1)[0] if port is not None else parsed.netloc
        if authority.lower() != ("[" + host + "]" if ":" in host else host):
            return False
        if ":" in host:
            return "%" not in host and ipaddress.IPv6Address(host).version == 6
        host = host.encode("idna").decode("ascii").removesuffix(".")
        if len(host) > 253:
            return False
        # Reject browser shorthand/hex IPs so the displayed host cannot hide another address.
        if re.fullmatch(r"[0-9]+|0[xX][0-9a-fA-F]+", host.rsplit(".", 1)[-1]):
            return str(ipaddress.IPv4Address(host)) == host
        return all(re.fullmatch(r"[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?", label)
                   for label in host.split("."))
    except (ValueError, UnicodeError):
        return False


class Desktop:
    def __init__(self, application, webview):
        self.application = application
        self.manager = application.manager
        self.webview = webview
        self.url = application.origin + application.ui_path
        self.window = self.form = self.tray = self.menu = self.timer = None
        self.toast_form = self.toast_timer = self.toast_pending = None
        self.toast_fonts = ()
        self.toast_icon = None
        self.ready = threading.Event()
        self.finished = threading.Event()
        self.exit_lock = threading.RLock()
        self.exit_thread = None
        self.exiting = self.exit_failed = self.final_close = self.security_ready = False
        self.show_requested = self.exit_requested = self.picker_open = False
        self.dialog = None
        self.prompt = None
        self.prompt_answered = self.page_ready = self.page_failed = False
        self.error = None
        self.server_thread = None
        self.custom_chrome = self.maximized = False
        self.window_visible = True
        self.window_size = None
        self.frame_callback = None
        self.frame_handles = set()
        self.frame_cursor_callback = self.frame_cursor_hook = None
        self.toast_phase = None
        self.catalog_sync_due = 0.0
        self.catalog_sync_thread = None
        self.catalog_failure_key = None

    def text(self, key):
        language = self.manager.config.get("language", "en")
        return self.application.catalog.get(language, {}).get(key, key)

    def post(self, callback):
        if not self.ready.is_set() or self.form is None or self.final_close:
            return False
        try:
            def invoke():
                try:
                    callback()
                except Exception:
                    with contextlib.suppress(Exception):
                        self._show()
            self.form.BeginInvoke(self.Action(invoke))
            return True
        except Exception:
            return False

    def show(self):
        with self.exit_lock:
            if self.final_close or self.finished.is_set():
                return False
            if self.show_requested:
                return True
            self.show_requested = True
        if not self.security_ready or self.post(self._show):
            return True
        self.show_requested = False
        return False

    def request_exit(self):
        self.exit_requested = True
        return self.post(self._request_exit)

    def settings_changed(self):
        return self.post(self._refresh_labels)

    def activity_changed(self):
        def publish():
            self._refresh_labels()
            self._emit_window_state()
            if self.prompt is not None and self.prompt["kind"] == "close":
                self._emit_dialog()
        return self.post(publish)

    def notify_catalog_sync(self, result=None, **details):
        """Publish one completed automatic-sync result without touching UI off-thread."""
        with self.exit_lock:
            if self.exiting or self.final_close or self.finished.is_set():
                return False
        attempted, changed, error, values = _catalog_sync_result(result, **details)
        if not attempted:
            return False
        if error:
            attempt = values.get("automaticLastAttemptAt")
            failure_key = (("attempt", attempt, values.get("errorCode")) if attempt is not None else
                           ("fallback", values.get("errorCode"), error))
            with self.exit_lock:
                if failure_key == self.catalog_failure_key:
                    return False
                self.catalog_failure_key = failure_key
            return self.post(lambda: self._queue_toast("error", ""))
        with self.exit_lock:
            self.catalog_failure_key = None
        return changed and self.post(lambda: self._queue_toast("success", ""))

    def window_state(self):
        with self.manager.lock:
            return {"customChrome": self.custom_chrome, "maximized": self.maximized,
                    "visible": self.window_visible,
                    "exiting": self.exiting or self.manager.exiting or getattr(self.manager, "closed", False),
                    "activeCount": self.manager.active_count(), "exitFailed": self.exit_failed}

    def _emit_window_state(self):
        if self._web_prompt_available():
            with contextlib.suppress(Exception):
                self.form.webview.CoreWebView2.ExecuteScriptAsync(
                    "window.dispatchEvent(new CustomEvent('spinshare-window-state',{detail:" +
                    json.dumps(self.window_state()) + "}));")

    def window_command(self, action):
        if action not in ("minimize", "maximize", "close"):
            return False

        def apply():
            if self.picker_open or self.dialog is not None:
                self._show()
                return
            state = self.Forms.FormWindowState
            if action == "minimize":
                self.form.WindowState = state.Minimized
            elif action == "maximize":
                self.form.WindowState = state.Normal if self.form.WindowState == state.Maximized else state.Maximized
            else:
                self.form.Close()
        return self.post(apply)

    def dialog_state(self):
        with self.manager.lock:
            active_count = self.manager.active_count()
        with self.exit_lock:
            if self.prompt is None:
                return None
            return dict(self.prompt, activeCount=active_count)

    def dialog_reply(self, identifier, action, remember=False):
        with self.exit_lock:
            if self.prompt is None or self.prompt_answered or identifier != self.prompt["id"]:
                return False
            kind = self.prompt["kind"]
            choices = {"close": ("exit", "tray", "continue"), "exit": ("wait", "continue"), "message": ("continue",)}
            if (action not in choices.get(kind, ()) or type(remember) is not bool or
                    remember and (kind != "close" or action not in ("exit", "tray"))):
                return False
            self.prompt_answered = True

        def respond():
            with self.exit_lock:
                if self.prompt is None or self.prompt["id"] != identifier:
                    return
                self.prompt = None
                self.prompt_answered = False
            self._emit_dialog()
            if action in ("exit", "tray"):
                self._apply_close_choice(action, remember)
            elif action == "wait":
                self._start_exit()

        if self.post(respond):
            return True
        with self.exit_lock:
            if self.prompt is not None and self.prompt["id"] == identifier:
                self.prompt_answered = False
        return False

    def close_if_idle(self):
        with self.manager.lock:
            if self.picker_open or self.manager.active_count():
                return False
            self.manager.begin_exit()
        self._start_exit()
        return True

    def choose_directory(self, initial, title):
        import spinshare_portable as core

        if not self.ready.wait(15) or self.exiting:
            raise OSError("The app window is unavailable.")
        result = concurrent.futures.Future()

        def choose():
            if not result.set_running_or_notify_cancel():
                return
            with self.manager.lock:
                if self.exiting or self.manager.exiting or self.dialog is not None or self.prompt is not None:
                    result.set_exception(OSError("The app is exiting or another dialog is open."))
                    return
                self.picker_open = True
            try:
                self._show()
                result.set_result(core.choose_directory(initial, title, owner_handle=self.form.Handle.ToInt64()))
            except Exception as exc:
                result.set_exception(exc)
            finally:
                self.picker_open = False

        if not self.form.InvokeRequired:
            choose()
        elif not self.post(choose):
            raise OSError("The app window is unavailable.")
        try:
            return result.result(timeout=600)
        except concurrent.futures.TimeoutError as exc:
            result.cancel()
            raise OSError("Folder selection timed out.") from exc

    def _renderer(self, renderer):
        if renderer != "edgechromium":
            self.error = "Microsoft Edge WebView2 Runtime is required to open SpinShare Browser."
            return False
        return True

    def _before_show(self):
        from System import Action
        from System.Drawing import Rectangle, Size, SizeF
        from System.Reflection import BindingFlags
        import System.Windows.Forms as Forms

        self.Action, self.Forms, self.Size, self.SizeF = Action, Forms, Size, SizeF
        self.Rectangle = Rectangle
        self.BindingFlags = BindingFlags
        self.form = self.window.native
        self.form.Resize += self._window_resized
        self.form.VisibleChanged += self._window_resized
        self.form.Move += self._window_resized
        self.ready.set()
        if self.finished.is_set():
            self.post(self._destroy)
            return
        with contextlib.suppress(Exception):
            work = Forms.Screen.FromControl(self.form).WorkingArea
            self.form.MinimumSize = Size(min(self.form.MinimumSize.Width, work.Width), min(self.form.MinimumSize.Height, work.Height))
            self.form.Size = Size(min(self.form.Width, work.Width), min(self.form.Height, work.Height))
        try:
            self.form.webview.NavigationStarting += self._navigation
            self.form.webview.CoreWebView2InitializationCompleted += self._webview_ready
        except Exception:
            self._startup_failed()
            return
        try:
            self._make_tray()
        except Exception:
            for component in (self.timer, self.tray, self.menu):
                if component is not None:
                    with contextlib.suppress(Exception):
                        component.Dispose()
            self.timer = self.tray = self.menu = None
        if self.form.webview.CoreWebView2 is not None:
            self._configure_webview(self.form.webview)

    def _webview_ready(self, sender, args):
        try:
            if not args.IsSuccess:
                self._startup_failed()
                return
            self._configure_webview(sender)
        except Exception:
            self._startup_failed()

    def _configure_webview(self, sender):
        if self.finished.is_set():
            self.post(self._destroy)
            return
        if self.security_ready or self.error:
            return
        try:
            from Microsoft.Web.WebView2.Core import CoreWebView2PermissionState

            self.denied_permission = CoreWebView2PermissionState.Deny
            core = sender.CoreWebView2
            # pywebview 6.2.1 installs an unfiltered shell-opening handler first.
            core.NewWindowRequested -= self.form.browser.on_new_window_request
            core.NewWindowRequested += self._new_window
            core.FrameNavigationStarting += self._deny_navigation
            core.LaunchingExternalUriScheme += self._deny_navigation
            core.DownloadStarting += self._deny_navigation
            core.PermissionRequested += self._deny_permission
            core.DOMContentLoaded += self._document_ready
            core.ProcessFailed += self._engine_failed
            settings = core.Settings
            settings.AreHostObjectsAllowed = False
            settings.IsWebMessageEnabled = False
            settings.AreDefaultScriptDialogsEnabled = False
            settings.AreDevToolsEnabled = False
            settings.AreDefaultContextMenusEnabled = False
            settings.AreBrowserAcceleratorKeysEnabled = False
            settings.IsStatusBarEnabled = False
            self._configure_chrome(settings)
            self._restore_window_size()
            self.security_ready = True
            core.Navigate(self.url)
            self.post(self._show)
            if self.exit_requested:
                self.post(self._request_exit)
        except Exception:
            self._startup_failed()

    def _window_resized(self, *_):
        previous = self.maximized, self.window_visible
        if self.form.WindowState != self.Forms.FormWindowState.Minimized:
            self.maximized = self.form.WindowState == self.Forms.FormWindowState.Maximized
        if self.security_ready:
            self._remember_window_size()
        self.window_visible = self.form.Visible and self.form.WindowState != self.Forms.FormWindowState.Minimized
        self._update_maximized_bounds()
        if previous != (self.maximized, self.window_visible):
            self._emit_window_state()

    def _remember_window_size(self):
        state = self.form.WindowState
        if state == self.Forms.FormWindowState.Normal:
            scale = self._window_scale()
            self.window_size = {"width": max(1, round(self.form.Width / scale)),
                                "height": max(1, round(self.form.Height / scale)), "maximized": False}
        elif state == self.Forms.FormWindowState.Maximized and self.window_size is not None:
            self.window_size = dict(self.window_size, maximized=True)

    def _window_scale(self):
        get_dpi = ctypes.WinDLL("user32").GetDpiForWindow
        get_dpi.argtypes = [ctypes.c_void_p]
        get_dpi.restype = ctypes.c_uint
        return (get_dpi(self.form.Handle.ToInt64()) or 96) / 96

    def _fit_normal_window(self, size=None):
        work = self.Forms.Screen.FromControl(self.form).WorkingArea
        scale = self._window_scale()
        minimum = self.Size(min(round(600 * scale), work.Width), min(round(400 * scale), work.Height))
        self.form.MinimumSize = minimum
        width, height = size or (self.form.Width, self.form.Height)
        width = max(minimum.Width, min(width, work.Width))
        height = max(minimum.Height, min(height, work.Height))
        left = max(work.Left, min(self.form.Left, work.Right - width))
        top = max(work.Top, min(self.form.Top, work.Bottom - height))
        if (left, top, width, height) != (self.form.Left, self.form.Top, self.form.Width, self.form.Height):
            self.form.Bounds = self.Rectangle(left, top, width, height)

    def _restore_window_size(self):
        saved = self.manager.config.get("windowSize")
        scale = self._window_scale()
        size = (round(saved["width"] * scale), round(saved["height"] * scale)) if saved else None
        self._fit_normal_window(size)
        self._remember_window_size()
        if saved is None or saved["maximized"]:
            self.form.WindowState = self.Forms.FormWindowState.Maximized
            self._remember_window_size()

    def _update_maximized_bounds(self, *_):
        if not self.custom_chrome or self.form.WindowState != self.Forms.FormWindowState.Normal:
            return
        screen = self.Forms.Screen.FromControl(self.form)
        work, monitor = screen.WorkingArea, screen.Bounds
        bounds = self.form.Bounds
        client = self.form.RectangleToScreen(self.form.ClientRectangle)
        left, top = client.Left - bounds.Left, client.Top - bounds.Top
        right, bottom = bounds.Right - client.Right, bounds.Bottom - client.Bottom
        self.form.MaximizedBounds = self.Rectangle(work.Left - monitor.Left - left,
            work.Top - monitor.Top - top, work.Width + left + right, work.Height + top + bottom)

    def _configure_chrome(self, settings):
        # Keep native resize and system-menu styles; WebView2 handles CSS drag regions.
        user = ctypes.WinDLL("user32", use_last_error=True)
        user.GetWindowLongW.argtypes = [ctypes.c_void_p, ctypes.c_int]
        user.GetWindowLongW.restype = ctypes.c_int32
        user.SetWindowLongW.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int32]
        user.SetWindowLongW.restype = ctypes.c_int32
        user.SetWindowPos.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_int,
                                     ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_uint]
        user.SetWindowPos.restype = ctypes.c_int
        handle = self.form.Handle.ToInt64()
        style = user.GetWindowLongW(handle, -16)
        border_style, bounds = self.form.FormBorderStyle, self.form.Bounds
        try:
            settings.IsNonClientRegionSupportEnabled = True
            # WinForms must also use full-client sizing when restoring the window.
            self.form.FormBorderStyle = getattr(self.Forms.FormBorderStyle, "None")
            self._install_frame(handle, user)
            ctypes.set_last_error(0)
            old = user.SetWindowLongW(handle, -16, style & ~0x00C00000)
            if not old and ctypes.get_last_error():
                raise ctypes.WinError(ctypes.get_last_error())
            if not user.SetWindowPos(handle, None, 0, 0, 0, 0, 0x0037):
                raise ctypes.WinError(ctypes.get_last_error())
            self.form.Bounds = bounds
            self.custom_chrome = True
            self._update_maximized_bounds()
            with contextlib.suppress(Exception):
                border = ctypes.c_uint32(0xFFFFFFFE)
                set_attribute = ctypes.WinDLL("dwmapi").DwmSetWindowAttribute
                set_attribute.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_void_p, ctypes.c_uint]
                set_attribute(handle, 34, ctypes.byref(border), ctypes.sizeof(border))
        except Exception:
            if self.frame_cursor_hook:
                user.UnhookWindowsHookEx(self.frame_cursor_hook)
                self.frame_cursor_hook = None
            if self.frame_callback is not None:
                for frame_handle in tuple(self.frame_handles):
                    self.frame_api.RemoveWindowSubclass(frame_handle, self.frame_callback, 1)
                self.frame_handles.clear()
            self.form.FormBorderStyle = border_style
            user.SetWindowLongW(handle, -16, style)
            user.SetWindowPos(handle, None, 0, 0, 0, 0, 0x0037)
            self.form.Bounds = bounds
            self.custom_chrome = False

    def _install_frame(self, handle, user):
        from ctypes import wintypes

        api = ctypes.WinDLL("comctl32")
        callback_type = ctypes.WINFUNCTYPE(ctypes.c_ssize_t, ctypes.c_void_p, ctypes.c_uint,
            ctypes.c_size_t, ctypes.c_ssize_t, ctypes.c_size_t, ctypes.c_size_t)
        api.SetWindowSubclass.argtypes = [ctypes.c_void_p, callback_type, ctypes.c_size_t, ctypes.c_size_t]
        api.SetWindowSubclass.restype = ctypes.c_int
        api.RemoveWindowSubclass.argtypes = [ctypes.c_void_p, callback_type, ctypes.c_size_t]
        api.DefSubclassProc.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_size_t, ctypes.c_ssize_t]
        api.DefSubclassProc.restype = ctypes.c_ssize_t
        user.GetWindowRect.argtypes = [ctypes.c_void_p, ctypes.POINTER(wintypes.RECT)]
        user.GetDpiForWindow.argtypes = [ctypes.c_void_p]
        user.GetDpiForWindow.restype = ctypes.c_uint
        user.GetSystemMetricsForDpi.argtypes = [ctypes.c_int, ctypes.c_uint]
        user.IsZoomed.argtypes = [ctypes.c_void_p]
        user.GetCursorPos.argtypes = [ctypes.POINTER(wintypes.POINT)]
        user.LoadCursorW.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
        user.LoadCursorW.restype = ctypes.c_void_p
        user.SetCursor.argtypes = [ctypes.c_void_p]
        user.GetWindowThreadProcessId.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
        user.IsChild.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
        user.SendMessageW.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_size_t, ctypes.c_ssize_t]
        user.SendMessageW.restype = ctypes.c_ssize_t
        thread_id = user.GetWindowThreadProcessId(handle, None)

        def hit_test(x, y):
            rect = wintypes.RECT()
            if user.IsZoomed(handle) or not user.GetWindowRect(handle, ctypes.byref(rect)):
                return 0
            if not rect.left <= x < rect.right or not rect.top <= y < rect.bottom:
                return 0
            dpi = user.GetDpiForWindow(handle)
            edge = user.GetSystemMetricsForDpi(32, dpi) + user.GetSystemMetricsForDpi(92, dpi)
            column = 0 if x < rect.left + edge else 2 if x >= rect.right - edge else 1
            row = 0 if y < rect.top + edge else 2 if y >= rect.bottom - edge else 1
            return ((13, 12, 14), (10, 0, 11), (16, 15, 17))[row][column]

        def procedure(hwnd, message, wparam, lparam, identifier, data):
            try:
                if hwnd == handle and message == 0x0083:  # WM_NCCALCSIZE: the client fills the window.
                    return 0
                if message in (0x0084, 0x00A1) or hwnd == handle and message == 0x0112 and wparam == 0xF012:
                    x, y = ctypes.c_int16(lparam & 0xFFFF).value, ctypes.c_int16((lparam >> 16) & 0xFFFF).value
                    hit = hit_test(x, y)
                    if hit:
                        if message == 0x0084:
                            return hit
                        if message == 0x00A1:
                            if hwnd != handle:
                                return user.SendMessageW(handle, message, hit, lparam)
                            return api.DefSubclassProc(hwnd, message, hit, lparam)
                        # WebView2's transparent CSS drag edges forward a native move command.
                        return api.DefSubclassProc(hwnd, message, 0xF000 | (hit - 9), lparam)
                if message == 0x0020:  # WM_SETCURSOR is forwarded by the native drag regions.
                    point = wintypes.POINT()
                    if user.GetCursorPos(ctypes.byref(point)):
                        hit = hit_test(point.x, point.y)
                        if hit:
                            cursor = 32644 if hit in (10, 11) else 32645 if hit in (12, 15) else 32642 if hit in (13, 17) else 32643
                            user.SetCursor(user.LoadCursorW(None, cursor))
                            return 1
                if message == 0x0082:  # WM_NCDESTROY
                    api.RemoveWindowSubclass(hwnd, self.frame_callback, identifier)
                    self.frame_handles.discard(hwnd)
                    if hwnd == handle and self.frame_cursor_hook:
                        user.UnhookWindowsHookEx(self.frame_cursor_hook)
                        self.frame_cursor_hook = None
            except Exception:
                pass
            return api.DefSubclassProc(hwnd, message, wparam, lparam)

        self.frame_api = api
        self.frame_callback = callback_type(procedure)
        if not api.SetWindowSubclass(handle, self.frame_callback, 1, 0):
            raise OSError("The window frame could not be configured.")
        self.frame_handles.add(handle)
        hook_type = ctypes.WINFUNCTYPE(ctypes.c_ssize_t, ctypes.c_int, ctypes.c_size_t, ctypes.c_ssize_t)
        user.SetWindowsHookExW.argtypes = [ctypes.c_int, hook_type, ctypes.c_void_p, ctypes.c_uint]
        user.SetWindowsHookExW.restype = ctypes.c_void_p
        user.UnhookWindowsHookEx.argtypes = [ctypes.c_void_p]
        user.CallNextHookEx.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_size_t, ctypes.c_ssize_t]
        user.CallNextHookEx.restype = ctypes.c_ssize_t

        def attach_cursor(child):
            if (self.frame_cursor_hook and user.IsChild(handle, child) and
                    user.GetWindowThreadProcessId(child, None) == thread_id and
                    api.SetWindowSubclass(child, self.frame_callback, 1, 0)):
                self.frame_handles.add(child)

        def cursor_window_created(code, wparam, lparam):
            try:
                if code == 3:  # HCBT_CREATEWND: attach after native creation completes.
                    self.post(lambda: attach_cursor(wparam))
                elif code == 0:  # HCBT_MOVESIZE: native drag regions track layout changes.
                    attach_cursor(wparam)
            except Exception:
                pass
            return user.CallNextHookEx(None, code, wparam, lparam)

        self.frame_cursor_callback = hook_type(cursor_window_created)
        self.frame_cursor_hook = user.SetWindowsHookExW(5, self.frame_cursor_callback, None, thread_id)
        if not self.frame_cursor_hook:
            raise OSError("The window frame could not be configured.")

    def _trusted(self, uri):
        return isinstance(uri, str) and uri.partition("#")[0] == self.url

    def _document_ready(self, *_):
        if self.security_ready and self._trusted(str(self.form.webview.Source)):
            self.page_ready = True
            self.page_failed = False
            self._emit_dialog()
            self._emit_window_state()

    def _engine_failed(self, sender, args):
        if not self.page_failed and str(args.ProcessFailedKind) in {"BrowserProcessExited", "RenderProcessExited", "RenderProcessUnresponsive"}:
            self.page_ready = False
            self.page_failed = True
            if not self.exiting:
                self.post(lambda: self._message("The app window could not be opened."))

    def _web_prompt_available(self):
        try:
            return self.page_ready and self.security_ready and self._trusted(str(self.form.webview.Source))
        except Exception:
            return False

    def _emit_dialog(self):
        if self._web_prompt_available():
            try:
                self.form.webview.CoreWebView2.ExecuteScriptAsync(
                    "window.dispatchEvent(new CustomEvent('spinshare-dialog',{detail:" +
                    json.dumps(self.dialog_state()) + "}));")
                return True
            except Exception:
                self.page_ready = False
        return False

    def _open_dialog(self, kind, message):
        with self.exit_lock:
            if self.prompt is None:
                self.prompt = {"id": secrets.token_hex(16), "kind": kind, "message": message}
                self.prompt_answered = False
        self._show()
        if self._emit_dialog():
            return True
        with self.exit_lock:
            if not self.prompt_answered:
                self.prompt = None
        return False

    def _navigation(self, sender, args):
        args.Cancel = True
        try:
            uri = str(args.Uri)
            if self.security_ready and self._trusted(uri):
                args.Cancel = False
                if "#" not in uri:
                    self.page_ready = False
            elif self.security_ready and args.IsUserInitiated and not args.IsRedirected:
                self._open_external(uri)
        except Exception:
            pass

    @staticmethod
    def _deny_navigation(sender, args):
        args.Cancel = True

    def _deny_permission(self, sender, args):
        args.State = self.denied_permission

    def _new_window(self, sender, args):
        args.Handled = True
        try:
            if self.security_ready and args.IsUserInitiated:
                self._open_external(str(args.Uri))
        except Exception:
            pass

    def _open_external(self, uri):
        if self._trusted(str(self.form.webview.Source)) and external_url_allowed(uri):
            def open_link():
                with contextlib.suppress(Exception):
                    webbrowser.open(uri, new=2)
            threading.Thread(target=open_link, name="SpinShareExternalLink", daemon=True).start()

    def _make_tray(self):
        Forms = self.Forms
        from System.Drawing import Color, Pen, SolidBrush, SystemFonts

        self.Color, self.Pen, self.SolidBrush = Color, Pen, SolidBrush
        self.menu = Forms.ContextMenuStrip()
        self.menu.Font = SystemFonts.MessageBoxFont
        self.menu.BackColor = Color.FromArgb(28, 33, 36)
        self.menu.ForeColor = Color.FromArgb(224, 229, 233)
        self.menu.ShowImageMargin = self.menu.ShowCheckMargin = False
        self.menu.Renderer = Forms.ToolStripProfessionalRenderer()
        self.menu.Renderer.RenderToolStripBackground += self._draw_tray_background
        self.menu.Renderer.RenderToolStripBorder += self._draw_tray_border
        self.menu.Renderer.RenderMenuItemBackground += self._draw_tray_item
        self.open_item = Forms.ToolStripMenuItem()
        self.exit_item = Forms.ToolStripMenuItem()
        self.open_item.Click += lambda *_: self.show()
        self.exit_item.Click += lambda *_: self.request_exit()
        self.menu.Items.Add(self.open_item)
        self.menu.Items.Add(self.exit_item)
        self.menu.Opening += lambda *_: self.settings_changed()
        self.tray = Forms.NotifyIcon()
        self.tray.Icon = self.form.Icon
        self.tray.ContextMenuStrip = self.menu
        self.tray.DoubleClick += lambda *_: self.show()
        self.tray.Visible = True
        self.timer = Forms.Timer()
        self.timer.Interval = 1500
        self.timer.Tick += self._check_tray
        self._refresh_labels()

    def _draw_tray_background(self, sender, args):
        args.Graphics.Clear(self.menu.BackColor)

    def _draw_tray_border(self, sender, args):
        pen = self.Pen(self.Color.FromArgb(68, 77, 83))
        try:
            args.Graphics.DrawRectangle(pen, 0, 0, self.menu.Width - 1, self.menu.Height - 1)
        finally:
            pen.Dispose()

    def _draw_tray_item(self, sender, args):
        color = self.Color.FromArgb(181, 29, 99) if args.Item.Selected and args.Item.Enabled else self.menu.BackColor
        brush = self.SolidBrush(color)
        try:
            args.Graphics.FillRectangle(brush, self.Rectangle(0, 0, args.Item.Width, args.Item.Height))
        finally:
            brush.Dispose()

    def _tray_registered(self):
        if self.tray is None or not self.tray.Visible:
            return False
        # NotifyIcon's Visible and added fields do not report Shell_NotifyIcon failure.
        flags = self.BindingFlags.Instance | self.BindingFlags.NonPublic
        kind = self.tray.GetType()
        window = kind.GetField("_window", flags) or kind.GetField("window", flags)
        identifier = kind.GetField("_id", flags) or kind.GetField("id", flags)
        if window is None or identifier is None:
            return False

        class IconIdentifier(ctypes.Structure):
            _fields_ = [("cbSize", ctypes.c_uint32), ("hWnd", ctypes.c_void_p),
                        ("uID", ctypes.c_uint32), ("guidItem", ctypes.c_byte * 16)]

        class Rect(ctypes.Structure):
            _fields_ = [(side, ctypes.c_int32) for side in ("left", "top", "right", "bottom")]

        native = window.GetValue(self.tray)
        request = IconIdentifier(ctypes.sizeof(IconIdentifier), native.Handle.ToInt64(), int(identifier.GetValue(self.tray)))
        rect = Rect()
        get_rect = ctypes.WinDLL("shell32").Shell_NotifyIconGetRect
        get_rect.argtypes = [ctypes.POINTER(IconIdentifier), ctypes.POINTER(Rect)]
        get_rect.restype = ctypes.c_int32
        return get_rect(ctypes.byref(request), ctypes.byref(rect)) == 0

    def _check_tray(self, *_):
        if self.form.Visible:
            return
        try:
            if not self._tray_registered():
                self._show()
                return
        except Exception:
            with contextlib.suppress(Exception):
                self._show()
            return
        with contextlib.suppress(Exception):
            if not self.exiting:
                self._flush_pending_toast()
        with contextlib.suppress(Exception):
            if not self.exiting:
                self._start_catalog_sync()

    def _start_catalog_sync(self):
        now = time.monotonic()
        with self.exit_lock:
            if (self.exiting or self.final_close or now < self.catalog_sync_due or
                    self.catalog_sync_thread is not None and self.catalog_sync_thread.is_alive()):
                return
            self.catalog_sync_due = now + CATALOG_POLL_SECONDS
            if _fullscreen_app_active() or _battery_saver_active() or _metered_network_active():
                return
            update = getattr(self.application, "check_chart_catalog_automatically", None)
            if not callable(update):
                update = getattr(getattr(self.application, "chart_cache", None), "automatic_update", None)
            if not callable(update):
                return
            self.catalog_sync_thread = threading.Thread(
                target=self._run_catalog_sync, args=(update,), name="SpinShareCatalogSync", daemon=True)
            self.catalog_sync_thread.start()

    def _run_catalog_sync(self, update):
        try:
            with contextlib.suppress(AttributeError, OSError):
                kernel = ctypes.WinDLL("kernel32")
                kernel.GetCurrentThread.restype = ctypes.c_void_p
                kernel.SetThreadPriority.argtypes = [ctypes.c_void_p, ctypes.c_int]
                kernel.SetThreadPriority(kernel.GetCurrentThread(), -1)
            result = update()
        except Exception as exc:
            result = {"attempted": True, "refreshError": _clean_notice_text(exc)}
        finally:
            with self.exit_lock:
                self.catalog_sync_thread = None
        self.notify_catalog_sync(result)

    def _notice_text(self, key):
        language = self.manager.config.get("language", "en")
        translated = self.application.catalog.get(language, {}).get(key)
        return translated or _NOTICE_TEXT.get(language, _NOTICE_TEXT["en"]).get(key, key)

    def _queue_toast(self, kind, body):
        if (self.form is None or self.form.IsDisposed or self.final_close or self.exiting or
                self.finished.is_set() or self.form.Visible):
            return
        if kind == "success":
            title = self._notice_text("Chart data updated.")
            body = self._notice_text("The latest chart catalog is ready.")
        elif kind == "error":
            title = self._notice_text("Chart data could not be updated.")
            body = body or self._notice_text("Open SpinShare Browser for details and retry.")
        else:
            title = self._notice_text("Still running in the tray.")
            body = self._notice_text("Use the tray icon to reopen it.")
        self.toast_pending = kind, title, _clean_notice_text(body)
        self._flush_pending_toast()

    def _flush_pending_toast(self):
        if self.toast_pending is None:
            return
        if self.form.Visible:
            self.toast_pending = None
            return
        if _fullscreen_app_active():
            return
        notice = self.toast_pending
        self.toast_pending = None
        try:
            self._create_toast(*notice)
        except Exception:
            # A cosmetic notification failure must never open or destabilize the app.
            self._dispose_toast()

    def _notification_screen(self):
        from System import IntPtr

        user = ctypes.WinDLL("user32")
        user.GetForegroundWindow.restype = ctypes.c_void_p
        hwnd = user.GetForegroundWindow()
        return self.Forms.Screen.FromHandle(IntPtr(hwnd)) if hwnd else self.Forms.Screen.PrimaryScreen

    @staticmethod
    def _toast_scale(handle):
        user = ctypes.WinDLL("user32")
        dpi = 96
        with contextlib.suppress(AttributeError, OSError):
            get_dpi = user.GetDpiForWindow
            get_dpi.argtypes = [ctypes.c_void_p]
            get_dpi.restype = ctypes.c_uint
            dpi = get_dpi(handle) or 96
        return dpi / 96

    @staticmethod
    def _position_toast(handle, left, top, width=0, height=0, *, show=False):
        user = ctypes.WinDLL("user32")
        user.SetWindowPos.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_int, ctypes.c_int,
                                      ctypes.c_int, ctypes.c_int, ctypes.c_uint32]
        user.ShowWindow.argtypes = [ctypes.c_void_p, ctypes.c_int]
        flags = 0x10 | (0 if width and height else 0x1) | (0x40 if show else 0)
        if not user.SetWindowPos(handle, ctypes.c_void_p(-1), left, top, width, height, flags):
            raise OSError("The notification window could not be positioned.")
        if show:
            user.ShowWindow(handle, 4)  # SW_SHOWNOACTIVATE

    @staticmethod
    def _set_toast_window_style(handle):
        user = ctypes.WinDLL("user32")
        get_style = getattr(user, "GetWindowLongPtrW", user.GetWindowLongW)
        set_style = getattr(user, "SetWindowLongPtrW", user.SetWindowLongW)
        get_style.argtypes = [ctypes.c_void_p, ctypes.c_int]
        get_style.restype = ctypes.c_ssize_t
        set_style.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_ssize_t]
        set_style.restype = ctypes.c_ssize_t
        style = get_style(handle, -20)
        set_style(handle, -20, style | 0x80 | 0x08000000)  # tool window + no activate
        if get_style(handle, -20) & 0x08000080 != 0x08000080:
            raise OSError("The notification window could not be made non-activating.")
        with contextlib.suppress(AttributeError, OSError):
            rounded = ctypes.c_int(1)  # Keep the flush right and bottom edges square on Windows 11.
            set_attribute = ctypes.WinDLL("dwmapi").DwmSetWindowAttribute
            set_attribute.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_void_p, ctypes.c_uint32]
            set_attribute(handle, 33, ctypes.byref(rounded), ctypes.sizeof(rounded))

    def _create_toast(self, kind, title, body):
        from System.Drawing import Color, Font, FontStyle, Icon, Pen, Rectangle, Size, SolidBrush
        from System.Drawing.Drawing2D import SmoothingMode

        self._dispose_toast()
        screen = self._notification_screen()
        work = screen.WorkingArea
        form = self.Forms.Form()
        self.toast_form = form
        form.Text = TITLE
        form.FormBorderStyle = getattr(self.Forms.FormBorderStyle, "None")
        form.StartPosition = self.Forms.FormStartPosition.Manual
        form.ShowInTaskbar = False
        form.ControlBox = False
        form.AutoScaleMode = getattr(self.Forms.AutoScaleMode, "None")
        form.BackColor = Color.FromArgb(17, 23, 25)
        form.Bounds = Rectangle(work.Left, work.Top, 1, 1)
        handle = form.Handle.ToInt64()
        self._set_toast_window_style(handle)
        scale = self._toast_scale(handle)
        icon_size = round(17 * scale)
        icon_top = round(8 * scale)
        self.toast_fonts = (Font("Segoe UI Semibold", 9.0, FontStyle.Regular),
                            Font("Segoe UI Semibold", 11.0, FontStyle.Regular))
        text_flags = (self.Forms.TextFormatFlags.SingleLine | self.Forms.TextFormatFlags.VerticalCenter |
                      self.Forms.TextFormatFlags.EndEllipsis | self.Forms.TextFormatFlags.NoPrefix |
                      self.Forms.TextFormatFlags.NoPadding)
        measure_flags = (self.Forms.TextFormatFlags.SingleLine | self.Forms.TextFormatFlags.NoPrefix |
                         self.Forms.TextFormatFlags.NoPadding)
        graphics = form.CreateGraphics()
        try:
            proposed = Size(32767, 32767)
            brand_text_width = self.Forms.TextRenderer.MeasureText(
                graphics, TITLE, self.toast_fonts[0], proposed, measure_flags).Width
            status_text_width = self.Forms.TextRenderer.MeasureText(
                graphics, title, self.toast_fonts[1], proposed, measure_flags).Width
        finally:
            graphics.Dispose()
        measured_width = _toast_width(work.Width, scale, brand_text_width, status_text_width)
        left, rest_top, width, height = _toast_geometry(work, scale, measured_width)
        (icon_left, text_left, brand_draw_width, dot_left,
         status_left, status_draw_width) = _toast_layout(
             width, scale, brand_text_width, status_text_width)
        self._position_toast(handle, left, rest_top, width, height)
        form.Opacity = 0.0
        form.Cursor = self.Forms.Cursors.Hand
        form.AccessibleName = title
        form.AccessibleDescription = title

        accent = Color.FromArgb(111, 188, 147) if kind == "success" else (
            Color.FromArgb(213, 143, 84) if kind == "error" else Color.FromArgb(119, 137, 146))

        with contextlib.suppress(Exception):
            # Select a larger ICO frame and downsample it at paint time.  This avoids
            # enlarging a 16/20 px frame on scaled displays.
            source_icon_size = min(128, max(32, round(icon_size * 1.5)))
            self.toast_icon = Icon(str(_icon_path()), Size(source_icon_size, source_icon_size))

        def paint(sender, args):
            border = Pen(Color.FromArgb(43, 54, 59), max(1, round(scale)))
            marker = SolidBrush(accent)
            try:
                args.Graphics.DrawRectangle(border, 0, 0, sender.ClientSize.Width - 1, sender.ClientSize.Height - 1)
                if self.toast_icon is not None:
                    args.Graphics.DrawIcon(self.toast_icon, Rectangle(icon_left, icon_top, icon_size, icon_size))
                self.Forms.TextRenderer.DrawText(
                    args.Graphics, TITLE, self.toast_fonts[0],
                    Rectangle(text_left, round(6 * scale), brand_draw_width, round(21 * scale)),
                    Color.FromArgb(169, 180, 185), text_flags)
                self.Forms.TextRenderer.DrawText(
                    args.Graphics, title, self.toast_fonts[1],
                    Rectangle(status_left, round(30 * scale), status_draw_width, round(21 * scale)),
                    Color.FromArgb(238, 242, 243), text_flags)
                dot_size = max(5, round(6 * scale))
                dot_top = round(13 * scale)
                smoothing = args.Graphics.SmoothingMode
                args.Graphics.SmoothingMode = SmoothingMode.AntiAlias
                try:
                    args.Graphics.FillEllipse(marker, dot_left, dot_top, dot_size, dot_size)
                finally:
                    args.Graphics.SmoothingMode = smoothing
            finally:
                border.Dispose()
                marker.Dispose()

        form.Paint += paint
        def clicked(sender, args):
            if args.Button == self.Forms.MouseButtons.Left:
                self._dismiss_toast(open_app=True)

        form.MouseUp += clicked

        self.toast_phase = "enter" if _client_animations_enabled() else "hold"
        self.toast_phase_started = time.monotonic()
        self.toast_deadline = self.toast_phase_started + TOAST_HOLD_SECONDS
        self.toast_last_tick = self.toast_phase_started
        # WinForms Form.Show() rewrites the extended style and activates the HWND.
        # Reassert the style after all managed properties, then show only through
        # Win32's explicit no-activate path.
        self._set_toast_window_style(handle)
        self._position_toast(handle, left, rest_top, width, height, show=True)
        if self.toast_phase == "hold":
            form.Opacity = 1.0
            form.Invalidate()
            form.Update()
        if self.toast_timer is None:
            self.toast_timer = self.Forms.Timer()
            self.toast_timer.Tick += self._animate_toast
        self.toast_timer.Interval = 16 if self.toast_phase == "enter" else 100
        self.toast_timer.Start()

    def _animate_toast(self, *_):
        form = self.toast_form
        if form is None or form.IsDisposed:
            self._dispose_toast()
            return
        now = time.monotonic()
        if self.toast_phase == "enter":
            progress = min(1.0, (now - self.toast_phase_started) / TOAST_ENTER_SECONDS)
            eased = progress * progress * (3 - 2 * progress)
            form.Opacity = eased
            if progress >= 1:
                # Opacity 1 removes WinForms' layered-window path, allowing GDI
                # ClearType text for the entire steady state.
                form.Opacity = 1.0
                form.Invalidate()
                form.Update()
                self.toast_phase = "hold"
                self.toast_deadline = now + TOAST_HOLD_SECONDS
                self.toast_timer.Interval = 100
        elif self.toast_phase == "hold":
            with contextlib.suppress(Exception):
                if form.ClientRectangle.Contains(form.PointToClient(self.Forms.Cursor.Position)):
                    self.toast_deadline += now - self.toast_last_tick
            if now >= self.toast_deadline:
                if _client_animations_enabled():
                    self.toast_phase = "exit"
                    self.toast_phase_started = now
                    self.toast_timer.Interval = 16
                else:
                    self._dispose_toast()
                    return
        else:
            progress = min(1.0, (now - self.toast_phase_started) / TOAST_EXIT_SECONDS)
            eased = progress * progress * (3 - 2 * progress)
            form.Opacity = 1 - eased
            if progress >= 1:
                self._dispose_toast()
                return
        self.toast_last_tick = now

    def _dispose_toast(self):
        if self.toast_timer is not None:
            self.toast_timer.Stop()
        form, self.toast_form = self.toast_form, None
        fonts, self.toast_fonts = self.toast_fonts, ()
        icon, self.toast_icon = self.toast_icon, None
        self.toast_phase = None
        if form is not None:
            with contextlib.suppress(Exception):
                form.Dispose()
        for font in fonts:
            with contextlib.suppress(Exception):
                font.Dispose()
        if icon is not None:
            with contextlib.suppress(Exception):
                icon.Dispose()

    def _dismiss_toast(self, open_app=False):
        self.toast_pending = None
        self._dispose_toast()
        if open_app:
            self.show()

    def _refresh_labels(self):
        if self.menu is not None:
            self.open_item.Text = self.text("Open SpinShare Browser")
            self.exit_item.Text = self.text("Quit app")
            self.exit_item.Enabled = not self.exiting or self.exit_failed
        if self.tray is not None:
            self.tray.Text = (TITLE + (" - " + self.text("Waiting for tasks to finish") if self.exiting else ""))[:63]

    def _show(self):
        self.show_requested = False
        if self.form is None or self.form.IsDisposed or self.final_close or self.finished.is_set():
            return
        if self.timer is not None:
            self.timer.Stop()
        self.toast_pending = None
        self._dispose_toast()
        self.form.Show()
        if self.form.WindowState == self.Forms.FormWindowState.Minimized:
            self.form.WindowState = self.Forms.FormWindowState.Maximized if self.maximized else self.Forms.FormWindowState.Normal
        if self.form.WindowState == self.Forms.FormWindowState.Normal:
            with contextlib.suppress(Exception):
                self._fit_normal_window()
        self.form.Activate()
        if self.dialog is not None:
            self.dialog.Activate()
        self._emit_window_state()

    def _hide_to_tray(self, remember=False):
        if self.picker_open or self.dialog is not None or self.prompt is not None:
            self._show()
            return
        if not self._tray_registered():
            self._show()
            self._message("The tray icon is unavailable. The window will stay open.")
            return
        if remember:
            self.manager.update_close_behavior("tray")
        show_notice = not self.manager.config.get("trayNoticeShown", False)
        if show_notice:
            self.manager.mark_tray_notice()
        self.form.Hide()
        self.timer.Start()
        if show_notice:
            self._queue_toast("info", self.text(
                "SpinShare Browser is still running. Use the tray icon to reopen it."))

    def _closing(self):
        if self.final_close:
            return True
        if self.exit_failed:
            self.request_exit()
        elif self.exiting:
            self.show()
        elif self.manager.config.get("closeBehavior", "ask") == "tray":
            self.post(self._hide_to_tray)
        elif self.manager.config.get("closeBehavior", "ask") == "exit":
            self.request_exit()
        else:
            self.post(self._request_close)
        return False

    def _request_close(self):
        if self.exiting or self.picker_open or self.dialog is not None:
            self._show()
            return
        with self.exit_lock:
            pending = self.prompt is not None and (self.prompt_answered or self._web_prompt_available())
            if not pending:
                self.prompt = None
        if pending:
            self._show()
            self._emit_dialog()
            return
        if self._web_prompt_available() and self._open_dialog("close", "Choose what happens when you close the window."):
            return
        Forms = self.Forms
        exit_text = "Exit after tasks finish" if self.manager.active_count() else "Quit app"
        dialog = _native_prompt(self.text("Choose what happens when you close the window."),
            [(self.text("Keep running"), Forms.DialogResult.Cancel),
             (self.text("Minimize to system tray"), Forms.DialogResult.No),
             (self.text(exit_text), Forms.DialogResult.Yes)], self.form.Icon)
        self.dialog = dialog
        try:
            self._show()
            result = dialog.ShowDialog(self.form)
        finally:
            self.dialog = None
            dialog.Dispose()
        if result in (Forms.DialogResult.Yes, Forms.DialogResult.No):
            self._apply_close_choice("exit" if result == Forms.DialogResult.Yes else "tray", False)

    def _apply_close_choice(self, action, remember):
        try:
            if action == "tray":
                self._hide_to_tray(remember)
            else:
                if remember:
                    self.manager.update_close_behavior("exit")
                self._start_exit()
        except Exception:
            self._message("Settings could not be saved. Please try again.")

    def _message(self, key):
        self._show()
        if self.dialog is not None:
            return
        if self._web_prompt_available() and self._open_dialog("message", key):
            return
        dialog = _native_prompt(self.text(key), [(self.text("OK"), self.Forms.DialogResult.Cancel)], self.form.Icon)
        self.dialog = dialog
        try:
            dialog.ShowDialog(self.form)
        finally:
            self.dialog = None
            dialog.Dispose()

    def _confirm_wait(self):
        Forms = self.Forms
        dialog = _native_prompt(self.text("Downloads or installations are still running."),
            [(self.text("Keep running"), Forms.DialogResult.Cancel),
             (self.text("Exit after tasks finish"), Forms.DialogResult.OK)], self.form.Icon)
        self.dialog = dialog
        try:
            return dialog.ShowDialog(self.form) == Forms.DialogResult.OK
        finally:
            self.dialog = None
            dialog.Dispose()

    def _request_exit(self):
        self.exit_requested = False
        if self.picker_open or self.dialog is not None:
            self._show()
            return
        if self.exit_failed:
            with self.exit_lock:
                self.prompt = None
                self.prompt_answered = False
            self._emit_dialog()
            self._start_exit()
            return
        if self.exiting:
            self._show()
            return
        with self.exit_lock:
            pending = self.prompt is not None and (self.prompt_answered or
                self.prompt["kind"] == "exit" and self._web_prompt_available())
            if not pending:
                self.prompt = None
        if pending:
            self._show()
            self._emit_dialog()
            return
        if self.close_if_idle():
            return
        self._show()
        if self._web_prompt_available() and self._open_dialog("exit", "Downloads or installations are still running."):
            return
        if self._confirm_wait():
            self._start_exit()

    def _start_exit(self):
        with self.exit_lock:
            if self.exit_thread is not None:
                return
            self.manager.begin_exit()
            self.exiting = True
            self.exit_failed = False
            self.exit_thread = threading.Thread(target=self._finish_exit, name="SpinShareExit")
            self.exit_thread.start()
        self.post(self._stop_background_ui)
        self.activity_changed()

    def _stop_background_ui(self):
        if self.timer is not None:
            with contextlib.suppress(Exception):
                self.timer.Stop()
        self.toast_pending = None
        with contextlib.suppress(Exception):
            self._dispose_toast()

    def _finish_exit(self):
        try:
            self.manager.work.join()
            # The catalog refresh is low-priority daemon work and may be waiting on
            # the network.  It must never hold an explicit app exit open.
            if self.security_ready and self.window_size is not None:
                with contextlib.suppress(Exception):
                    self.manager.update_window_size(dict(self.window_size))
            self.application.close()
            self.finished.set()
            self.post(self._destroy)
        except Exception:
            with self.exit_lock:
                self.exit_thread = None
                self.exit_failed = True
            self.activity_changed()
            self.post(lambda: self._message("The app could not exit. Please try again."))

    def _destroy(self):
        self.final_close = True
        self.toast_pending = None
        self._dispose_toast()
        for component in (self.toast_timer, self.timer, self.tray, self.menu):
            if component is not None:
                with contextlib.suppress(Exception):
                    component.Dispose()
        self.form.Close()

    def _startup_failed(self):
        self.error = "The app window could not be opened."
        self.security_ready = False
        self.page_ready = False
        self._start_exit()


def run(application):
    import webview
    from webview.errors import WebViewException

    try:
        user = ctypes.WinDLL("user32", use_last_error=True)
        user.SetProcessDpiAwarenessContext.argtypes = [ctypes.c_void_p]
        user.SetProcessDpiAwarenessContext.restype = ctypes.c_int
        user.SetProcessDpiAwarenessContext(-4)
    except (AttributeError, OSError):
        pass
    desktop = Desktop(application, webview)
    application.desktop = desktop
    webview.settings["ALLOW_FILE_URLS"] = False
    webview.settings["ALLOW_DOWNLOADS"] = False
    webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"] = False
    webview.settings["IGNORE_SSL_ERRORS"] = False
    webview.settings["REMOTE_DEBUGGING_PORT"] = None
    desktop.window = webview.create_window(TITLE, html="<!doctype html><html></html>",
        width=1320, height=860, min_size=(600, 400), background_color="#22272a", hidden=True)
    desktop.window.events.initialized += desktop._renderer
    desktop.window.events.before_show += desktop._before_show
    desktop.window.events.closing += desktop._closing
    desktop.server_thread = threading.Thread(target=application.serve_forever, name="SpinShareLocalAPI", daemon=True)
    desktop.server_thread.start()
    try:
        webview.start(gui="edgechromium", debug=False, http_server=False, private_mode=False,
                      storage_path=str(application.webview_directory), icon=str(_icon_path()))
    except WebViewException as exc:
        raise RuntimeError(desktop.text(desktop.error or "The app window could not be opened.")) from exc
    finally:
        desktop.exiting = True
        application.manager.begin_exit()
        application.manager.work.join()
        application.close()
        desktop.server_thread.join(5)
    if desktop.error:
        raise RuntimeError(desktop.text(desktop.error))
