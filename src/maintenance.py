"""Coordinate installer maintenance and remove only application-owned data."""
from __future__ import annotations

import contextlib
import ctypes
import hashlib
import hmac
import http.client
import os
from pathlib import Path
import re
import stat
import time

import installer
import spinshare_portable as portable


APP_ID = "SpinShareBrowser"
MARKER_NAME = ".spinshare-owner.json"
COMPONENTS = {"WebView2": "webview2", "Temp": "temp"}
MAX_PAGE_BYTES = 4 * 1024 * 1024
MAX_COMPONENT_ENTRIES = 100000
TEMP_NAME = re.compile(r"\.spinshare-(?:(config\.json|runtime\.json|browser\.html|charts-cache\.json)-)?[a-z0-9_]{8}\.tmp")


class MaintenanceError(portable.PortableError):
    def __init__(self, message, exit_code=11):
        super().__init__(message)
        self.exit_code = exit_code


def gate_name(state_dir):
    value = str(portable._directory_syntax(state_dir))
    if os.name == "nt":
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.LCMapStringEx.argtypes = [ctypes.c_wchar_p, ctypes.c_uint, ctypes.c_wchar_p,
                                       ctypes.c_int, ctypes.c_wchar_p, ctypes.c_int,
                                       ctypes.c_void_p, ctypes.c_void_p, ctypes.c_ssize_t]
        kernel.LCMapStringEx.restype = ctypes.c_int
        length = kernel.LCMapStringEx("", 0x100, value, -1, None, 0, None, None, 0)
        if not length:
            raise ctypes.WinError(ctypes.get_last_error())
        output = ctypes.create_unicode_buffer(length)
        if not kernel.LCMapStringEx("", 0x100, value, -1, output, length, None, None, 0):
            raise ctypes.WinError(ctypes.get_last_error())
        value = output.value
    else:
        value = os.path.normcase(value)
    return "Local\\SpinShareBrowserMaintenance-" + hashlib.sha256(value.encode("utf-16le")).hexdigest()


def _overlap(first, second):
    first, second = Path(first), Path(second)
    return first == second or first in second.parents or second in first.parents


def _read_config(state):
    path = state / portable.CONFIG_NAME
    if not os.path.lexists(path):
        return None
    return _parse_config(portable._read_bytes(path, limit=portable.MAX_SETTINGS_BYTES))


def _parse_config(raw):
    try:
        config = portable._parse_json(raw)
    except (ValueError, UnicodeError) as exc:
        raise MaintenanceError("The existing configuration could not be identified; it was retained.") from exc
    required = {"schemaVersion", "token", "customDirectory", "revision"}
    expected = portable.CONFIG_FIELDS
    if (not isinstance(config, dict) or not required <= set(config) <= expected or
            type(config.get("schemaVersion")) is not int or config["schemaVersion"] != 1 or
            not isinstance(config.get("token"), str) or not portable.RE_HEX64.fullmatch(config["token"]) or
            not isinstance(config.get("revision"), str) or not portable.RE_HEX32.fullmatch(config["revision"]) or
            not isinstance(config.get("language", "zh-CN"), str) or
            config.get("language", "zh-CN") not in portable.LANGUAGES or
            not isinstance(config.get("closeBehavior", "ask"), str) or
            config.get("closeBehavior", "ask") not in portable.CLOSE_BEHAVIORS or
            type(config.get("trayNoticeShown", False)) is not bool or
            config.get("customDirectory") is not None and
            (not isinstance(config["customDirectory"], str) or not config["customDirectory"])):
        raise MaintenanceError("The existing configuration has an unknown format; it was retained.")
    if not portable.valid_window_size(config.get("windowSize")):
        config = dict(config, windowSize=None)
    return config


def _locations(state_dir, install_dir, config, *, cleanup=False):
    state = portable.validate_directory(state_dir)
    install = portable.validate_directory(install_dir)
    protected = [portable.validate_directory(installer.default_target_directory())]
    if config and config["customDirectory"] is not None:
        protected.append(portable.validate_directory(config["customDirectory"]))
    for game in protected:
        if _overlap(install, game) or not cleanup and _overlap(state, game):
            raise MaintenanceError("Application data or program files overlap a game directory. The directory was retained.")
    if _overlap(state, install):
        raise MaintenanceError("The program directory overlaps application data. The directory was retained.")
    return state, install, protected


