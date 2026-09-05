"""Windows launcher, local API and settings for SpinShare Browser."""
from __future__ import annotations

import argparse
import contextlib
import ctypes
import hashlib
import hmac
import http.client
import http.server
import json
import os
from pathlib import Path, PureWindowsPath
import re
import secrets
import stat
import sys
import tempfile
import threading
import time

import installer
import audio_preview

VERSION = "2.0.1"
HOST = "127.0.0.1"
CONFIG_NAME = "config.json"
PAGE_NAME = "browser.html"
RUNTIME_NAME = "runtime.json"
CONFIG_DEFAULTS = {"language": "zh-CN", "closeBehavior": "ask", "trayNoticeShown": False,
                   "playerShortcutHintShown": False, "installDirectoryConfirmed": False,
                   "windowSize": None}
CONFIG_FIELDS = {"schemaVersion", "token", "customDirectory", "revision", *CONFIG_DEFAULTS}
LANGUAGES = {"zh-CN", "en"}
CLOSE_BEHAVIORS = {"ask", "exit", "tray"}
CATALOG_NAME = "locales.json"
TEMPLATE_NAME = "index.html"
RUNTIME_FIELDS = {"schemaVersion", "port", "pid", "instanceId", "signature"}
RE_HEX32 = re.compile(r"[a-f0-9]{32}")
RE_HEX64 = re.compile(r"[a-f0-9]{64}")
MAX_SETTINGS_BYTES = 16384
MAX_REQUEST_HISTORY = 65536
MAX_CHART_BYTES = 32 * 1024 * 1024
INSTALLATION_INDEX_MAX_DIRECTORY_ENTRIES = 65536
INSTALLATION_INDEX_MAX_ENTRIES = 4096
INSTALLATION_INDEX_MAX_BYTES = 512 * 1024 * 1024
INSTALLATION_INDEX_TIMEOUT_SECONDS = 8
CHART_CACHE_NAME = "charts-cache.json"
MAX_CHART_CACHE_BYTES = MAX_CHART_BYTES + MAX_SETTINGS_BYTES
CHART_REFRESH_INTERVAL_MS = 10 * 60 * 1000
CHART_FRESH_INTERVAL_MS = 12 * 60 * 60 * 1000
CHART_AUTOMATIC_BACKOFF_MS = (5 * 60 * 1000, 15 * 60 * 1000, 60 * 60 * 1000, 6 * 60 * 60 * 1000)


class PortableError(installer.InstallError):
    pass


class APIError(PortableError):
    def __init__(self, status, code, message, **details):
        super().__init__(message)
        self.status = status
        self.code = code
        self.details = details


class ChartFetchError(PortableError):
    """A classified remote-catalog failure safe to expose through the local API."""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def web_resource_path(name):
    """Find project resources in source runs and bundled resources when frozen."""
    root = Path(sys._MEIPASS) if getattr(sys, "frozen", False) else Path(__file__).resolve().parent.parent
    return root / "web" / name


def default_state_directory():
    if os.name == "nt":
        base = installer.known_folder_path("F1B32785-6FBA-4FCF-9D55-7B8E7F157091")
    else:
        base = Path.home() / ".local" / "share"
    return base / "SpinShareBrowser"


def valid_window_size(value):
    return value is None or (isinstance(value, dict) and set(value) == {"width", "height", "maximized"} and
        type(value["width"]) is int and 1 <= value["width"] <= 32768 and
        type(value["height"]) is int and 1 <= value["height"] <= 32768 and
        type(value["maximized"]) is bool)


def _directory_syntax(value):
    """Validate before pathlib can erase '..', trailing dots or device syntax."""
    if not isinstance(value, (str, os.PathLike)):
        raise PortableError("The directory must be a local absolute path.")
    raw = os.fspath(value)
    if not isinstance(raw, str) or not raw or len(raw) > 4096 or "\x00" in raw:
        raise PortableError("The directory is empty, too long, or contains unsafe characters.")
    if os.name == "nt":
        if not re.match(r"^[A-Za-z]:[\\/]", raw) or raw.startswith(("\\", "/")):
            raise PortableError("Select an absolute local path; relative, network, and device paths are unsupported.")
        parts = re.split(r"[\\/]", raw[3:])
        while parts and parts[-1] == "":
            parts.pop()
        if not parts:
            raise PortableError("A drive root cannot be an installation or settings directory.")
        for part in parts:
            if (part in {"", ".", ".."} or part.endswith((" ", ".")) or
                    any(ord(char) < 32 or char in '<>:"|?*' for char in part) or
                    re.match(r"^(CON|PRN|AUX|NUL|COM[1-9\u00b9\u00b2\u00b3]|LPT[1-9\u00b9\u00b2\u00b3])(?:\.|$)", part, re.I)):
                raise PortableError("The directory contains traversal, a device name, or an unsafe Windows path.")
        path = Path(str(PureWindowsPath(raw)))
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.GetDriveTypeW.argtypes = [ctypes.c_wchar_p]
        kernel.GetDriveTypeW.restype = ctypes.c_uint
        drive_type = kernel.GetDriveTypeW(path.anchor)
        if drive_type in {0, 1, 4, 5}:
            raise PortableError("Select an available local disk.")
    else:
        if not raw.startswith("/") or raw.startswith("//") or "\\" in raw or any(part in {".", ".."} for part in raw.split("/")):
            raise PortableError("The directory must be a local absolute path without parent traversal.")
        path = Path(raw)
        if path == Path(path.anchor):
            raise PortableError("A filesystem root cannot be used.")
    return path


def _safe_info(path, *, directory):
    info = path.lstat()
    if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
        raise PortableError("The path contains a symbolic link or Windows reparse point.")
    if directory:
        if not stat.S_ISDIR(info.st_mode):
            raise PortableError("A directory ancestor is not an ordinary directory.")
    elif not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        raise PortableError("The settings or page file has an unsafe type or hard links.")
    return info


def validate_directory(value):
    """Check an install path without creating any game files or directories."""
    path = _directory_syntax(value)
    current = Path(path.anchor)
    _safe_info(current, directory=True)
    for part in path.parts[1:]:
        current /= part
        if os.path.lexists(current):
            _safe_info(current, directory=True)
    if os.path.normcase(str(path.resolve(strict=False))) != os.path.normcase(str(path)):
        raise PortableError("The directory resolves to a different location.")
    return path


def choose_directory(initial_directory, title, *, owner_handle=None):
    """Open the Windows folder dialog on the current request thread."""
    if os.name != "nt":
        raise OSError("The folder dialog requires Windows.")
    import uuid

    pointer = ctypes.c_void_p
    ole = ctypes.WinDLL("ole32")
    shell = ctypes.WinDLL("shell32")
    user = ctypes.WinDLL("user32")
    user.GetForegroundWindow.argtypes = []
    user.GetForegroundWindow.restype = pointer
    user.GetAncestor.argtypes = [pointer, ctypes.c_uint]
    user.GetAncestor.restype = pointer
    user.GetWindowTextW.argtypes = [pointer, ctypes.c_wchar_p, ctypes.c_int]
    user.GetWindowTextW.restype = ctypes.c_int
    user.SetForegroundWindow.argtypes = [pointer]
    user.SetForegroundWindow.restype = ctypes.c_int
    user.SetWindowPos.argtypes = [pointer, pointer, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_uint]
    user.SetWindowPos.restype = ctypes.c_int
    event_callback = ctypes.WINFUNCTYPE(None, pointer, ctypes.c_uint32, pointer,
                                       ctypes.c_long, ctypes.c_long, ctypes.c_uint32, ctypes.c_uint32)
    user.SetWinEventHook.argtypes = [ctypes.c_uint32, ctypes.c_uint32, pointer, event_callback,
                                    ctypes.c_uint32, ctypes.c_uint32, ctypes.c_uint32]
    user.SetWinEventHook.restype = pointer
    user.UnhookWinEvent.argtypes = [pointer]
    user.UnhookWinEvent.restype = ctypes.c_int
    set_thread_dpi = getattr(user, "SetThreadDpiAwarenessContext", None)
    if set_thread_dpi:
        set_thread_dpi.argtypes = [pointer]
        set_thread_dpi.restype = pointer
    foreground, raised, hook = user.GetForegroundWindow(), False, None

    @event_callback
    def foreground_dialog(event_hook, event, window, object_id, child_id, thread_id, event_time):
        nonlocal raised
        if raised or not window or object_id or child_id or user.GetAncestor(window, 2) != window:
            return
        caption = ctypes.create_unicode_buffer(len(title) + 1)
        user.GetWindowTextW(window, caption, len(caption))
        if caption.value != title:
            return
        raised = True
        if user.GetForegroundWindow() not in (foreground, window):
            return
        # Keep the picker visible even when Windows denies foreground activation.
        user.SetWindowPos(window, -1, 0, 0, 0, 0, 0x13)  # HWND_TOPMOST, NOSIZE | NOMOVE | NOACTIVATE
        user.SetForegroundWindow(window)

    ole.CoInitializeEx.argtypes = [pointer, ctypes.c_uint32]
    ole.CoInitializeEx.restype = ctypes.c_long
    ole.CoUninitialize.argtypes = []
    ole.CoUninitialize.restype = None
    ole.CoCreateInstance.argtypes = [pointer, pointer, ctypes.c_uint32, pointer, ctypes.POINTER(pointer)]
    ole.CoCreateInstance.restype = ctypes.c_long
    ole.CoTaskMemFree.argtypes = [pointer]
    ole.CoTaskMemFree.restype = None
    shell.SHCreateItemFromParsingName.argtypes = [ctypes.c_wchar_p, pointer, pointer, ctypes.POINTER(pointer)]
    shell.SHCreateItemFromParsingName.restype = ctypes.c_long

    def guid(value):
        return (ctypes.c_ubyte * 16).from_buffer_copy(uuid.UUID(value).bytes_le)

    def method(instance, index, result, *arguments):
        table = ctypes.cast(instance, ctypes.POINTER(ctypes.POINTER(pointer))).contents
        return ctypes.WINFUNCTYPE(result, pointer, *arguments)(table[index])

    def check(result):
        if result < 0:
            raise OSError("Windows could not open the folder dialog (0x%08X)." % (result & 0xFFFFFFFF))

    dialog, initial, selected, path_text = pointer(), pointer(), pointer(), pointer()
    previous_dpi, initialized = None, False
    try:
        if set_thread_dpi:
            previous_dpi = set_thread_dpi(-4) or set_thread_dpi(-3)  # Per-monitor V2, then V1.
        check(ole.CoInitializeEx(None, 2))  # COINIT_APARTMENTTHREADED
        initialized = True
        check(ole.CoCreateInstance(guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7"), None, 1,
                                   guid("D57C7288-D4AD-4768-BE02-9D969532D960"), ctypes.byref(dialog)))
        options = ctypes.c_uint32()
        check(method(dialog, 10, ctypes.c_long, ctypes.POINTER(ctypes.c_uint32))(dialog, ctypes.byref(options)))
        # FOS_PICKFOLDERS, FOS_FORCEFILESYSTEM and FOS_DONTADDTORECENT.
        check(method(dialog, 9, ctypes.c_long, ctypes.c_uint32)(dialog, options.value | 0x20 | 0x40 | 0x02000000))
        check(method(dialog, 17, ctypes.c_long, ctypes.c_wchar_p)(dialog, title))
        folder = Path(initial_directory)
        while not folder.is_dir() and folder.parent != folder:
            folder = folder.parent
        check(shell.SHCreateItemFromParsingName(str(folder), None,
              guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), ctypes.byref(initial)))
        check(method(dialog, 12, ctypes.c_long, pointer)(dialog, initial))  # IFileDialog::SetFolder
        # Observe only windows shown by this dialog thread; no foreign owner or input attachment.
        if owner_handle is None:
            hook = user.SetWinEventHook(0x8002, 0x8002, None, foreground_dialog, os.getpid(), threading.get_native_id(), 0)
        result = method(dialog, 3, ctypes.c_long, pointer)(dialog, owner_handle)  # IModalWindow::Show
        if result & 0xFFFFFFFF == 0x800704C7:  # HRESULT_FROM_WIN32(ERROR_CANCELLED)
            return None
        check(result)
        check(method(dialog, 20, ctypes.c_long, ctypes.POINTER(pointer))(dialog, ctypes.byref(selected)))
        check(method(selected, 5, ctypes.c_long, ctypes.c_uint32, ctypes.POINTER(pointer))(
            selected, 0x80058000, ctypes.byref(path_text)))  # SIGDN_FILESYSPATH
        return Path(ctypes.wstring_at(path_text.value))
    finally:
        if hook:
            user.UnhookWinEvent(hook)
        if path_text:
            ole.CoTaskMemFree(path_text)
        for instance in (selected, initial, dialog):
            if instance:
                method(instance, 2, ctypes.c_uint32)(instance)  # IUnknown::Release
        if initialized:
            ole.CoUninitialize()
        if previous_dpi:
            set_thread_dpi(previous_dpi)


