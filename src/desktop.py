"""Windows window and notification area for SpinShare Browser."""
from __future__ import annotations

import concurrent.futures
import contextlib
import ctypes
import json
from pathlib import Path
import secrets
import sys
import threading
from urllib.parse import urlsplit
import webbrowser


TITLE = "SpinShare Browser"


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
    if not isinstance(value, str) or len(value) > 8192 or "\\" in value or any(ord(char) <= 32 for char in value):
        return False
    try:
        parsed = urlsplit(value)
        return parsed.scheme == "https" and parsed.netloc.lower() == "spinsha.re"
    except ValueError:
        return False


class Desktop:
    def __init__(self, application, webview):
        self.application = application
        self.manager = application.manager
        self.webview = webview
        self.url = application.origin + application.ui_path
        self.window = self.form = self.tray = self.menu = self.timer = None
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
        self.tray.BalloonTipClicked += lambda *_: self.show()
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
        try:
            if not self.form.Visible and not self._tray_registered():
                self._show()
        except Exception:
            with contextlib.suppress(Exception):
                self._show()

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
        if not self.manager.config.get("trayNoticeShown", False):
            with contextlib.suppress(Exception):
                self.tray.ShowBalloonTip(3000, TITLE,
                    self.text("SpinShare Browser is still running. Use the tray icon to reopen it."), self.Forms.ToolTipIcon.Info)
            self.manager.mark_tray_notice()
        self.form.Hide()
        self.timer.Start()

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
        self.activity_changed()

    def _finish_exit(self):
        try:
            self.manager.work.join()
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
        for component in (self.timer, self.tray, self.menu):
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