def _identity(path, directory):
    info = portable._safe_info(path, directory=directory)
    return [info.st_dev, info.st_ino]


def _marker(path, component):
    try:
        value = portable._parse_json(portable._read_bytes(path / MARKER_NAME, limit=4096))
    except FileNotFoundError:
        return None
    except (ValueError, UnicodeError) as exc:
        raise MaintenanceError("An application data ownership marker is invalid; its directory was retained.") from exc
    if (not isinstance(value, dict) or set(value) != {"schemaVersion", "appId", "component", "directoryId"} or
            type(value["schemaVersion"]) is not int or value["schemaVersion"] != 1 or
            value["appId"] != APP_ID or value["component"] != component or
            not isinstance(value["directoryId"], list) or len(value["directoryId"]) != 2 or
            any(type(part) is not int for part in value["directoryId"]) or
            value["directoryId"] != _identity(path, True)):
        raise MaintenanceError("An application data directory no longer matches its ownership marker; it was retained.")
    return value


@contextlib.contextmanager
def _owned_component(state_dir, name, protected):
    state = portable.validate_directory(state_dir)
    protected = [portable.validate_directory(installer.default_target_directory()),
                 *(portable.validate_directory(path) for path in protected)]
    if any(_overlap(state, game) for game in protected):
        raise MaintenanceError("Application data overlaps a game directory. Select a separate game directory.")
    component = state / name
    with portable._directory_guard(state, create=True):
        created = False
        if not os.path.lexists(component):
            component.mkdir()
            created = True
        with portable._directory_guard(component):
            if _marker(component, COMPONENTS[name]) is None:
                if not created:
                    raise MaintenanceError("The application data directory has no ownership marker; its contents were retained.")
                portable._atomic_write(component / MARKER_NAME, portable._json_bytes({
                    "schemaVersion": 1, "appId": APP_ID, "component": COMPONENTS[name],
                    "directoryId": _identity(component, True)}))
            yield component


def prepare_webview_directory(state_dir, protected_directory):
    with _owned_component(state_dir, "WebView2", [protected_directory]) as component:
        profile = component / "profile"
        with portable._directory_guard(profile, create=True):
            return profile


@contextlib.contextmanager
def prepare_temp_directory(state_dir):
    state = portable.validate_directory(state_dir)
    config = _read_config(state)
    protected = [config["customDirectory"]] if config and config["customDirectory"] else []
    with _owned_component(state, "Temp", protected) as component:
        yield component


@contextlib.contextmanager
def _process(pid):
    handle = None
    kernel = None
    if os.name == "nt":
        from ctypes import wintypes
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        kernel.WaitForSingleObject.restype = wintypes.DWORD
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        handle = kernel.OpenProcess(0x00100000, False, pid)
        if not handle:
            raise MaintenanceError("The running application could not be identified. Close it and retry.", 10)
    try:
        yield lambda: kernel.WaitForSingleObject(handle, 0) == 0 if handle else True
    finally:
        if handle:
            kernel.CloseHandle(handle)


def _shutdown(runtime, token):
    connection = http.client.HTTPConnection(portable.HOST, runtime["port"], timeout=3)
    headers = {"Origin": "null", "X-SpinShare-Key": token, "X-SpinShare-Native": "1"}
    try:
        connection.request("GET", "/v1/health", headers=headers)
        response = connection.getresponse()
        raw = response.read(8193)
        if response.status != 200 or len(raw) > 8192:
            raise MaintenanceError("The running application could not be identified. Close it and retry.", 10)
        health = portable._parse_json(raw)
        if (not isinstance(health, dict) or health.get("ok") is not True or
                health.get("pid") != runtime["pid"] or health.get("instanceId") != runtime["instanceId"] or
                type(health.get("activeJobs")) is not int or health["activeJobs"] != 0):
            raise MaintenanceError("Finish chart installations and close the application before continuing.", 10)
        connection.request("POST", "/v1/shutdown", "{}", {**headers, "Content-Type": "application/json"})
        response = connection.getresponse()
        raw = response.read(8193)
        result = portable._parse_json(raw) if len(raw) <= 8192 else None
        if response.status != 202 or not isinstance(result, dict) or result.get("ok") is not True:
            raise MaintenanceError("The application is still busy. Close it and retry.", 10)
    except (OSError, ValueError, http.client.HTTPException) as exc:
        raise MaintenanceError("The application could not be closed safely. Close it and retry.", 10) from exc
    finally:
        connection.close()