def _windows_open(path, *, directory):
    """Open state paths with pinned ancestors and reparse-point protection."""
    from ctypes import wintypes

    class FileInformation(ctypes.Structure):
        _fields_ = [("attributes", wintypes.DWORD), ("creation", wintypes.FILETIME),
                    ("access", wintypes.FILETIME), ("write", wintypes.FILETIME),
                    ("volume", wintypes.DWORD), ("sizeHigh", wintypes.DWORD),
                    ("sizeLow", wintypes.DWORD), ("links", wintypes.DWORD),
                    ("indexHigh", wintypes.DWORD), ("indexLow", wintypes.DWORD)]

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                                  ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
    kernel.CreateFileW.restype = wintypes.HANDLE
    kernel.GetFileInformationByHandle.argtypes = [wintypes.HANDLE, ctypes.POINTER(FileInformation)]
    kernel.GetFileInformationByHandle.restype = wintypes.BOOL
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.CloseHandle.restype = wintypes.BOOL
    access = 0x00000001 if directory else 0x80000000
    sharing = 3 if directory else 1  # Pin directories against rename and deletion.
    flags = 0x00200000 | (0x02000000 if directory else 0)
    handle = kernel.CreateFileW(str(path), access, sharing, None, 3, flags, None)
    if handle == ctypes.c_void_p(-1).value:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        info = FileInformation()
        if not kernel.GetFileInformationByHandle(handle, ctypes.byref(info)):
            raise ctypes.WinError(ctypes.get_last_error())
        if info.attributes & 0x400:
            raise PortableError("The path contains a Windows reparse point.")
        if bool(info.attributes & 0x10) != directory or (not directory and info.links != 1):
            raise PortableError("The settings path has an unsafe type or hard links.")
        return handle, kernel
    except BaseException:
        kernel.CloseHandle(handle)
        raise


@contextlib.contextmanager
def _directory_guard(directory, *, create=False):
    """Keep existing Windows ancestor directories pinned during state IO."""
    directory = _directory_syntax(directory)
    held = []
    try:
        current = Path(directory.anchor)
        for part in [None, *directory.parts[1:]]:
            if part is not None:
                current /= part
            if not os.path.lexists(current):
                if not create:
                    raise FileNotFoundError(str(current))
                try:
                    current.mkdir()
                except FileExistsError:
                    # Concurrent first launches still require the checks below.
                    pass
            _safe_info(current, directory=True)
            if os.name == "nt":
                held.append(_windows_open(current, directory=True))
        yield directory
    finally:
        for handle, kernel in reversed(held):
            kernel.CloseHandle(handle)


def _read_guarded_bytes(path, *, limit):
    """Read one file safely while its parent directory guard is already held."""
    path = Path(path)
    _safe_info(path, directory=False)
    if os.name == "nt":
        import msvcrt
        handle, kernel = _windows_open(path, directory=False)
        try:
            descriptor = msvcrt.open_osfhandle(handle, os.O_RDONLY | os.O_BINARY)
        except BaseException:
            kernel.CloseHandle(handle)
            raise
    else:
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(descriptor, "rb") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise PortableError("The settings or page file has an unsafe type or hard links.")
        if info.st_size > limit:
            raise PortableError("The settings or page file exceeds the size limit.")
        parts, remaining = [], limit + 1
        while remaining:
            block = stream.read(min(256 * 1024, remaining))
            if not block:
                break
            parts.append(block)
            remaining -= len(block)
        if not remaining:
            raise PortableError("The settings or page file exceeds the size limit.")
        return b"".join(parts)


def _read_bytes(path, *, limit):
    path = Path(path)
    with _directory_guard(path.parent):
        return _read_guarded_bytes(path, limit=limit)


def _atomic_write(path, data):
    path = Path(path)
    with _directory_guard(path.parent):
        if os.path.lexists(path):
            _safe_info(path, directory=False)
        temporary = contextlib.nullcontext(path.parent)
        if path.name in {CONFIG_NAME, RUNTIME_NAME, PAGE_NAME, CHART_CACHE_NAME}:
            import maintenance
            temporary = maintenance.prepare_temp_directory(path.parent)
        with temporary as temp_directory:
            descriptor, temp_name = tempfile.mkstemp(prefix=f".spinshare-{path.name}-", suffix=".tmp", dir=temp_directory)
            temp_path = Path(temp_name)
            try:
                with os.fdopen(descriptor, "wb") as stream:
                    stream.write(data)
                    stream.flush()
                    os.fsync(stream.fileno())
                    if os.fstat(stream.fileno()).st_nlink != 1:
                        raise PortableError("The temporary settings file has hard links.")
                _safe_info(temp_path, directory=False)
                if os.path.lexists(path):
                    _safe_info(path, directory=False)
                os.replace(temp_path, path)
            finally:
                if os.path.lexists(temp_path):
                    _safe_info(temp_path, directory=False)
                    temp_path.unlink()


def _remove_file(path):
    path = Path(path)
    with _directory_guard(path.parent):
        if os.path.lexists(path):
            _safe_info(path, directory=False)
            path.unlink()


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def _parse_json(raw):
    def invalid_constant(value):
        raise ValueError("invalid JSON constant")
    return json.loads(raw.decode("utf-8"), object_pairs_hook=_unique_object, parse_constant=invalid_constant)