@contextlib.contextmanager
def _idle_state(state_dir, install_dir, *, cleanup=False):
    if gate_name(state_dir) != gate_name(portable.default_state_directory()):
        raise MaintenanceError("Maintenance only supports the application's default data directory.")
    state = portable.validate_directory(state_dir)
    config = _read_config(state) if state.exists() else None
    state, install, protected = _locations(state, install_dir, config, cleanup=cleanup)
    if os.name != "nt" and not state.exists():
        yield state, config, protected
        return
    lock = portable.InstanceLock(state)
    try:
        if not lock.try_acquire():
            if config is None:
                raise MaintenanceError("The application is starting. Close it and retry.", 10)
            try:
                runtime = portable.read_runtime(state, config["token"])
            except (OSError, portable.PortableError):
                raise MaintenanceError("The running application could not be identified. Close it and retry.", 10) from None
            if runtime["pid"] == os.getpid():
                raise MaintenanceError("Maintenance must run in a separate process.", 10)
            with _process(runtime["pid"]) as exited:
                _shutdown(runtime, config["token"])
                deadline = time.monotonic() + 15
                while not (lock.try_acquire() and exited()):
                    if time.monotonic() >= deadline:
                        raise MaintenanceError("The application has not finished closing. Retry after it exits.", 10)
                    time.sleep(0.05)
        config = _read_config(state) if state.exists() else None
        _, _, protected = _locations(state, install, config, cleanup=cleanup)
        yield state, config, protected
    finally:
        lock.close()


def prepare_upgrade(state_dir, install_dir, *, cleanup=False):
    try:
        with _idle_state(state_dir, install_dir, cleanup=cleanup) as (state, config, _):
            page = state / portable.PAGE_NAME
            if cleanup or not os.path.lexists(page):
                return {"removed": [], "retained": []}
            if config is None:
                return {"removed": [], "retained": [page.name]}
            with portable._directory_guard(state), _pin_document(state / portable.CONFIG_NAME):
                try:
                    identity = _identity(page, False)
                    raw = portable._read_bytes(page, limit=MAX_PAGE_BYTES)
                    _validate_page(raw, config)
                except portable.PortableError:
                    return {"removed": [], "retained": [page.name]}
                if _read_config(state) != config:
                    raise MaintenanceError("The application configuration changed during maintenance. Retry after it closes.")
                _delete_entry(page, identity, digest=hashlib.sha256(raw).digest())
            return {"removed": [page.name], "retained": []}
    except MaintenanceError:
        raise
    except portable.PortableError as exc:
        raise MaintenanceError(str(exc)) from exc
    except OSError as exc:
        raise MaintenanceError("Application data could not be read. Close applications using its files and retry.", 12) from exc


def prepare_uninstall(state_dir, install_dir):
    return prepare_upgrade(state_dir, install_dir, cleanup=True)


def _is_version(value):
    if not isinstance(value, str) or len(value) > 128:
        return False
    match = re.fullmatch(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)"
                         r"(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?"
                         r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?", value)
    return bool(match and all(not (part.isdecimal() and len(part) > 1 and part[0] == "0")
                              for part in (match[1] or "").split(".")))


def _validate_page(raw, config):
    if config is None:
        raise MaintenanceError("The generated page cannot be identified without its configuration; it was retained.")
    try:
        text = raw.decode("utf-8")
        match = re.search(r"const\s+APP_CONFIG\s*=\s*validateRuntimeConfig\((\{[^\r\n]*\})\);", text)
        bootstrap = portable._parse_json(match[1].encode("utf-8")) if match else None
    except (ValueError, UnicodeError) as exc:
        raise MaintenanceError("The generated page has an unknown format; it was retained.") from exc
    if (not isinstance(bootstrap, dict) or bootstrap.get("mode") not in {"portable", "desktop"} or
            not _is_version(bootstrap.get("version")) or not isinstance(bootstrap.get("key"), str) or
            not portable.RE_HEX64.fullmatch(bootstrap["key"]) or
            not hmac.compare_digest(bootstrap["key"], config["token"]) or
            "function validateRuntimeConfig(" not in text or "<title>SpinShare" not in text):
        raise MaintenanceError("The generated page does not match this application; it was retained.")


def _is_runtime(raw, config):
    try:
        value = portable._parse_json(raw)
    except (ValueError, UnicodeError):
        return False
    return (isinstance(value, dict) and set(value) == portable.RUNTIME_FIELDS and
            type(value.get("schemaVersion")) is int and value["schemaVersion"] == 1 and
            type(value.get("port")) is int and 1024 <= value["port"] <= 65535 and
            type(value.get("pid")) is int and 0 < value["pid"] <= 0xFFFFFFFF and
            isinstance(value.get("instanceId"), str) and portable.RE_HEX32.fullmatch(value["instanceId"]) and
            isinstance(value.get("signature"), str) and portable.RE_HEX64.fullmatch(value["signature"]) and
            hmac.compare_digest(value["signature"], portable._runtime_signature(value, config["token"])))


def _legacy_temporaries(state, config):
    candidates, documents, owners = [], {}, [config] if config else []
    for path in state.iterdir():
        match = TEMP_NAME.fullmatch(path.name)
        if not match or stat.S_ISDIR(path.lstat().st_mode):
            continue
        portable._safe_info(path, directory=False)
        candidates.append((path, match[1]))
        if len(candidates) > 128:
            raise MaintenanceError("Application data contains too many temporary files for safe cleanup; they were retained.")
    for path, target in candidates:
        if target == portable.CHART_CACHE_NAME:
            if path.lstat().st_size <= portable.MAX_CHART_CACHE_BYTES:
                raw = portable._read_bytes(path, limit=portable.MAX_CHART_CACHE_BYTES)
                try:
                    portable.validate_chart_cache(portable._parse_json(raw))
                except (ValueError, portable.PortableError):
                    continue
                documents[path] = (_identity(path, False), hashlib.sha256(raw).digest())
            continue
        if target not in {None, portable.CONFIG_NAME} or path.lstat().st_size > portable.MAX_SETTINGS_BYTES:
            continue
        raw = portable._read_bytes(path, limit=portable.MAX_SETTINGS_BYTES)
        try:
            owner = _parse_config(raw)
        except MaintenanceError:
            continue
        if config and not hmac.compare_digest(owner["token"], config["token"]):
            continue
        owners.append(owner)
        documents[path] = (_identity(path, False), hashlib.sha256(raw).digest())
    for path, target in candidates:
        if path in documents or not owners or path.lstat().st_size > MAX_PAGE_BYTES:
            continue
        raw = portable._read_bytes(path, limit=MAX_PAGE_BYTES)
        for owner in owners:
            identified = target in {None, portable.RUNTIME_NAME} and len(raw) <= 4096 and _is_runtime(raw, owner)
            if not identified and target in {None, portable.PAGE_NAME}:
                try:
                    _validate_page(raw, owner)
                    identified = True
                except MaintenanceError:
                    pass
            if identified:
                documents[path] = (_identity(path, False), hashlib.sha256(raw).digest())
                break
    protected = [portable.validate_directory(owner["customDirectory"]) for owner in owners if owner["customDirectory"]]
    return documents, protected