def _json_bytes(data):
    return (json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")


class ConfigStore:
    def __init__(self, state_dir):
        self.directory = _directory_syntax(state_dir)
        with _directory_guard(self.directory, create=True):
            pass
        self.default_directory = validate_directory(installer.default_target_directory())
        self.path = self.directory / CONFIG_NAME

    def load(self, *, create=True):
        if not os.path.lexists(self.path):
            if not create:
                raise FileNotFoundError("The local instance has not written its settings yet.")
            config = {"schemaVersion": 1, "token": secrets.token_hex(32),
                      "customDirectory": None, "revision": secrets.token_hex(16), **CONFIG_DEFAULTS}
            self.save(config)
            return config
        try:
            config = _parse_json(_read_bytes(self.path, limit=MAX_SETTINGS_BYTES))
        except (ValueError, UnicodeError) as exc:
            raise PortableError("Local config.json is corrupt.") from exc
        if (isinstance(config, dict) and CONFIG_FIELDS - CONFIG_DEFAULTS.keys() <= set(config) <= CONFIG_FIELDS):
            migrated = dict(CONFIG_DEFAULTS, **config)
            if not valid_window_size(migrated["windowSize"]):
                migrated["windowSize"] = None
            if migrated != config:
                self.save(migrated)
                config = migrated
        self.validate_config(config)
        return config

    def validate_config(self, config):
        if (not isinstance(config, dict) or set(config) != CONFIG_FIELDS or
                type(config.get("schemaVersion")) is not int or config["schemaVersion"] != 1 or
                not isinstance(config.get("token"), str) or not RE_HEX64.fullmatch(config["token"]) or
                not isinstance(config.get("revision"), str) or not RE_HEX32.fullmatch(config["revision"]) or
                not isinstance(config.get("language"), str) or config["language"] not in LANGUAGES or
                not isinstance(config.get("closeBehavior"), str) or config["closeBehavior"] not in CLOSE_BEHAVIORS or
                type(config.get("trayNoticeShown")) is not bool or
                type(config.get("playerShortcutHintShown")) is not bool or
                type(config.get("installDirectoryConfirmed")) is not bool or
                not valid_window_size(config.get("windowSize")) or
                (config.get("customDirectory") is not None and not isinstance(config["customDirectory"], str))):
            raise PortableError("The local settings format is invalid.")
        validate_directory(config["customDirectory"] or self.default_directory)
        if config["customDirectory"] == "":
            raise PortableError("The saved installation directory is empty.")

    def save(self, config):
        self.validate_config(config)
        data = _json_bytes(config)
        if len(data) > MAX_SETTINGS_BYTES:
            raise PortableError("The settings exceed the size limit.")
        _atomic_write(self.path, data)

    def target_for(self, config):
        return validate_directory(config["customDirectory"] or self.default_directory)


def _fetch_chart_catalog(on_remote_attempt=None, on_cheap_rejection=None):
    """The search endpoint supplies tags/notes without visiting counted song details."""
    body = _json_bytes({"searchQuery": "", "diffEasy": True, "diffNormal": True,
                       "diffHard": True, "diffExpert": True, "diffXD": True,
                       "diffRatingFrom": 0, "diffRatingTo": 999, "showExplicit": True})
    connection = http.client.HTTPSConnection("spinsha.re", timeout=30)
    remote_attempt = False
    full_response = False
    try:
        # http.client deliberately does not follow redirects or retry requests.
        # Resolve DNS and complete TCP/TLS first. Failures here are confirmed
        # connection failures and may be retried without charging cooldown.
        connection.connect()
        if on_remote_attempt is not None:
            on_remote_attempt()
        remote_attempt = True
        connection.request("POST", "/api/searchCharts", body=body, headers={
            "Content-Type": "application/json", "Accept": "application/json",
            "Cache-Control": "no-store", "User-Agent": "SpinShareBrowser/" + VERSION})
        response = connection.getresponse()
        if response.status != 200:
            if response.status in {401, 403}:
                if on_cheap_rejection is not None:
                    on_cheap_rejection()
                remote_attempt = False
                raise ChartFetchError("charts_access_denied", "The chart server refused access.")
            if response.status == 429:
                raise ChartFetchError("charts_rate_limited", "The chart server limited the request.")
            if response.status in {408, 504}:
                raise ChartFetchError("charts_request_timeout", "The chart request timed out while waiting for a full response.")
            if response.status >= 500:
                raise ChartFetchError("charts_server_error", "The chart server is temporarily unavailable.")
            raise ChartFetchError("charts_request_rejected", "The chart server rejected the request.")
        full_response = True
        deadline = time.monotonic() + 90
        length = response.getheader("Content-Length")
        if length is not None and not re.fullmatch(r"[0-9]+", length):
            raise ChartFetchError("charts_invalid_response", "The full chart response has an invalid length.")
        if length is not None and int(length) > MAX_CHART_BYTES:
            raise ChartFetchError("charts_response_too_large", "The full chart response exceeds the size limit.")
        raw = bytearray()
        on_progress = getattr(on_remote_attempt, "progress", None)
        if on_progress is not None:
            on_progress(0, int(length) if length is not None else None)
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ChartFetchError("charts_remote_timeout", "The full chart transfer timed out.")
            if connection.sock is not None:
                connection.sock.settimeout(min(30, remaining))
            chunk = response.read1(min(65536, MAX_CHART_BYTES + 1 - len(raw)))
            if not chunk:
                break
            raw.extend(chunk)
            if on_progress is not None:
                on_progress(len(raw), int(length) if length is not None else None)
            if len(raw) > MAX_CHART_BYTES:
                raise ChartFetchError("charts_response_too_large", "The full chart response exceeds the size limit.")
        if length is not None and len(raw) != int(length):
            raise ChartFetchError("charts_response_incomplete", "The full chart response was incomplete.")
        try:
            result = _parse_json(raw)
        except (ValueError, UnicodeError, PortableError) as exc:
            raise ChartFetchError("charts_invalid_response", "The chart server returned invalid JSON.") from exc
        if (not isinstance(result, dict) or result.get("status") != 200 or
                not isinstance(result.get("data"), list) or any(not isinstance(row, dict) for row in result["data"])):
            raise ChartFetchError("charts_invalid_response", "The chart server returned an invalid catalog.")
        try:
            encoded_size = len(_json_bytes(result["data"]))
        except (ValueError, UnicodeError) as exc:
            raise ChartFetchError("charts_invalid_response", "The chart server returned an invalid catalog.") from exc
        if encoded_size > MAX_CHART_BYTES:
            raise ChartFetchError("charts_response_too_large", "The full chart response exceeds the size limit.")
        return result["data"]
    except ChartFetchError:
        raise
    except TimeoutError as exc:
        code = "charts_remote_timeout" if full_response else "charts_request_timeout" if remote_attempt else "charts_network_error"
        message = ("The full chart transfer timed out." if full_response else
                   "The chart request timed out while waiting for a full response." if remote_attempt else
                   "The chart server connection timed out.")
        raise ChartFetchError(code, message) from exc
    except (OSError, http.client.HTTPException) as exc:
        code = "charts_response_incomplete" if remote_attempt else "charts_network_error"
        message = "The chart request or response was interrupted." if remote_attempt else "The chart server could not be reached."
        raise ChartFetchError(code, message) from exc
    finally:
        connection.close()


def validate_chart_cache(value):
    legacy_fields = {"schemaVersion", "lastAttemptAt", "fetchedAt", "refreshError", "data"}
    fields = legacy_fields | {"automaticFailureCount", "automaticLastAttemptAt", "automaticNextAllowedAt",
                              "automaticRefreshError", "automaticErrorCode"}
    if (not isinstance(value, dict) or type(value.get("schemaVersion")) is not int or value["schemaVersion"] not in {1, 2, 3} or
            set(value) != (fields if value["schemaVersion"] == 3 else legacy_fields) or
            value["lastAttemptAt"] is not None and (type(value["lastAttemptAt"]) is not int or not 0 <= value["lastAttemptAt"] < 2 ** 53 - CHART_REFRESH_INTERVAL_MS) or
            value["refreshError"] is not None and (not isinstance(value["refreshError"], str) or len(value["refreshError"]) > 512) or
            (value["data"] is None) != (value["fetchedAt"] is None) or
            value["data"] is not None and (not isinstance(value["data"], list) or any(not isinstance(row, dict) for row in value["data"]) or
                type(value["fetchedAt"]) is not int or not 0 <= value["fetchedAt"] < 2 ** 53) or
            value["schemaVersion"] == 3 and (
                type(value["automaticFailureCount"]) is not int or not 0 <= value["automaticFailureCount"] <= len(CHART_AUTOMATIC_BACKOFF_MS) or
                value["automaticLastAttemptAt"] is not None and (type(value["automaticLastAttemptAt"]) is not int or not 0 <= value["automaticLastAttemptAt"] < 2 ** 53 - CHART_AUTOMATIC_BACKOFF_MS[-1]) or
                value["automaticNextAllowedAt"] is not None and (type(value["automaticNextAllowedAt"]) is not int or not 0 <= value["automaticNextAllowedAt"] < 2 ** 53) or
                value["automaticRefreshError"] is not None and (not isinstance(value["automaticRefreshError"], str) or len(value["automaticRefreshError"]) > 512) or
                value["automaticErrorCode"] is not None and (not isinstance(value["automaticErrorCode"], str) or not re.fullmatch(r"[a-z0-9_]{1,64}", value["automaticErrorCode"])) or
                (value["automaticFailureCount"] == 0) != (value["automaticNextAllowedAt"] is None) or
                value["automaticFailureCount"] > 0 and (value["automaticLastAttemptAt"] is None or
                    value["automaticNextAllowedAt"] < value["automaticLastAttemptAt"]))):
        raise PortableError("The saved chart catalog format is invalid.")
    if len(_json_bytes(value)) > MAX_CHART_CACHE_BYTES:
        raise PortableError("The saved chart catalog exceeds the size limit.")
    return value


class ChartCatalogCache:
    _UNSET = object()

    def __init__(self, state_dir):
        self.path = _directory_syntax(state_dir) / CHART_CACHE_NAME
        self.lock = threading.Lock()
        self.activity_lock = threading.Lock()
        self.state = None
        self.monotonic_until = 0
        self.automatic_monotonic_until = 0
        self._activity = {"syncing": False, "phase": "idle", "syncChannel": None,
                          "bytesReceived": 0, "contentLength": None}

    @staticmethod
    def _empty_state():
        return {"schemaVersion": 3, "lastAttemptAt": None, "fetchedAt": None, "refreshError": None, "data": None,
                "automaticFailureCount": 0, "automaticLastAttemptAt": None, "automaticNextAllowedAt": None,
                "automaticRefreshError": None, "automaticErrorCode": None}

    def _load(self):
        if self.state is not None:
            return
        if os.path.lexists(self.path):
            self.state = validate_chart_cache(_parse_json(_read_bytes(self.path, limit=MAX_CHART_CACHE_BYTES)))
        else:
            self.state = self._empty_state()
        # Schema 1 cannot distinguish a cheap connection failure from a request
        # that reached the server. Preserve its timestamp conservatively so an
        # upgrade or restart cannot shorten an unfinished cooldown.
        if self.state["schemaVersion"] < 3:
            self.state = dict(self.state, schemaVersion=3, automaticFailureCount=0, automaticLastAttemptAt=None,
                              automaticNextAllowedAt=None, automaticRefreshError=None, automaticErrorCode=None)
            with contextlib.suppress(OSError, ValueError, PortableError):
                self._save(self.state)
        attempt = self.state["lastAttemptAt"]
        remaining = 0 if attempt is None else max(0, attempt + CHART_REFRESH_INTERVAL_MS - time.time_ns() // 1000000)
        self.monotonic_until = time.monotonic_ns() + remaining * 1000000
        automatic_next = self.state["automaticNextAllowedAt"]
        automatic_remaining = 0 if automatic_next is None else max(0, automatic_next - time.time_ns() // 1000000)
        self.automatic_monotonic_until = time.monotonic_ns() + automatic_remaining * 1000000

    def _activity_snapshot(self):
        with self.activity_lock:
            return dict(self._activity)

    def _set_activity(self, channel=None, phase="idle", bytes_received=0, content_length=None):
        with self.activity_lock:
            self._activity = {"syncing": phase != "idle", "phase": phase, "syncChannel": channel,
                              "bytesReceived": bytes_received, "contentLength": content_length}

    def _progress(self, channel, received, content_length):
        self._set_activity(channel, "receiving", received, content_length)

    def _metadata(self, *, cached, attempted=False, outcome="local", changed=False, channel=None,
                  refresh_error=_UNSET, error_code=_UNSET, state=None):
        now = time.time_ns() // 1000000
        state = state or self.state or self._empty_state()
        attempt = state.get("lastAttemptAt")
        # Clock changes cannot shorten a cooldown while this process is running.
        remaining = max(0, (self.monotonic_until - time.monotonic_ns() + 999999) // 1000000,
                        0 if attempt is None else attempt + CHART_REFRESH_INTERVAL_MS - now)
        automatic_next = state.get("automaticNextAllowedAt")
        automatic_remaining = max(0, (self.automatic_monotonic_until - time.monotonic_ns() + 999999) // 1000000,
                                  0 if automatic_next is None else automatic_next - now)
        if refresh_error is self._UNSET:
            refresh_error = (state.get("automaticRefreshError") if channel == "automatic" else
                             state.get("refreshError") if channel == "manual" else
                             state.get("automaticRefreshError") or state.get("refreshError"))
        if error_code is self._UNSET:
            error_code = state.get("automaticErrorCode") if channel != "manual" else None
        fetched_at = state.get("fetchedAt")
        return {"data": state.get("data"), "cached": cached, "serverNow": now, "fetchedAt": fetched_at,
                "stale": fetched_at is None or now >= fetched_at + CHART_FRESH_INTERVAL_MS,
                "attempted": attempted, "outcome": outcome, "changed": changed,
                "lastAttemptAt": attempt, "nextAllowedAt": now + remaining,
                "retryAfterSeconds": (remaining + 999) // 1000, "refreshError": refresh_error,
                "manualRefreshError": state.get("refreshError"),
                "automaticLastAttemptAt": state.get("automaticLastAttemptAt"),
                "automaticNextAllowedAt": now + automatic_remaining,
                "automaticRetryAfterSeconds": (automatic_remaining + 999) // 1000,
                "automaticFailureCount": state.get("automaticFailureCount", 0),
                "automaticRefreshError": state.get("automaticRefreshError"),
                "errorCode": error_code, **self._activity_snapshot()}

    def _save(self, state):
        raw = _json_bytes(state)
        if len(raw) > MAX_CHART_CACHE_BYTES:
            raise PortableError("The saved chart catalog exceeds the size limit.")
        _atomic_write(self.path, raw)

    def status(self, *, include_data=True):
        acquired = self.lock.acquire(blocking=False)
        try:
            if acquired:
                try:
                    self._load()
                except (OSError, ValueError, PortableError) as exc:
                    message = "The chart cache could not be read safely. No remote request was sent."
                    raise APIError(500, "charts_cache_error", message,
                                   **self._metadata(cached=False, outcome="failed", refresh_error=message,
                                                    error_code="charts_cache_error")) from exc
            state = self.state or self._empty_state()
            result = self._metadata(cached=state["data"] is not None, state=state)
            if not include_data:
                result.pop("data")
            return result
        finally:
            if acquired:
                self.lock.release()

    def get(self):
        """Backward-compatible alias for an explicit foreground update."""
        return self.manual_update()

    def manual_update(self):
        # The launcher already holds the per-directory process lock. This lock
        # coalesces foreground and background callers during a fetch.
        with self.lock:
            try:
                self._load()
            except (OSError, ValueError, PortableError) as exc:
                message = "The chart cache could not be read safely. No remote request was sent."
                raise APIError(500, "charts_cache_error", message,
                               **self._metadata(cached=False, outcome="failed", channel="manual",
                                                refresh_error=message, error_code="charts_cache_error")) from exc
            metadata = self._metadata(cached=self.state["data"] is not None, outcome="cooldown", channel="manual")
            if metadata["retryAfterSeconds"]:
                if self.state["data"] is None:
                    raise APIError(409, "charts_cooldown", "The chart refresh is cooling down.", **metadata)
                return metadata
            previous = self.state
            try:
                # Prove that the current state can still be replaced safely
                # before asking the server to build a full catalog response.
                # This writes identical data and therefore does not start or
                # extend the refresh cooldown.
                self._save(previous)
            except OSError as exc:
                message = "The chart cache could not be written. No remote request was sent."
                metadata = self._metadata(cached=previous["data"] is not None, outcome="failed", channel="manual",
                                          refresh_error=message, error_code="charts_cache_error")
                if previous["data"] is not None:
                    return metadata
                raise APIError(500, "charts_cache_error", message, **metadata) from exc
            except (ValueError, PortableError) as exc:
                # Unsafe paths and invalid cache serialization must never be
                # treated as an ordinary transient disk failure or fallback.
                message = "The chart cache is unsafe. No remote request was sent."
                raise APIError(500, "charts_cache_error", message,
                               **self._metadata(cached=False, outcome="failed", channel="manual", state=self._empty_state(),
                                                refresh_error=message, error_code="charts_cache_error")) from exc
            reservation = None

            def begin_remote_attempt():
                nonlocal reservation
                if reservation is not None:
                    return
                started_at = time.time_ns() // 1000000
                candidate = dict(previous, schemaVersion=3, lastAttemptAt=started_at,
                                  refreshError="A remote chart request did not finish. Try again after the refresh cooldown.")
                try:
                    # Persist before sending any HTTP bytes. Connection setup
                    # failures never reach this callback; explicit cheap
                    # rejections roll the reservation back below.
                    self._save(candidate)
                except OSError as exc:
                    message = "The refresh cooldown could not be saved. No remote request was sent."
                    raise APIError(500, "charts_cache_error", message,
                                   **self._metadata(cached=previous["data"] is not None, outcome="failed", channel="manual",
                                                    refresh_error=message, error_code="charts_cache_error")) from exc
                except (ValueError, PortableError) as exc:
                    message = "The chart cache became unsafe. No remote request was sent."
                    raise APIError(500, "charts_cache_error", message,
                                   **self._metadata(cached=False, outcome="failed", channel="manual", state=self._empty_state(),
                                                    refresh_error=message, error_code="charts_cache_error")) from exc
                reservation = candidate
                self.state = candidate
                self.monotonic_until = time.monotonic_ns() + CHART_REFRESH_INTERVAL_MS * 1000000

            def release_cheap_rejection():
                nonlocal reservation
                if reservation is None:
                    return
                try:
                    # A definite 401/403 response is small and proves that no
                    # catalog was generated. Restore the exact prior state so
                    # it remains immediately retryable across app restarts.
                    self._save(previous)
                except OSError as exc:
                    message = "The cheap-response cooldown could not be cleared safely."
                    self.state = dict(reservation, refreshError=message)
                    raise APIError(500, "charts_cache_error", message,
                                   **self._metadata(cached=previous["data"] is not None, outcome="failed", channel="manual",
                                                    refresh_error=message, error_code="charts_cache_error")) from exc
                except (ValueError, PortableError) as exc:
                    message = "The chart cache became unsafe while clearing a cheap response."
                    self.state = dict(reservation, refreshError=message)
                    raise APIError(500, "charts_cache_error", message,
                                   **self._metadata(cached=False, outcome="failed", channel="manual", state=self._empty_state(),
                                                    refresh_error=message, error_code="charts_cache_error")) from exc
                reservation = None
                self.state = previous
                self.monotonic_until = time.monotonic_ns()

            begin_remote_attempt.progress = lambda received, length: self._progress("manual", received, length)
            self._set_activity("manual", "connecting")
            try:
                rows = _fetch_chart_catalog(begin_remote_attempt, release_cheap_rejection)
                # Test doubles and alternate fetchers may return a complete
                # catalog directly; a completed full fetch still owns cooldown.
                begin_remote_attempt()
            except APIError as exc:
                self._set_activity()
                if previous["data"] is None or not isinstance(exc.__cause__, OSError):
                    raise
                return self._metadata(cached=True, attempted=True, outcome="failed", channel="manual",
                                      refresh_error=str(exc), error_code=exc.code)
            except ChartFetchError as exc:
                if reservation is None:
                    # Confirmed DNS/connect/TLS failures and explicit 401/403
                    # responses used negligible resources, so retain no new
                    # cooldown. Every uncertain post-connect failure keeps it.
                    self.state = dict(previous, refreshError=str(exc))
                    with contextlib.suppress(OSError, ValueError, PortableError):
                        self._save(self.state)
                else:
                    self.state = dict(reservation, refreshError=str(exc))
                    with contextlib.suppress(OSError, ValueError, PortableError):
                        self._save(self.state)
                self._set_activity()
                metadata = self._metadata(cached=self.state["data"] is not None, attempted=True, outcome="failed",
                                          channel="manual", error_code=exc.code)
                if self.state["data"] is None:
                    status = 504 if exc.code in {"charts_request_timeout", "charts_remote_timeout"} else 502
                    raise APIError(status, exc.code, str(exc), **metadata) from exc
                return {"data": self.state["data"], **metadata}
            except (OSError, ValueError, PortableError, http.client.HTTPException) as exc:
                code = "charts_response_incomplete" if reservation is not None else "charts_network_error"
                message = "The chart request or response was interrupted." if reservation is not None else "The chart server could not be reached."
                self.state = dict(reservation or previous, refreshError=message)
                with contextlib.suppress(OSError, ValueError, PortableError):
                    self._save(self.state)
                self._set_activity()
                metadata = self._metadata(cached=self.state["data"] is not None, attempted=True, outcome="failed",
                                          channel="manual", error_code=code)
                if self.state["data"] is None:
                    raise APIError(502, code, message, **metadata) from exc
                return {"data": self.state["data"], **metadata}
            completed_at = time.time_ns() // 1000000
            changed = previous["data"] != rows
            updated = dict(reservation, data=rows, fetchedAt=completed_at, refreshError=None,
                           automaticFailureCount=0, automaticNextAllowedAt=None,
                           automaticRefreshError=None, automaticErrorCode=None)
            self._set_activity("manual", "saving")
            try:
                self._save(updated)
            except (OSError, ValueError, PortableError) as exc:
                # Do not publish a catalog that a restarted process cannot read.
                self.state = dict(reservation, refreshError="Charts were received, but the local cache could not be saved.")
                self._set_activity()
                metadata = self._metadata(cached=self.state["data"] is not None, attempted=True, outcome="failed",
                                          channel="manual", error_code="charts_cache_error")
                if not isinstance(exc, OSError) or self.state["data"] is None:
                    raise APIError(500, "charts_cache_error", self.state["refreshError"], **metadata) from exc
                return {"data": self.state["data"], **metadata}
            self.state = updated
            self.automatic_monotonic_until = time.monotonic_ns()
            self._set_activity()
            return self._metadata(cached=False, attempted=True, outcome="updated" if changed else "unchanged",
                                  changed=changed, channel="manual")

    def automatic_update(self):
        with self.lock:
            try:
                self._load()
            except (OSError, ValueError, PortableError):
                message = "The chart cache could not be read safely. No remote request was sent."
                return self._metadata(cached=False, outcome="failed", channel="automatic", state=self._empty_state(),
                                      refresh_error=message, error_code="charts_cache_error")
            state = self.state
            metadata = self._metadata(cached=state["data"] is not None, channel="automatic")
            if not metadata["stale"]:
                return self._metadata(cached=True, outcome="fresh", channel="automatic")
            if metadata["retryAfterSeconds"]:
                return self._metadata(cached=state["data"] is not None, outcome="manual_cooldown", channel="automatic")
            if metadata["automaticRetryAfterSeconds"]:
                return self._metadata(cached=state["data"] is not None, outcome="backoff", channel="automatic")
            previous = state
            try:
                self._save(previous)
            except OSError:
                message = "The chart cache could not be written. No remote request was sent."
                return self._metadata(cached=previous["data"] is not None, outcome="failed", channel="automatic",
                                      refresh_error=message, error_code="charts_cache_error")
            except (ValueError, PortableError):
                message = "The chart cache is unsafe. No remote request was sent."
                return self._metadata(cached=False, outcome="failed", channel="automatic", state=self._empty_state(),
                                      refresh_error=message, error_code="charts_cache_error")

            started_at = time.time_ns() // 1000000
            failures = min(previous["automaticFailureCount"] + 1, len(CHART_AUTOMATIC_BACKOFF_MS))
            delay = CHART_AUTOMATIC_BACKOFF_MS[failures - 1]
            reservation = dict(previous, automaticFailureCount=failures, automaticLastAttemptAt=started_at,
                               automaticNextAllowedAt=started_at + delay,
                               automaticRefreshError="An automatic chart request did not finish.",
                               automaticErrorCode="charts_response_incomplete")
            try:
                self._save(reservation)
            except OSError:
                message = "The automatic retry state could not be saved. No remote request was sent."
                return self._metadata(cached=previous["data"] is not None, outcome="failed", channel="automatic",
                                      refresh_error=message, error_code="charts_cache_error")
            except (ValueError, PortableError):
                message = "The chart cache became unsafe. No remote request was sent."
                return self._metadata(cached=False, outcome="failed", channel="automatic", state=self._empty_state(),
                                      refresh_error=message, error_code="charts_cache_error")
            self.state = reservation
            self.automatic_monotonic_until = time.monotonic_ns() + delay * 1000000
            remote_attempt = False

            def begin_remote_attempt():
                nonlocal remote_attempt
                remote_attempt = True

            def release_cheap_rejection():
                nonlocal remote_attempt
                remote_attempt = False

            begin_remote_attempt.progress = lambda received, length: self._progress("automatic", received, length)
            self._set_activity("automatic", "connecting")
            try:
                rows = _fetch_chart_catalog(begin_remote_attempt, release_cheap_rejection)
            except APIError as exc:
                failed = dict(reservation, automaticRefreshError=str(exc), automaticErrorCode=exc.code)
                self.state = failed
                with contextlib.suppress(OSError, ValueError, PortableError):
                    self._save(failed)
                self._set_activity()
                return self._metadata(cached=failed["data"] is not None, attempted=True, outcome="failed",
                                      channel="automatic", error_code=exc.code)
            except ChartFetchError as exc:
                failed = dict(reservation, automaticRefreshError=str(exc), automaticErrorCode=exc.code)
                self.state = failed
                with contextlib.suppress(OSError, ValueError, PortableError):
                    self._save(failed)
                self._set_activity()
                return self._metadata(cached=failed["data"] is not None, attempted=True, outcome="failed",
                                      channel="automatic", error_code=exc.code)
            except (OSError, ValueError, PortableError, http.client.HTTPException) as exc:
                code = "charts_response_incomplete" if remote_attempt else "charts_network_error"
                message = "The chart request or response was interrupted." if remote_attempt else "The chart server could not be reached."
                failed = dict(reservation, automaticRefreshError=message, automaticErrorCode=code)
                self.state = failed
                with contextlib.suppress(OSError, ValueError, PortableError):
                    self._save(failed)
                self._set_activity()
                return self._metadata(cached=failed["data"] is not None, attempted=True, outcome="failed",
                                      channel="automatic", error_code=code)

            completed_at = time.time_ns() // 1000000
            changed = previous["data"] != rows
            updated = dict(reservation, data=rows, fetchedAt=completed_at, refreshError=None,
                           automaticFailureCount=0, automaticNextAllowedAt=None,
                           automaticRefreshError=None, automaticErrorCode=None)
            self._set_activity("automatic", "saving")
            try:
                self._save(updated)
            except (OSError, ValueError, PortableError):
                message = "Charts were received, but the local cache could not be saved."
                self.state = dict(reservation, automaticRefreshError=message, automaticErrorCode="charts_cache_error")
                self._set_activity()
                return self._metadata(cached=reservation["data"] is not None, attempted=True, outcome="failed",
                                      channel="automatic", refresh_error=message, error_code="charts_cache_error")
            self.state = updated
            self.automatic_monotonic_until = time.monotonic_ns()
            self._set_activity()
            return self._metadata(cached=False, attempted=True, outcome="updated" if changed else "unchanged",
                                  changed=changed, channel="automatic")

    def automatic_check(self):
        return self.automatic_update()


def validate_catalog(catalog):
    if not isinstance(catalog, dict) or set(catalog) != LANGUAGES:
        raise PortableError("The interface catalog must contain exactly en and zh-CN.")
    for entries in catalog.values():
        if (not isinstance(entries, dict) or not entries or
                any(not isinstance(key, str) or not key or not isinstance(value, str) for key, value in entries.items())):
            raise PortableError("Each interface catalog must be a nonempty flat dictionary of strings.")
    if set(catalog["en"]) != set(catalog["zh-CN"]):
        raise PortableError("The English and Chinese interface catalogs must contain matching keys.")
    return catalog


def load_catalog():
    try:
        raw = web_resource_path(CATALOG_NAME).read_bytes()
        return validate_catalog(_parse_json(raw))
    except (ValueError, UnicodeError) as exc:
        raise PortableError("The interface catalog is not valid UTF-8 JSON.") from exc


def _script_json(value):
    encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    for char, replacement in (("<", "\\u003c"), (">", "\\u003e"), ("&", "\\u0026"),
                              ("\u2028", "\\u2028"), ("\u2029", "\\u2029")):
        encoded = encoded.replace(char, replacement)
    return encoded


def assemble_web_template(template: str, *, styles: str, cards: str, app: str) -> str:
    """Embed only the three shipped frontend fragments in the inline page."""
    fragments = {"/*__SPINSHARE_STYLES__*/": styles, "/*__SPINSHARE_CARDS__*/": cards,
                 "/*__SPINSHARE_APP__*/": app}
    if any(template.count(marker) != 1 for marker in fragments):
        raise PortableError("The page template has missing or duplicate frontend fragments.")
    # Do not scan inserted source again: marker-like strings are ordinary source text.
    return re.sub(r"/\*__SPINSHARE_(?:STYLES|CARDS|APP)__\*/", lambda match: fragments[match[0]], template)


def load_web_template() -> str:
    """Read the fixed frontend resource list from source or the frozen bundle."""
    return assemble_web_template(
        web_resource_path(TEMPLATE_NAME).read_text(encoding="utf-8"),
        styles=web_resource_path("interface.css").read_text(encoding="utf-8"),
        cards=web_resource_path("chart-card.js").read_text(encoding="utf-8"),
        app=web_resource_path("app.js").read_text(encoding="utf-8"),
    )


def render_page(template: str, bootstrap: dict, catalog: dict) -> str:
    """Replace each unique runtime, CSP and interface catalog placeholder once."""
    placeholders = {"__SPINSHARE_RUNTIME_CONFIG__", "__SPINSHARE_CONNECT_ORIGIN__", "__SPINSHARE_MEDIA_ORIGIN__", "__SPINSHARE_UI_CATALOG__"}
    if any(template.count(placeholder) != 1 for placeholder in placeholders):
        raise PortableError("The page template has missing or duplicate runtime placeholders.")
    origin = bootstrap.get("origin")
    if not isinstance(origin, str) or not re.fullmatch(r"http://127\.0\.0\.1:[0-9]{1,5}", origin):
        raise PortableError("The local page origin is invalid.")
    if not 1 <= int(origin.rsplit(":", 1)[1]) <= 65535:
        raise PortableError("The local page port is invalid.")
    values = {"__SPINSHARE_CONNECT_ORIGIN__": origin, "__SPINSHARE_MEDIA_ORIGIN__": origin, "__SPINSHARE_RUNTIME_CONFIG__": _script_json(bootstrap),
              "__SPINSHARE_UI_CATALOG__": _script_json(catalog)}
    # Single-pass substitution leaves placeholder-like JSON strings intact.
    return re.sub(r"__SPINSHARE_(?:RUNTIME_CONFIG|CONNECT_ORIGIN|MEDIA_ORIGIN|UI_CATALOG)__", lambda match: values[match[0]], template)


class PortableManager(installer.JobManager):
    def __init__(self, store, config):
        self.store = store
        self.config = dict(config)
        self.settings_changed = None
        self.directory_picker = None
        self.exiting = False
        self.install_directory = Path(sys.executable).parent if getattr(sys, "frozen", False) else None
        self.directory_picker_lock = threading.Lock()
        self.preview_lock = threading.Lock()
        self.preview_resolvers = threading.BoundedSemaphore(2)
        self.preview_streams = threading.BoundedSemaphore(4)
        self.preview_sources = {}
        # Retain IDs after job eviction for retry deduplication.
        self.accepted_requests = set()
        super().__init__(store.target_for(config))

    @property
    def revision(self):
        return self.config["revision"]

    def settings(self):
        with self.lock:
            return {"targetDirectory": str(self.target_dir), "defaultDirectory": str(self.store.default_directory),
                    "customDirectory": self.config["customDirectory"], "revision": self.revision,
                    "language": self.config["language"], "closeBehavior": self.config["closeBehavior"],
                    "installDirectoryConfirmed": self.config["installDirectoryConfirmed"],
                    "exiting": self.closed or self.exiting, "version": VERSION}

    def activity(self):
        with self.lock:
            fields = ("id", "songId", "state", "downloadedBytes", "totalBytes", "filesWritten", "fileCount")
            jobs = [{field: job[field] for field in fields}
                    for job in self.jobs.values() if job["state"] in installer.ACTIVE_STATES]
            return {"exiting": self.closed or self.exiting, "activeCount": len(jobs), "jobs": jobs}

    def validate_target(self, target):
        for protected in (self.store.directory, self.install_directory):
            if protected is not None and (target.is_relative_to(protected) or protected.is_relative_to(target)):
                raise APIError(400, "directory_overlap", "Choose a chart folder separate from the application and its data.")

    def begin_exit(self):
        with self.lock:
            self.exiting = True
            return True

    def resolve_preview(self, reference, update_hash):
        if (not isinstance(reference, str) or not re.fullmatch(r"spinshare_[a-fA-F0-9]{1,64}", reference) or
                not isinstance(update_hash, str) or update_hash and not re.fullmatch(r"[a-fA-F0-9]{32}", update_hash)):
            raise APIError(400, "invalid_preview_reference", "Choose a chart to preview.")
        with self.lock:
            if self.closed or self.exiting:
                raise APIError(409, "shutting_down", "The app is exiting.")
            target, revision = self.target_dir, self.revision
        now = time.monotonic()
        with self.preview_lock:
            self.preview_sources = {key: entry for key, entry in self.preview_sources.items() if entry[4] > now}
            for key, entry in self.preview_sources.items():
                if update_hash and entry[:2] == ((reference, update_hash), revision):
                    try:
                        if preview_file_signature(entry[2]) == entry[3]:
                            return {"url": "/v1/preview/audio/" + key}
                    except OSError:
                        pass
        if not self.preview_resolvers.acquire(blocking=False):
            raise APIError(429, "preview_lookup_failed", "Audio is being located. Try again shortly.")
        try:
            # No install lock is held during remote lookup or game-library discovery.
            path = audio_preview.resolve_preview(reference, target)
            signature = preview_file_signature(path)
            with self.lock:
                if self.closed or self.exiting or self.revision != revision:
                    raise APIError(409, "preview_lookup_failed", "Settings changed. Try the preview again.")
            key = secrets.token_hex(24)
            with self.preview_lock:
                while len(self.preview_sources) >= 32:
                    del self.preview_sources[next(iter(self.preview_sources))]
                self.preview_sources[key] = ((reference, update_hash), revision, path, signature, time.monotonic() + 6 * 3600)
            return {"url": "/v1/preview/audio/" + key}
        except audio_preview.PreviewError as exc:
            raise APIError(404 if exc.code in {"game_audio_not_found", "preview_unavailable"} else 502,
                           exc.code, str(exc)) from exc
        except OSError as exc:
            raise APIError(404, "game_audio_not_found", "The installed game audio could not be read.") from exc
        finally:
            self.preview_resolvers.release()

    def submit(self, song_id, request_id, *, settings_revision=None):
        # Validate IDs before looking up retries.
        if type(song_id) is not int or not 0 < song_id <= 9007199254740991:
            raise installer.InstallError("The chart ID must be a positive integer.")
        if not isinstance(request_id, str) or not RE_HEX32.fullmatch(request_id):
            raise installer.InstallError("Invalid installation request ID.")
        with self.lock:
            if request_id in self.requests:
                return super().submit(song_id, request_id)
            if request_id in self.accepted_requests:
                raise APIError(410, "request_expired", "The accepted task status expired. Confirm before starting another download.")
            if self.exiting:
                raise APIError(409, "shutting_down", "The app will exit after the current installations finish.")
            self.validate_target(self.target_dir)
            if settings_revision != self.revision:
                raise APIError(409, "settings_changed", "The installation directory changed in another page. Confirm it before submitting again.")
            if not self.config["installDirectoryConfirmed"]:
                raise APIError(409, "directory_confirmation_required", "Confirm the chart installation directory before downloading.")
            if len(self.accepted_requests) >= MAX_REQUEST_HISTORY:
                raise APIError(429, "request_history_full", "Request history is full. Wait for installs to finish, then reopen the app.")
            job = super().submit(song_id, request_id)
            self.accepted_requests.add(request_id)
            return job

    def check_installations(self, charts, expected_revision):
        if (not isinstance(expected_revision, str) or not RE_HEX32.fullmatch(expected_revision) or
                not isinstance(charts, list) or not 1 <= len(charts) <= 30):
            raise APIError(400, "invalid_installations", "Provide a settings revision and between 1 and 30 charts.")
        seen = set()
        for chart in charts:
            if (not isinstance(chart, dict) or set(chart) != {"songId", "fileReference", "updateHash"} or
                    type(chart["songId"]) is not int or not 0 < chart["songId"] <= 9007199254740991 or
                    chart["songId"] in seen or not isinstance(chart["fileReference"], str) or
                    not re.fullmatch(r"spinshare_[a-fA-F0-9]{1,64}", chart["fileReference"]) or
                    not isinstance(chart["updateHash"], str) or not re.fullmatch(r"[a-fA-F0-9]{32}", chart["updateHash"])):
                raise APIError(400, "invalid_installations", "Each chart requires a unique ID, an official file reference and an update hash.")
            seen.add(chart["songId"])
        with self.lock:
            if expected_revision != self.revision:
                raise APIError(409, "settings_changed", "Settings changed in another page. Refresh settings before retrying.")
            if self.closed:
                raise APIError(409, "shutting_down", "The app is exiting. Reopen SpinShareBrowser.exe.")
            active = {job["songId"] for job in self.jobs.values() if job["state"] in installer.ACTIVE_STATES}
            results = []
            for chart in charts:
                installed = False
                if chart["songId"] not in active:
                    try:
                        raw = _read_bytes(self.target_dir / (chart["fileReference"] + ".srtb"), limit=MAX_CHART_BYTES)
                        raw.decode("utf-8")
                        installed = hmac.compare_digest(hashlib.md5(raw, usedforsecurity=False).hexdigest(), chart["updateHash"].lower())
                    except (OSError, PortableError, UnicodeError):
                        pass
                results.append({"songId": chart["songId"], "installed": installed})
            return {"settingsRevision": self.revision, "installations": results}

    def index_installations(self, expected_revision):
        if not isinstance(expected_revision, str) or not RE_HEX32.fullmatch(expected_revision):
            raise APIError(400, "invalid_installations", "Provide a settings revision.")
        with self.lock:
            if expected_revision != self.revision:
                raise APIError(409, "settings_changed", "Settings changed in another page. Refresh settings before retrying.")
            if self.active_count():
                raise APIError(409, "installer_busy", "Wait for installs to finish before checking the installation index.")
            if self.closed or self.exiting:
                raise APIError(409, "shutting_down", "The app is exiting. Reopen SpinShareBrowser.exe.")
            installations, seen = {}, set()
            scanned = total_bytes = 0
            deadline = time.monotonic() + INSTALLATION_INDEX_TIMEOUT_SECONDS
            try:
                with _directory_guard(self.target_dir):
                    for path in self.target_dir.iterdir():
                        scanned += 1
                        if scanned > INSTALLATION_INDEX_MAX_DIRECTORY_ENTRIES:
                            raise APIError(413, "invalid_installations", "The installation directory contains too many entries to index safely.")
                        if time.monotonic() > deadline:
                            raise APIError(408, "invalid_installations", "Reading the installation index timed out.")
                        match = re.fullmatch(r"(spinshare_[a-f0-9]{1,64})\.srtb", path.name, re.I)
                        if not match:
                            continue
                        reference = match[1].lower()
                        if reference in seen:
                            installations.pop(reference, None)
                            continue
                        seen.add(reference)
                        try:
                            info = _safe_info(path, directory=False)
                            if info.st_size > MAX_CHART_BYTES:
                                continue
                            if info.st_size > INSTALLATION_INDEX_MAX_BYTES - total_bytes:
                                raise APIError(413, "invalid_installations", "The installation index exceeds the total chart-data limit.")
                            raw = _read_guarded_bytes(path, limit=MAX_CHART_BYTES)
                            total_bytes += len(raw)
                            if total_bytes > INSTALLATION_INDEX_MAX_BYTES:
                                raise APIError(413, "invalid_installations", "The installation index exceeds the total chart-data limit.")
                            raw.decode("utf-8")
                        except APIError:
                            raise
                        except (OSError, PortableError, UnicodeError):
                            continue
                        if len(installations) >= INSTALLATION_INDEX_MAX_ENTRIES:
                            raise APIError(413, "invalid_installations", "The installation index contains too many charts.")
                        installations[reference] = hashlib.md5(raw, usedforsecurity=False).hexdigest()
                        if time.monotonic() > deadline:
                            raise APIError(408, "invalid_installations", "Reading the installation index timed out.")
                    if time.monotonic() > deadline:
                        raise APIError(408, "invalid_installations", "Reading the installation index timed out.")
            except APIError:
                raise
            except (OSError, PortableError) as exc:
                raise APIError(500, "invalid_installations", "The installation directory could not be read safely.") from exc
            return {"settingsRevision": self.revision, "installations": [
                {"fileReference": reference, "updateHash": update_hash}
                for reference, update_hash in sorted(installations.items())
            ]}

    def delete_installation(self, song_id, file_reference, update_hash, expected_revision):
        if (type(song_id) is not int or not 0 < song_id <= 9007199254740991 or
                not isinstance(file_reference, str) or
                not re.fullmatch(r"spinshare_[a-fA-F0-9]{1,64}", file_reference) or
                not isinstance(update_hash, str) or not re.fullmatch(r"[a-fA-F0-9]{32}", update_hash) or
                not isinstance(expected_revision, str) or not RE_HEX32.fullmatch(expected_revision)):
            raise APIError(400, "invalid_deletion", "Provide a settings revision, chart ID, official file reference and update hash.")
        with self.lock:
            if expected_revision != self.revision:
                raise APIError(409, "settings_changed", "Settings changed in another page. Refresh settings before retrying.")
            if self.active_count():
                raise APIError(409, "installer_busy", "Wait for installs to finish before deleting a chart.")
            if self.closed or self.exiting:
                raise APIError(409, "shutting_down", "The app is exiting. Reopen SpinShareBrowser.exe.")
            self.validate_target(self.target_dir)
            try:
                raw = _read_bytes(self.target_dir / (file_reference + ".srtb"), limit=MAX_CHART_BYTES)
                raw.decode("utf-8")
            except (OSError, PortableError, UnicodeError) as exc:
                raise APIError(409, "installation_changed", "The installed chart no longer matches this version.") from exc
            if not hmac.compare_digest(hashlib.md5(raw, usedforsecurity=False).hexdigest(), update_hash.lower()):
                raise APIError(409, "installation_changed", "The installed chart no longer matches this version.")
            try:
                result = installer.delete_chart_files(
                    self.target_dir, file_reference, update_hash, max_chart_bytes=MAX_CHART_BYTES)
            except installer.ChartChangedError as exc:
                raise APIError(409, "installation_changed", str(exc)) from exc
            except (OSError, installer.InstallError) as exc:
                raise APIError(500, getattr(exc, "code", "delete_failed"), str(exc)) from exc
            return {"settingsRevision": self.revision, "songId": song_id,
                    "deleted": True, "filesDeleted": result["filesDeleted"]}

    def _check_directory_update(self, expected_revision):
        if expected_revision != self.revision:
            raise APIError(409, "settings_changed", "Settings changed in another page. Refresh settings before retrying.")
        if self.active_count():
            raise APIError(409, "installer_busy", "Wait for installs to finish before changing the directory.")
        if self.closed or self.exiting:
            raise APIError(409, "shutting_down", "The app is exiting. Reopen SpinShareBrowser.exe.")

    def select_directory(self, expected_revision):
        if not self.directory_picker_lock.acquire(blocking=False):
            raise APIError(409, "directory_picker_busy", "A folder selection dialog is already open.")
        try:
            with self.lock:
                self._check_directory_update(expected_revision)
                initial = self.target_dir
                title = load_catalog()[self.config["language"]]["Choose folder"]
            deadline = time.monotonic() + 600
            try:
                directory = (self.directory_picker or choose_directory)(initial, title)
            except OSError as exc:
                raise APIError(500, "directory_picker_error", "The folder dialog could not be opened.") from exc
            if directory is None:
                return {"settings": self.settings(), "cancelled": True}
            if time.monotonic() >= deadline:
                raise APIError(408, "directory_picker_expired", "Folder selection timed out. Choose the folder again.")
            directory = validate_directory(directory)
            if not directory.is_dir():
                raise APIError(400, "invalid_settings", "Choose an existing directory.")
            return {"settings": self.update_directory(directory, expected_revision), "cancelled": False}
        finally:
            self.directory_picker_lock.release()

    def update_directory(self, directory, expected_revision):
        with self.lock:
            self._check_directory_update(expected_revision)
            target = validate_directory(self.store.default_directory if directory is None else directory)
            self.validate_target(target)
            new_config = dict(self.config, customDirectory=None if directory is None else str(target), revision=secrets.token_hex(16))
            self._persist_config(new_config)
            self.target_dir = target
            return self.settings()

    def update_language(self, language):
        if not isinstance(language, str) or language not in LANGUAGES:
            raise APIError(400, "invalid_language", "Language must be en or zh-CN.")
        with self.lock:
            if self.closed or self.exiting:
                raise APIError(409, "shutting_down", "The app is exiting. Reopen SpinShareBrowser.exe.")
            if language != self.config["language"]:
                self._persist_config(dict(self.config, language=language))
            return language

    def update_close_behavior(self, behavior):
        if not isinstance(behavior, str) or behavior not in CLOSE_BEHAVIORS:
            raise APIError(400, "invalid_close_behavior", "Choose a close behavior.")
        with self.lock:
            if self.closed or self.exiting:
                raise APIError(409, "shutting_down", "The application is exiting.")
            if behavior != self.config["closeBehavior"]:
                self._persist_config(dict(self.config, closeBehavior=behavior))
            return self.settings()

    def mark_player_shortcut_hint_shown(self):
        with self.lock:
            if not self.config["playerShortcutHintShown"]:
                self._persist_config(dict(self.config, playerShortcutHintShown=True))
            return True

    def confirm_install_directory(self, expected_revision):
        with self.lock:
            if expected_revision != self.revision:
                raise APIError(409, "settings_changed", "Settings changed in another page. Refresh settings before retrying.")
            if self.closed or self.exiting:
                raise APIError(409, "shutting_down", "The app is exiting. Reopen SpinShareBrowser.exe.")
            if not self.config["installDirectoryConfirmed"]:
                self._persist_config(dict(self.config, installDirectoryConfirmed=True))
            return {"confirmed": True, "settingsRevision": self.revision,
                    "targetDirectory": str(self.target_dir)}

    def mark_tray_notice(self):
        with self.lock:
            if not self.closed and not self.exiting and not self.config["trayNoticeShown"]:
                self._persist_config(dict(self.config, trayNoticeShown=True))

    def update_window_size(self, value):
        if not valid_window_size(value):
            raise PortableError("The window size is invalid.")
        with self.lock:
            if self.closed:
                raise PortableError("The application is closed.")
            if value != self.config.get("windowSize"):
                updated = dict(self.config, windowSize=dict(value) if value is not None else None)
                self.store.save(updated)
                self.config = updated

    def _persist_config(self, new_config):
        self.store.save(new_config)
        self.config = new_config
        if self.settings_changed is not None:
            self.settings_changed()


def preview_file_signature(path):
    info = path.lstat()
    if (not stat.S_ISREG(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400 or
            not 0 < info.st_size <= 256 * 1024 * 1024):
        raise OSError("The preview is not a regular audio file.")
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns


def preview_byte_range(value, size):
    """Only a single bytes range is needed by the native media element."""
    if value is None:
        return 0, size - 1
    match = re.fullmatch(r"bytes=(\d{0,20})-(\d{0,20})", value)
    if not match or not any(match.groups()):
        raise ValueError("Invalid range")
    first, last = match.groups()
    if not first:
        count = int(last)
        if not count:
            raise ValueError("Empty suffix")
        return max(0, size - count), size - 1
    start, end = int(first), min(int(last), size - 1) if last else size - 1
    if start > end or start >= size:
        raise ValueError("Unsatisfiable range")
    return start, end


class PortableHTTPServer(http.server.ThreadingHTTPServer):
    allow_reuse_address = False
    daemon_threads = True
    request_queue_size = 16
    desktop = None
    ui_path = None
    ui_origin = None


class PortableHandler(http.server.BaseHTTPRequestHandler):
    server_version = "SpinShareBrowser/" + VERSION
    sys_version = ""
    protocol_version = "HTTP/1.1"

    def setup(self):
        super().setup()
        self.connection.settimeout(5)

    def log_message(self, *args):
        # Keep local pairing and request data out of logs.
        pass

    def _respond(self, status, value=None, *, preflight=False):
        body = b"" if value is None else _json_bytes(value)
        self.close_connection = True
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Connection", "close")
        self.send_header("Vary", "Origin")
        origin = self.server.ui_origin
        if self.headers.get_all("Origin") == [origin]:
            self.send_header("Access-Control-Allow-Origin", origin)
            if preflight:
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type, X-SpinShare-Key, X-SpinShare-Settings")
                if self.headers.get("Access-Control-Request-Private-Network") == "true":
                    self.send_header("Access-Control-Allow-Private-Network", "true")
        self.end_headers()
        if body:
            self.wfile.write(body)
        if status >= 400:
            self.wfile.flush()
            self._discard_rejected_body()

    def _discard_rejected_body(self):
        if self.command != "POST" or getattr(self, "_body_read", False) or self.headers.get("Transfer-Encoding") is not None:
            return
        lengths = self.headers.get_all("Content-Length")
        if (not lengths or len(lengths) != 1 or not re.fullmatch(r"[0-9]{1,5}", lengths[0]) or
                not 0 < int(lengths[0]) <= 4 * MAX_SETTINGS_BYTES):
            return
        # Unread POST bytes can reset a closing Windows socket before the client receives the response.
        remaining, deadline = int(lengths[0]), time.monotonic() + .25
        try:
            while remaining:
                timeout = deadline - time.monotonic()
                if timeout <= 0:
                    break
                self.connection.settimeout(timeout)
                chunk = self.rfile.read1(min(remaining, 8192))
                if not chunk:
                    break
                remaining -= len(chunk)
        except OSError:
            pass

    def _context_allowed(self):
        expected_host = HOST + ":" + str(self.server.server_address[1])
        if self.client_address[0] != HOST or self.headers.get_all("Host") != [expected_host]:
            self._respond(403, {"error": "Only the exact local loopback address is allowed.", "code": "context_rejected"})
            return False
        native = (self.headers.get_all("Origin") == ["null"] and
                  self.headers.get_all("X-SpinShare-Native") == ["1"] and
                  not any(name.lower().startswith("sec-fetch-") for name in self.headers))
        same_origin_get = (self.server.ui_origin is not None and self.command == "GET" and
                           self.headers.get_all("Origin") is None and
                           self.headers.get_all("Sec-Fetch-Site") == ["same-origin"] and
                           self.headers.get("Sec-Fetch-Mode") in {"cors", "same-origin"} and
                           self.headers.get_all("Sec-Fetch-Dest") == ["empty"])
        if self.headers.get_all("Origin") != [self.server.ui_origin] and not native and not same_origin_get:
            self._respond(403, {"error": "This endpoint only accepts the application window.", "code": "context_rejected"})
            return False
        if "?" in self.path or "#" in self.path:
            self._respond(400, {"error": "Endpoint URLs do not accept extra parameters.", "code": "context_rejected"})
            return False
        return True

    def _authenticated(self):
        if not self._context_allowed():
            return False
        values = self.headers.get_all("X-SpinShare-Key")
        if (not values or len(values) != 1 or not RE_HEX64.fullmatch(values[0]) or
                not hmac.compare_digest(values[0], self.server.capability)):
            self._respond(403, {"error": "The local pairing key does not match. Reopen the executable.", "code": "pairing_failed"})
            return False
        return True

    def do_OPTIONS(self):
        if not self._context_allowed():
            return
        if (self.path not in {"/v1/preview/resolve", "/v1/health", "/v1/activity", "/v1/charts", "/v1/charts/status", "/v1/charts/manual", "/v1/charts/automatic", "/v1/install", "/v1/shutdown", "/v1/settings", "/v1/language", "/v1/close-behavior", "/v1/player-shortcuts-seen", "/v1/install-directory-confirmation", "/v1/desktop/window", "/v1/desktop/dialog", "/v1/desktop/exit", "/v1/directory/select", "/v1/installations/check", "/v1/installations/index", "/v1/installations/delete"} and
                not re.fullmatch(r"/v1/jobs/[a-f0-9]{32}", self.path)):
            self._respond(404, {"error": "The endpoint does not exist.", "code": "not_found"})
            return
        methods = self.headers.get_all("Access-Control-Request-Method")
        headers = {name.strip().lower() for name in self.headers.get("Access-Control-Request-Headers", "").split(",") if name.strip()}
        if (not methods or len(methods) != 1 or methods[0] not in {"GET", "POST"} or
                not headers <= {"content-type", "x-spinshare-key", "x-spinshare-settings"}):
            self._respond(403, {"error": "The preflight request is not allowed.", "code": "context_rejected"})
            return
        self._respond(204, preflight=True)

    def _preview_audio(self):
        # Media elements cannot set the pairing header. A short-lived, random,
        # single-file capability is issued only by the authenticated resolver.
        browser = (self.client_address[0] == HOST and
                   self.headers.get_all("Host") == [HOST + ":" + str(self.server.server_address[1])] and
                   self.headers.get_all("Sec-Fetch-Site") == ["same-origin"] and
                   self.headers.get_all("Sec-Fetch-Dest") == ["audio"] and
                   self.headers.get("Sec-Fetch-Mode") in {"no-cors", "cors"} and
                   self.headers.get_all("Origin") in (None, [self.server.ui_origin]))
        if not browser and not self._authenticated():
            return
        manager = self.server.manager
        with manager.preview_lock:
            entry = manager.preview_sources.get(self.path.rsplit("/", 1)[-1])
        if entry is None or entry[4] < time.monotonic() or manager.closed or manager.exiting:
            self._respond(404, {"code": "preview_unavailable", "error": "Retry the song to reopen its audio."})
            return
        if not manager.preview_streams.acquire(blocking=False):
            self._respond(429, {"code": "preview_lookup_failed", "error": "Try the song again shortly."})
            return
        headers_sent = False
        try:
            path, signature = entry[2:4]
            if preview_file_signature(path) != signature:
                raise OSError("Audio changed")
            with path.open("rb") as stream:
                info = os.fstat(stream.fileno())
                if (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns) != signature or stream.read(4) != b"OggS":
                    raise OSError("Audio changed")
                ranges = self.headers.get_all("Range")
                try:
                    if ranges is not None and len(ranges) != 1:
                        raise ValueError("Duplicate range")
                    start, end = preview_byte_range(ranges[0] if ranges else None, info.st_size)
                except ValueError:
                    self.close_connection = True
                    self.send_response(416)
                    self.send_header("Content-Range", f"bytes */{info.st_size}")
                    self.send_header("Content-Length", "0")
                    self.send_header("Connection", "close")
                    self.end_headers()
                    return
                self.close_connection = True
                self.send_response(206 if ranges else 200)
                self.send_header("Content-Type", "audio/ogg")
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("Content-Length", str(end - start + 1))
                if ranges:
                    self.send_header("Content-Range", f"bytes {start}-{end}/{info.st_size}")
                self.send_header("Cache-Control", "no-store")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("Cross-Origin-Resource-Policy", "same-origin")
                self.send_header("Connection", "close")
                self.end_headers()
                headers_sent = True
                if self.command == "HEAD":
                    return
                stream.seek(start)
                remaining = end - start + 1
                while remaining:
                    chunk = stream.read(min(65536, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except OSError:
            if not headers_sent:
                self._respond(404, {"code": "game_audio_not_found", "error": "The installed game audio could not be read."})
        finally:
            manager.preview_streams.release()

    def do_HEAD(self):
        if re.fullmatch(r"/v1/preview/audio/[a-f0-9]{48}", self.path):
            self._preview_audio()
        else:
            self._respond(404)

    def do_GET(self):
        if re.fullmatch(r"/v1/preview/audio/[a-f0-9]{48}", self.path):
            self._preview_audio()
            return
        if self.server.ui_path is not None and self.path == self.server.ui_path:
            if (self.client_address[0] != HOST or
                    self.headers.get_all("Host") != [HOST + ":" + str(self.server.server_address[1])] or
                    self.headers.get("Sec-Fetch-Site", "none") not in {"none", "same-origin"}):
                self._respond(403, {"error": "Open the application window.", "code": "context_rejected"})
                return
            body = self.server.render_page()
            self.close_connection = True
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("Content-Security-Policy", "frame-ancestors 'none'")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(body)
            return
        if not self._authenticated():
            return
        manager = self.server.manager
        if self.path in {"/v1/charts", "/v1/charts/status"}:
            try:
                self._respond(200, self.server.chart_cache.status(include_data=self.path == "/v1/charts"))
            except APIError as exc:
                self._respond(exc.status, {"error": str(exc), "code": exc.code, **exc.details})
        elif self.path == "/v1/settings":
            try:
                self._respond(200, {"settings": manager.settings()})
            except (OSError, installer.InstallError):
                self._respond(500, {"error": "The settings directory could not be checked. Reopen the executable.", "code": "settings_io_error"})
        elif self.path == "/v1/desktop/window":
            desktop = self.server.desktop
            self._respond(200, {"window": desktop.window_state() if desktop else {"customChrome": False, "maximized": False}})
        elif self.path == "/v1/desktop/dialog":
            self._respond(200, {"dialog": self.server.desktop.dialog_state() if self.server.desktop else None})
        elif self.path == "/v1/activity":
            self._respond(200, manager.activity())
        elif self.path == "/v1/health":
            with manager.lock:
                self._respond(200, {"ok": not manager.closed, "shuttingDown": manager.closed or manager.exiting,
                                    "version": VERSION, "targetDirectory": str(manager.target_dir),
                                    "activeJobs": manager.active_count(), "settingsRevision": manager.revision,
                                    "pid": os.getpid(), "instanceId": self.server.instance_id,
                                    "uiPath": self.server.ui_path})
        elif re.fullmatch(r"/v1/jobs/[a-f0-9]{32}", self.path):
            job = manager.get(self.path.rsplit("/", 1)[1])
            if job is None:
                self._respond(404, {"error": "The task is unavailable; the app may have restarted.", "code": "job_not_found"})
            else:
                self._respond(200, {"job": job})
        else:
            self._respond(404, {"error": "The endpoint does not exist.", "code": "not_found"})

    def _body(self):
        lengths = self.headers.get_all("Content-Length")
        if (self.headers.get("Transfer-Encoding") is not None or not lengths or len(lengths) != 1 or
                not re.fullmatch(r"[0-9]{1,5}", lengths[0]) or not 0 < int(lengths[0]) <= MAX_SETTINGS_BYTES):
            raise APIError(400, "invalid_body", "The request body size is invalid.")
        types = self.headers.get_all("Content-Type")
        if not types or len(types) != 1 or types[0].split(";")[0].strip().lower() != "application/json":
            raise APIError(415, "invalid_type", "Only JSON requests are accepted.")
        try:
            length = int(lengths[0])
            self._body_read = True
            raw = self.rfile.read(length)
            if len(raw) != length:
                raise ValueError("incomplete request")
            data = _parse_json(raw)
            if not isinstance(data, dict):
                raise ValueError("not an object")
            return data
        except (ValueError, UnicodeError, OSError) as exc:
            raise APIError(400, "invalid_body", "The request must be a complete JSON object without duplicate fields.") from exc

    def do_POST(self):
        if not self._authenticated():
            return
        if self.path not in {"/v1/preview/resolve", "/v1/charts/manual", "/v1/charts/automatic", "/v1/install", "/v1/settings", "/v1/language", "/v1/close-behavior", "/v1/player-shortcuts-seen", "/v1/install-directory-confirmation", "/v1/desktop/window", "/v1/desktop/window/regions", "/v1/desktop/dialog", "/v1/desktop/show", "/v1/desktop/exit", "/v1/shutdown", "/v1/directory/select", "/v1/installations/check", "/v1/installations/index", "/v1/installations/delete"}:
            self._respond(404, {"error": "The endpoint does not exist.", "code": "not_found"})
            return
        try:
            data = self._body()
            if self.path == "/v1/preview/resolve":
                if set(data) != {"fileReference", "updateHash"}:
                    raise APIError(400, "invalid_preview_reference", "Choose a chart to preview.")
                self._respond(200, self.server.manager.resolve_preview(data["fileReference"], data["updateHash"]))
                return
            if self.path in {"/v1/charts/manual", "/v1/charts/automatic"}:
                if data:
                    raise APIError(400, "invalid_body", "Chart update requests do not accept additional fields.")
                update = (self.server.chart_cache.manual_update if self.path.endswith("/manual") else
                          self.server.chart_cache.automatic_update)
                self._respond(200, update())
                return
            if self.path == "/v1/desktop/dialog":
                if (not {"id", "action"} <= set(data) <= {"id", "action", "remember"} or
                        not isinstance(data["id"], str) or not RE_HEX32.fullmatch(data["id"]) or
                        data["action"] not in ("wait", "continue", "exit", "tray") or
                        type(data.get("remember", False)) is not bool):
                    raise APIError(400, "invalid_body", "Choose a dialog action.")
                if self.server.desktop is None or not self.server.desktop.dialog_reply(data["id"], data["action"], data.get("remember", False)):
                    raise APIError(409, "dialog_changed", "This prompt has already been handled.")
                self._respond(202, {"ok": True})
                return
            if self.path == "/v1/desktop/window/regions":
                from desktop import valid_frame_layout
                if not valid_frame_layout(data):
                    raise APIError(400, "invalid_body", "Provide the window's title bar layout.")
                desktop = self.server.desktop
                if desktop is None or not desktop.update_frame_layout(data):
                    raise APIError(409, "window_starting", "The application window is starting.")
                self._respond(202, {"ok": True})
                return
            if self.path == "/v1/desktop/window":
                if set(data) != {"action"} or data["action"] not in ("minimize", "maximize", "close"):
                    raise APIError(400, "invalid_body", "Choose a window control.")
                desktop = self.server.desktop
                if desktop is None:
                    raise APIError(409, "window_starting", "The application window is starting.")
                desktop.window_command(data["action"])
                self._respond(202, {"ok": True})
                return
            if self.path in {"/v1/desktop/show", "/v1/desktop/exit"}:
                if data:
                    raise APIError(400, "invalid_body", "Window commands do not accept additional fields.")
                desktop = self.server.desktop
                if desktop is None:
                    raise APIError(409, "window_starting", "The application window is starting.")
                if self.path.endswith("/show"):
                    if self.headers.get_all("X-SpinShare-Native") != ["1"]:
                        raise APIError(403, "context_rejected", "This command is reserved for the launcher.")
                    desktop.show()
                else:
                    desktop.request_exit()
                self._respond(202, {"ok": True})
                return
            if self.path == "/v1/shutdown":
                if data:
                    raise APIError(400, "invalid_body", "Shutdown requests do not accept additional fields.")
                if self.server.desktop is not None:
                    if not self.server.desktop.close_if_idle():
                        raise APIError(409, "installer_busy", "Wait for installations to finish before exiting.")
                    self._respond(202, {"ok": True})
                    return
                if not self.server.manager.close_if_idle():
                    raise APIError(409, "installer_busy", "Wait for installs to finish before exiting.")
                try:
                    self._respond(202, {"ok": True})
                except OSError:
                    # Finish shutdown even if the browser disconnects.
                    pass
                finally:
                    self.close_connection = True
                    threading.Thread(target=self.server.shutdown, daemon=True).start()
                return
            if self.path == "/v1/language":
                if set(data) != {"language"}:
                    raise APIError(400, "invalid_language", "The language endpoint accepts only language.")
                language = self.server.manager.update_language(data["language"])
                self._respond(200, {"language": language})
                return
            if self.path == "/v1/close-behavior":
                if set(data) != {"closeBehavior"}:
                    raise APIError(400, "invalid_close_behavior", "Provide only closeBehavior.")
                self._respond(200, {"settings": self.server.manager.update_close_behavior(data["closeBehavior"])})
                return
            if self.path == "/v1/player-shortcuts-seen":
                if data:
                    raise APIError(400, "invalid_body", "The shortcut hint endpoint does not accept additional fields.")
                self.server.manager.mark_player_shortcut_hint_shown()
                self._respond(200, {"shown": True})
                return
            if self.path == "/v1/install-directory-confirmation":
                if (set(data) != {"expectedRevision"} or
                        not isinstance(data["expectedRevision"], str) or
                        not RE_HEX32.fullmatch(data["expectedRevision"])):
                    raise APIError(400, "invalid_settings", "Directory confirmation accepts only expectedRevision.")
                self._respond(200, self.server.manager.confirm_install_directory(data["expectedRevision"]))
                return
            if self.path == "/v1/installations/check":
                if set(data) != {"expectedRevision", "charts"}:
                    raise APIError(400, "invalid_installations", "Installation checks accept only expectedRevision and charts.")
                self._respond(200, self.server.manager.check_installations(data["charts"], data["expectedRevision"]))
                return
            if self.path == "/v1/installations/index":
                if set(data) != {"expectedRevision"}:
                    raise APIError(400, "invalid_installations", "The installation index accepts only expectedRevision.")
                self._respond(200, self.server.manager.index_installations(data["expectedRevision"]))
                return
            if self.path == "/v1/installations/delete":
                if set(data) != {"expectedRevision", "songId", "fileReference", "updateHash"}:
                    raise APIError(400, "invalid_deletion", "Chart deletion accepts only expectedRevision, songId, fileReference and updateHash.")
                self._respond(200, self.server.manager.delete_installation(
                    data["songId"], data["fileReference"], data["updateHash"], data["expectedRevision"]))
                return
            if self.path == "/v1/directory/select":
                if (set(data) != {"expectedRevision"} or not isinstance(data["expectedRevision"], str) or
                        not RE_HEX32.fullmatch(data["expectedRevision"])):
                    raise APIError(400, "invalid_settings", "Folder selection accepts only expectedRevision.")
                self._respond(200, self.server.manager.select_directory(data["expectedRevision"]))
                return
            if self.path == "/v1/settings":
                if (set(data) != {"directory", "expectedRevision"} or
                        data["directory"] is not None or
                        not isinstance(data["expectedRevision"], str) or not RE_HEX32.fullmatch(data["expectedRevision"])):
                    raise APIError(400, "invalid_settings", "Settings accept only directory (null to restore the default) and expectedRevision.")
                settings = self.server.manager.update_directory(data["directory"], data["expectedRevision"])
                self._respond(200, {"settings": settings})
                return
            if set(data) != {"songId", "requestId"}:
                raise APIError(400, "invalid_install", "Installation requests accept only songId and requestId.")
            revisions = self.headers.get_all("X-SpinShare-Settings")
            if not revisions or len(revisions) != 1 or not RE_HEX32.fullmatch(revisions[0]):
                raise APIError(400, "invalid_revision", "The request is missing a valid settings revision. Reopen the executable.")
            job = self.server.manager.submit(data["songId"], data["requestId"], settings_revision=revisions[0])
            if self.server.desktop is not None:
                with contextlib.suppress(Exception):
                    self.server.desktop.activity_changed()
            self._respond(202, {"job": job})
        except APIError as exc:
            self._respond(exc.status, {"error": str(exc), "code": exc.code, **exc.details})
        except installer.InstallError as exc:
            queue_full = getattr(exc, "code", "") == "queue_full"
            self._respond(429 if queue_full else 400, {"error": str(exc), "code": "queue_full" if queue_full else "invalid_request"})
        except OSError:
            self._respond(500, {"error": "Settings could not be saved. Check directory permissions, free space and file locks.", "code": "settings_io_error"})


def _runtime_signature(value, token):
    unsigned = {name: value[name] for name in ("schemaVersion", "port", "pid", "instanceId")}
    return hmac.new(token.encode("ascii"), _json_bytes(unsigned), hashlib.sha256).hexdigest()


class PortableApplication:
    def __init__(self, state_dir, *, desktop=False):
        self.store = ConfigStore(state_dir)
        saved = self.store.load()
        self.template = load_web_template()
        self.catalog = load_catalog()
        # A fresh session epoch prevents an old page from replaying a pending
        # request after a restart, even if the OS happens to reuse the same port.
        self.config = dict(saved, revision=secrets.token_hex(16))
        self.store.save(self.config)
        self.manager = PortableManager(self.store, self.config)
        self.instance_id = secrets.token_hex(16)
        self.started = threading.Event()
        self.closed = threading.Event()
        self._close_lock = threading.Lock()
        try:
            self.server = PortableHTTPServer((HOST, 0), PortableHandler)
            self.server.capability = self.config["token"]
            self.server.manager = self.manager
            self.chart_cache = ChartCatalogCache(self.store.directory)
            self.server.chart_cache = self.chart_cache
            self.server.instance_id = self.instance_id
            self.port = self.server.server_address[1]
            self.origin = "http://127.0.0.1:" + str(self.port)
            self.ui_path = "/ui/" + secrets.token_hex(32) + "/index.html"
            self.server.ui_path = self.ui_path
            self.server.ui_origin = self.origin
            self.server.render_page = self.render_page
            if desktop:
                import maintenance
                self.webview_directory = maintenance.prepare_webview_directory(self.store.directory, self.manager.target_dir)
            self.runtime_path = self.store.directory / RUNTIME_NAME
            runtime = {"schemaVersion": 1, "port": self.port, "pid": os.getpid(), "instanceId": self.instance_id}
            runtime["signature"] = _runtime_signature(runtime, self.config["token"])
            _atomic_write(self.runtime_path, _json_bytes(runtime))
        except BaseException:
            self.manager.close_if_idle()
            self.manager.join(3)
            if hasattr(self, "server"):
                self.server.server_close()
            raise

    @property
    def token(self):
        return self.config["token"]

    @property
    def desktop(self):
        return self.server.desktop

    @desktop.setter
    def desktop(self, value):
        self.server.desktop = value
        self.manager.directory_picker = value.choose_directory if value is not None else None
        self.manager.settings_changed = value.settings_changed if value is not None else None

    def chart_catalog_status(self, *, include_data=True):
        return self.chart_cache.status(include_data=include_data)

    def update_chart_catalog(self):
        return self.chart_cache.manual_update()

    def check_chart_catalog_automatically(self):
        return self.chart_cache.automatic_update()

    def bootstrap(self, config=None):
        config = self.manager.config if config is None else config
        return {"mode": "desktop", "key": self.token, "origin": self.origin,
                "targetDirectory": str(self.store.target_for(config)), "defaultDirectory": str(self.store.default_directory),
                "settingsRevision": config["revision"], "language": config["language"],
                "closeBehavior": config["closeBehavior"],
                "playerShortcutHintShown": config["playerShortcutHintShown"],
                "installDirectoryConfirmed": config["installDirectoryConfirmed"], "version": VERSION}

    def render_page(self):
        with self.manager.lock:
            config = self.bootstrap()
        return render_page(self.template, config, self.catalog).encode("utf-8")

    def serve_forever(self):
        self.started.set()
        try:
            self.server.serve_forever(poll_interval=0.1)
        finally:
            self._finish()

    def _finish(self):
        with self._close_lock:
            if self.closed.is_set():
                return
            self.server.server_close()
            if self.manager.close_if_idle():
                self.manager.join()
            try:
                runtime = read_runtime(self.store.directory, self.token)
                if runtime["instanceId"] == self.instance_id and runtime["pid"] == os.getpid():
                    _remove_file(self.runtime_path)
            except FileNotFoundError:
                pass
            finally:
                self.closed.set()

    def close(self):
        if not self.manager.close_if_idle():
            raise PortableError("The application cannot stop while installations are active.")
        if self.closed.is_set():
            return
        if self.started.is_set():
            self.server.shutdown()
            self.closed.wait()
        else:
            self._finish()


def read_runtime(state_dir, token):
    try:
        runtime = _parse_json(_read_bytes(Path(state_dir) / RUNTIME_NAME, limit=4096))
    except (ValueError, UnicodeError) as exc:
        raise PortableError("Local runtime metadata is corrupt.") from exc
    if (not isinstance(runtime, dict) or set(runtime) != RUNTIME_FIELDS or
            type(runtime.get("schemaVersion")) is not int or runtime["schemaVersion"] != 1 or
            type(runtime.get("port")) is not int or not 1024 <= runtime["port"] <= 65535 or
            type(runtime.get("pid")) is not int or not 0 < runtime["pid"] <= 0xFFFFFFFF or
            not isinstance(runtime.get("instanceId"), str) or not RE_HEX32.fullmatch(runtime["instanceId"]) or
            not isinstance(runtime.get("signature"), str) or not RE_HEX64.fullmatch(runtime["signature"]) or
            not hmac.compare_digest(runtime["signature"], _runtime_signature(runtime, token))):
        raise PortableError("Local runtime metadata failed authentication.")
    return runtime


def _existing_health(runtime, token):
    # Connect directly to the signed loopback port.
    connection = http.client.HTTPConnection(HOST, runtime["port"], timeout=1)
    try:
        connection.request("GET", "/v1/health", headers={"Origin": "null", "X-SpinShare-Key": token, "X-SpinShare-Native": "1"})
        response = connection.getresponse()
        data = response.read(8193)
        if response.status != 200 or len(data) > 8192:
            return False
        health = _parse_json(data)
        return (isinstance(health, dict) and health.get("ok") is True and
                health.get("pid") == runtime["pid"] and health.get("instanceId") == runtime["instanceId"])
    except (OSError, ValueError, http.client.HTTPException):
        return False
    finally:
        connection.close()


class InstanceLock:
    def __init__(self, state_dir, *, name=None):
        self.directory = _directory_syntax(state_dir)
        digest = hashlib.sha256(os.path.normcase(str(self.directory)).encode("utf-8")).hexdigest()
        self.owned = False
        self.handle = None
        self.stream = None
        if os.name == "nt":
            from ctypes import wintypes
            self.kernel = ctypes.WinDLL("kernel32", use_last_error=True)
            self.kernel.CreateMutexW.argtypes = [ctypes.c_void_p, wintypes.BOOL, wintypes.LPCWSTR]
            self.kernel.CreateMutexW.restype = wintypes.HANDLE
            self.kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
            self.kernel.WaitForSingleObject.restype = wintypes.DWORD
            self.kernel.ReleaseMutex.argtypes = [wintypes.HANDLE]
            self.kernel.CloseHandle.argtypes = [wintypes.HANDLE]
            self.handle = self.kernel.CreateMutexW(None, False, name or "Local\\SpinShareBrowser-" + digest)
            if not self.handle:
                raise ctypes.WinError(ctypes.get_last_error())
        else:
            with _directory_guard(self.directory):
                path = self.directory / ("maintenance.lock" if name else "instance.lock")
                if os.path.lexists(path):
                    _safe_info(path, directory=False)
                descriptor = os.open(path, os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
                self.stream = os.fdopen(descriptor, "a+b")
                if os.fstat(descriptor).st_nlink != 1:
                    self.close()
                    raise PortableError("The local instance lock has hard links.")

    def try_acquire(self):
        if self.owned:
            return True
        if os.name == "nt":
            result = self.kernel.WaitForSingleObject(self.handle, 0)
            if result in {0, 0x80}:
                self.owned = True
            elif result != 0x102:
                raise ctypes.WinError(ctypes.get_last_error())
        else:
            import fcntl
            try:
                fcntl.flock(self.stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
                self.owned = True
            except BlockingIOError:
                pass
        return self.owned

    def close(self):
        if os.name == "nt" and self.handle:
            if self.owned:
                self.kernel.ReleaseMutex(self.handle)
            self.kernel.CloseHandle(self.handle)
            self.handle = None
        if self.stream is not None:
            self.stream.close()
            self.stream = None
        self.owned = False


def show_existing(runtime, token):
    connection = http.client.HTTPConnection(HOST, runtime["port"], timeout=3)
    try:
        connection.request("POST", "/v1/desktop/show", body=b"{}", headers={
            "Origin": "null", "X-SpinShare-Key": token, "X-SpinShare-Native": "1", "Content-Type": "application/json"})
        response = connection.getresponse()
        response.read(8193)
        return response.status == 202
    except (OSError, http.client.HTTPException):
        return False
    finally:
        connection.close()


def launch(state_dir=None, *, no_browser=False):
    import maintenance
    state_dir = _directory_syntax(state_dir or default_state_directory())
    gate = InstanceLock(state_dir, name=maintenance.gate_name(state_dir))
    lock = None
    application = None
    until = time.monotonic() + 10

    def acquire_gate():
        while not gate.try_acquire():
            if time.monotonic() >= until:
                raise PortableError("Setup is working on SpinShare Browser. Close Setup before opening the app.")
            time.sleep(0.15)

    try:
        acquire_gate()
        with _directory_guard(state_dir, create=True):
            pass
        lock = InstanceLock(state_dir)
        while not lock.try_acquire():
            gate.close()
            try:
                config = _parse_json(_read_bytes(state_dir / CONFIG_NAME, limit=MAX_SETTINGS_BYTES))
                if not isinstance(config, dict) or not isinstance(config.get("token"), str) or not RE_HEX64.fullmatch(config["token"]):
                    raise PortableError("Local config.json is corrupt.")
                runtime = read_runtime(state_dir, config["token"])
                if _existing_health(runtime, config["token"]):
                    if no_browser or show_existing(runtime, config["token"]):
                        return 0
            except FileNotFoundError:
                pass  # Another double click may still be starting the local service.
            if time.monotonic() >= until:
                raise PortableError("The running app is still starting or is unresponsive.")
            time.sleep(0.15)
            gate = InstanceLock(state_dir, name=maintenance.gate_name(state_dir))
            acquire_gate()
        application = PortableApplication(state_dir, desktop=not no_browser)
        gate.close()
        if no_browser:
            application.serve_forever()
        else:
            import desktop
            desktop.run(application)
        return 0
    finally:
        if application is not None and not application.closed.is_set():
            application.manager.begin_exit()
            application.manager.work.join()
            application.close()
        if lock is not None:
            lock.close()
        gate.close()


def main(argv=None):
    parser = argparse.ArgumentParser(description="SpinShare Browser")
    parser.add_argument("--state-dir", type=Path, help=argparse.SUPPRESS)
    parser.add_argument("--no-browser", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--maintenance", choices=("prepare", "prepare-uninstall", "cleanup"), help=argparse.SUPPRESS)
    parser.add_argument("--install-dir", type=Path, help=argparse.SUPPRESS)
    parser.add_argument("--language", choices=("en", "zh-CN"), help=argparse.SUPPRESS)
    parser.add_argument("--parent-pid", type=int, help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    try:
        if args.maintenance:
            import maintenance
            operation = {"prepare": maintenance.prepare_upgrade,
                         "prepare-uninstall": maintenance.prepare_uninstall,
                         "cleanup": maintenance.cleanup_state}[args.maintenance]
            with maintenance.watchdog(args.parent_pid):
                operation(args.state_dir or default_state_directory(), args.install_dir or Path(sys.executable).parent)
            return 0
        return launch(args.state_dir, no_browser=args.no_browser)
    except (OSError, installer.InstallError, RuntimeError) as exc:
        language = args.language or "en"
        if args.language is None:
            try:
                saved = _parse_json(_read_bytes((args.state_dir or default_state_directory()) / CONFIG_NAME, limit=MAX_SETTINGS_BYTES))
                if saved.get("language") in LANGUAGES:
                    language = saved["language"]
            except (OSError, ValueError, AttributeError, PortableError):
                pass
        title = "Setup could not continue." if args.maintenance else "SpinShare Browser could not start."
        detail = str(exc)
        button_text = "OK"
        try:
            messages = load_catalog()[language]
            title = messages.get(title, title)
            detail = messages.get(detail, detail)
            button_text = messages.get("OK", "OK")
        except (OSError, ValueError, PortableError):
            pass
        message = title + "\n\n" + detail
        if os.name == "nt" and not args.no_browser and not args.maintenance:
            from desktop import show_startup_error
            show_startup_error(message, button_text)
        elif sys.stderr is not None:
            sys.stderr.write(message + "\n")
        return getattr(exc, "exit_code", 1)


if __name__ == "__main__":
    sys.modules.setdefault("spinshare_portable", sys.modules[__name__])
    raise SystemExit(main())