def _plan_cleanup(state, config, protected=()):
    files, directories, retained = [], [], []
    if _read_config(state) != config:
        raise MaintenanceError("The application configuration changed during maintenance. Retry after it closes.")
    temporary, pending_paths = _legacy_temporaries(state, config)
    protected = [*protected, *pending_paths]
    for path in state.iterdir():
        info = path.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400 or info.st_nlink > 1 and stat.S_ISREG(info.st_mode):
            raise MaintenanceError("Application data contains a link; its contents were retained.")
        if path in temporary:
            files.append((path, *temporary[path]))
        elif path.name in COMPONENTS:
            if any(_overlap(path, game) for game in protected):
                portable._safe_info(path, directory=True)
                if _marker(path, COMPONENTS[path.name]) is not None:
                    marker = path / MARKER_NAME
                    raw = portable._read_bytes(marker, limit=4096)
                    files.append((marker, _identity(marker, False), hashlib.sha256(raw).digest()))
                retained.append(path.name)
                continue
            portable._safe_info(path, directory=True)
            if _marker(path, COMPONENTS[path.name]) is None:
                retained.append(path.name)
                continue
            if path.name == "WebView2":
                for child in path.iterdir():
                    if child.name not in {MARKER_NAME, "profile"}:
                        raise MaintenanceError("The WebView2 directory contains an unknown entry; it was retained.")
                    if child.name == "profile":
                        portable._safe_info(child, directory=True)
            pending = [path]
            while pending:
                directory = pending.pop()
                directories.append((directory, _identity(directory, True)))
                for child in directory.iterdir():
                    if (child.suffix.lower() == ".srtb" or child.name.lower() in {"albumart", "audioclips", "custom"} or
                            re.fullmatch(r"(?:spinshare_[a-f0-9]{1,64}|spinshare-download-[0-9]+)(?:-[a-f0-9]{32})?\.zip|\.spinshare-(?:stage|rollback|download)-[^/\\]+\.tmp", child.name, re.I)):
                        raise MaintenanceError("An application data component contains game files; it was retained.")
                    info = child.lstat()
                    is_directory = stat.S_ISDIR(info.st_mode)
                    identity = _identity(child, is_directory)
                    if is_directory:
                        pending.append(child)
                    else:
                        files.append((child, identity, None))
                    if len(files) + len(directories) + len(pending) > MAX_COMPONENT_ENTRIES:
                        raise MaintenanceError("Application data contains too many entries for safe cleanup; it was retained.")
        elif path.name in {portable.CONFIG_NAME, portable.RUNTIME_NAME, portable.PAGE_NAME, portable.CHART_CACHE_NAME}:
            limit = portable.MAX_CHART_CACHE_BYTES if path.name == portable.CHART_CACHE_NAME else MAX_PAGE_BYTES if path.name == portable.PAGE_NAME else portable.MAX_SETTINGS_BYTES
            raw = portable._read_bytes(path, limit=limit)
            if path.name == portable.CONFIG_NAME:
                _read_config(state)
            elif path.name == portable.RUNTIME_NAME:
                if config is None:
                    raise MaintenanceError("Runtime metadata cannot be identified without its configuration; it was retained.")
                portable.read_runtime(state, config["token"])
            elif path.name == portable.CHART_CACHE_NAME:
                try:
                    portable.validate_chart_cache(portable._parse_json(raw))
                except (ValueError, portable.PortableError) as exc:
                    raise MaintenanceError("The chart cache has an unknown format; it was retained.") from exc
            else:
                _validate_page(raw, config)
            files.append((path, _identity(path, False), hashlib.sha256(raw).digest()))
        else:
            retained.append(path.name)
    files.sort(key=lambda entry: entry[0].name in {portable.CONFIG_NAME, MARKER_NAME})
    directories.sort(key=lambda entry: len(entry[0].parts), reverse=True)
    return files, directories, retained


@contextlib.contextmanager
def _pin_document(path):
    if os.name != "nt":
        portable._safe_info(path, directory=False)
        yield
        return
    handle, kernel = portable._windows_open(path, directory=False)
    try:
        yield
    finally:
        kernel.CloseHandle(handle)


def _digest_limit(path):
    temporary = TEMP_NAME.fullmatch(path.name)
    return portable.MAX_CHART_CACHE_BYTES if path.name == portable.CHART_CACHE_NAME or temporary and temporary[1] == portable.CHART_CACHE_NAME else MAX_PAGE_BYTES


def _delete_entry(path, identity, directory=False, digest=None):
    limit = _digest_limit(path)
    with portable._directory_guard(path.parent):
        if os.name != "nt":
            if _identity(path, directory) != identity:
                raise MaintenanceError("An application data entry changed during cleanup; it was retained.")
            if digest is not None and hashlib.sha256(portable._read_bytes(path, limit=limit)).digest() != digest:
                raise MaintenanceError("An application data file changed during cleanup; it was retained.")
            path.rmdir() if directory else path.unlink()
            return
        import msvcrt
        from ctypes import wintypes
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                                      ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
        kernel.CreateFileW.restype = wintypes.HANDLE
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        kernel.SetFileInformationByHandle.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
        kernel.SetFileInformationByHandle.restype = wintypes.BOOL
        flags = 0x00200000 | (0x02000000 if directory else 0)
        access = 0x00010000 | 0x00000080 | (0x80000000 if digest is not None else 0)
        handle = kernel.CreateFileW(str(path), access, 1, None, 3, flags, None)
        if handle == ctypes.c_void_p(-1).value:
            raise ctypes.WinError(ctypes.get_last_error())
        descriptor = None
        try:
            descriptor = msvcrt.open_osfhandle(handle, os.O_RDONLY | os.O_BINARY)
            info = os.fstat(descriptor)
            if (bool(stat.S_ISDIR(info.st_mode)) != directory or
                    stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400 or
                    not directory and (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1) or
                    [info.st_dev, info.st_ino] != identity):
                raise MaintenanceError("An application data entry changed during cleanup; it was retained.")
            if digest is not None:
                raw = os.read(descriptor, limit + 1)
                if len(raw) > limit or hashlib.sha256(raw).digest() != digest:
                    raise MaintenanceError("An application data file changed during cleanup; it was retained.")
            disposition = ctypes.c_ubyte(1)
            if not kernel.SetFileInformationByHandle(handle, 4, ctypes.byref(disposition), ctypes.sizeof(disposition)):
                raise ctypes.WinError(ctypes.get_last_error())
        finally:
            if descriptor is None:
                kernel.CloseHandle(handle)
            else:
                os.close(descriptor)


def cleanup_state(state_dir, install_dir):
    try:
        with _idle_state(state_dir, install_dir, cleanup=True) as (state, config, protected):
            if not state.exists():
                return {"removed": [], "retained": []}
            with portable._directory_guard(state):
                with contextlib.ExitStack() as pinned:
                    if config is not None:
                        pinned.enter_context(_pin_document(state / portable.CONFIG_NAME))
                    files, directories, retained = _plan_cleanup(state, config, protected)
                    temporary = {path for path, _, _ in files if path.parent == state and TEMP_NAME.fullmatch(path.name)}
                    for path, identity, digest in files:
                        if path in temporary:
                            pinned.enter_context(_pin_document(path))
                            if (_identity(path, False) != identity or
                                    hashlib.sha256(portable._read_bytes(path, limit=_digest_limit(path))).digest() != digest):
                                raise MaintenanceError("A temporary application file changed during maintenance; it was retained.")
                    components = {path: identity for path, identity in directories if path.parent == state}
                    markers = {}
                    for path in components:
                        marker = path / MARKER_NAME
                        pinned.enter_context(_pin_document(marker))
                        _marker(path, COMPONENTS[path.name])
                        markers[marker] = portable._read_bytes(marker, limit=4096)
                    removed = []
                    for path, identity, digest in files:
                        if path in markers or path in temporary or path == state / portable.CONFIG_NAME:
                            continue
                        _delete_entry(path, identity, digest=digest)
                        removed.append(str(path.relative_to(state)))
                    for path, identity in directories:
                        if path not in components:
                            _delete_entry(path, identity, True)
                            removed.append(str(path.relative_to(state)))
                for path, identity in components.items():
                    marker = path / MARKER_NAME
                    _delete_entry(marker, _identity(marker, False), digest=hashlib.sha256(markers[marker]).digest())
                    try:
                        _delete_entry(path, identity, True)
                    except (OSError, portable.PortableError):
                        with portable._directory_guard(path):
                            if _identity(path, True) == identity and not os.path.lexists(marker):
                                portable._atomic_write(marker, markers[marker])
                        raise
                    removed.extend([str(marker.relative_to(state)), str(path.relative_to(state))])
                for path, identity, digest in files:
                    if path in temporary or path == state / portable.CONFIG_NAME:
                        _delete_entry(path, identity, digest=digest)
                        removed.append(path.name)
            return {"removed": removed, "retained": retained}
    except MaintenanceError:
        raise
    except portable.PortableError as exc:
        raise MaintenanceError(str(exc)) from exc
    except OSError as exc:
        raise MaintenanceError("Application data could not be cleaned. Close applications using its files and retry.", 12) from exc
