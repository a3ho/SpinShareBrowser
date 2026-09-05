"""Install/upgrade/uninstall smoke checks, exclusively on fresh GitHub-hosted Windows runners.

Never invoke this script on a workstation. It intentionally runs real installers.
Service lifecycle checks use --no-browser. A separate native-window smoke runs only
inside the disposable hosted runner and may show its own application window there.
"""
from __future__ import annotations

import argparse
import ctypes
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import tempfile
import time


def require_hosted_runner():
    if (sys.platform != "win32" or os.environ.get("GITHUB_ACTIONS") != "true"
            or os.environ.get("RUNNER_ENVIRONMENT") != "github-hosted"
            or os.environ.get("RUNNER_OS") != "Windows"
            or os.environ.get("CI_SPINSHARE_INSTALL_SMOKE") != "1"):
        raise RuntimeError("Installer smoke checks run only in the dedicated GitHub-hosted Windows job.")
    temporary = Path(os.environ["RUNNER_TEMP"]).resolve(strict=True)
    workspace = Path(os.environ["GITHUB_WORKSPACE"]).resolve(strict=True)
    return temporary, workspace


def verified_installer(value, allowed_roots):
    path = Path(value).resolve(strict=True)
    if not any(path.is_relative_to(root) for root in allowed_roots):
        raise ValueError("Installer must be a downloaded CI artifact inside the workspace or runner temp directory.")
    match = re.fullmatch(r"SpinShareBrowser-([0-9]+\.[0-9]+\.[0-9]+)-windows-x64-setup\.exe", path.name)
    if not match or not path.is_file():
        raise ValueError("Unexpected installer filename.")
    sidecar = path.with_name(path.name + ".sha256")
    record = sidecar.read_text(encoding="ascii").strip().split()
    if len(record) != 2 or record[1] != path.name or not re.fullmatch(r"[0-9a-fA-F]{64}", record[0]):
        raise ValueError("Invalid installer checksum sidecar.")
    with path.open("rb") as stream:
        actual = hashlib.file_digest(stream, "sha256").hexdigest()
    if actual != record[0].lower():
        raise ValueError("Installer checksum mismatch.")
    return path, match[1]


def installed_versions():
    import winreg
    values = []
    for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
        for view in (winreg.KEY_WOW64_64KEY, winreg.KEY_WOW64_32KEY):
            try:
                with winreg.OpenKey(hive, r"Software\Microsoft\Windows\CurrentVersion\Uninstall\SpinShareBrowser_is1",
                                    0, winreg.KEY_READ | view) as key:
                    try:
                        values.append(winreg.QueryValueEx(key, "DisplayVersion")[0])
                    except FileNotFoundError:
                        values.append(None)  # A damaged entry still means this runner is not fresh.
            except FileNotFoundError:
                pass
    return values


def run_setup(executable, log):
    subprocess.run([str(executable), "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/SP-",
                    "/LOG=" + str(log)], check=True, timeout=600,
                   creationflags=subprocess.CREATE_NO_WINDOW)


def api_request(state, method, path, body=None):
    runtime = json.loads((state / "runtime.json").read_text(encoding="utf-8"))
    config = json.loads((state / "config.json").read_text(encoding="utf-8"))
    connection = http.client.HTTPConnection("127.0.0.1", runtime["port"], timeout=2)
    try:
        connection.request(method, path, json.dumps(body) if body is not None else None, {
            "Origin": "null", "X-SpinShare-Native": "1", "X-SpinShare-Key": config["token"],
            "Content-Type": "application/json"})
        response = connection.getresponse()
        result = json.loads(response.read(65537))
        if response.status not in (200, 202):
            raise RuntimeError(f"Packaged service returned HTTP {response.status} for {path}.")
        return result
    finally:
        connection.close()


def start_service(executable, state, *, desktop=False):
    process = subprocess.Popen([str(executable), *([] if desktop else ["--no-browser"])],
                               creationflags=subprocess.CREATE_NO_WINDOW)
    try:
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError(f"Packaged service exited before publishing health: {process.returncode}")
            try:
                runtime = json.loads((state / "runtime.json").read_text(encoding="utf-8"))
                if runtime["pid"] != process.pid:
                    raise RuntimeError("Runtime metadata belongs to an unexpected process.")
                health = api_request(state, "GET", "/v1/health")
                if (health.get("ok") is True and health.get("pid") == process.pid
                        and health.get("instanceId") == runtime["instanceId"] and health.get("activeJobs") == 0):
                    return process
            except (OSError, ValueError, KeyError, http.client.HTTPException):
                pass
            time.sleep(0.1)
        raise RuntimeError("Packaged service did not become healthy within 30 seconds.")
    except BaseException:
        # This is exclusively a child started in this fresh hosted-runner check.
        process.terminate()
        process.wait(timeout=10)
        raise


def wait_until(check, message, process=None, timeout=30):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process is not None and process.poll() is not None:
            raise RuntimeError("The native application exited before its window check completed.")
        if check():
            return
        time.sleep(0.1)
    raise RuntimeError(message)


def desktop_smoke(executable, state):
    require_hosted_runner()
    # An empty but fresh catalog exercises startup without fetching SpinShare charts or artwork.
    cached = {"schemaVersion": 3, "lastAttemptAt": None, "fetchedAt": time.time_ns() // 1000000,
              "refreshError": None, "data": [], "automaticFailureCount": 0, "automaticLastAttemptAt": None,
              "automaticNextAllowedAt": None, "automaticRefreshError": None, "automaticErrorCode": None}
    (state / "charts-cache.json").write_text(json.dumps(cached), encoding="utf-8")
    process = start_service(executable, state, desktop=True)
    handles = []
    from ctypes import wintypes
    user, kernel = ctypes.WinDLL("user32"), ctypes.WinDLL("kernel32")
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user.EnumWindows.argtypes = [callback_type, wintypes.LPARAM]
    user.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    for name in ("IsWindow", "IsWindowVisible", "IsZoomed", "IsIconic"):
        getattr(user, name).argtypes = [wintypes.HWND]
        getattr(user, name).restype = wintypes.BOOL
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    try:
        def ready():
            window = api_request(state, "GET", "/v1/desktop/window")["window"]
            return window.get("customChrome") is True and window.get("visible") is True
        wait_until(ready, "Packaged WebView2/native frame did not become ready.", process)
        windows = []
        @callback_type
        def find_window(handle, _):
            pid = wintypes.DWORD()
            user.GetWindowThreadProcessId(handle, ctypes.byref(pid))
            title = ctypes.create_unicode_buffer(256)
            user.GetWindowTextW(handle, title, len(title))
            if pid.value == process.pid and user.IsWindowVisible(handle) and title.value == "SpinShare Browser":
                windows.append(handle)
            return True
        user.EnumWindows(find_window, 0)
        if len(windows) != 1:
            raise RuntimeError("Expected one visible SpinShare Browser window owned by the test process.")
        window = windows[0]
        for action, check in (("maximize", lambda: bool(user.IsZoomed(window))),
                              ("maximize", lambda: not user.IsZoomed(window) and not user.IsIconic(window)),
                              ("minimize", lambda: bool(user.IsIconic(window)))):
            api_request(state, "POST", "/v1/desktop/window", {"action": action})
            wait_until(check, f"The native window did not finish {action}.", process)
        api_request(state, "POST", "/v1/desktop/show", {})
        wait_until(lambda: bool(user.IsWindowVisible(window)) and not user.IsIconic(window),
                   "The native window did not restore.", process)
        # Capture only this application's descendants; keep process handles so PID reuse cannot fool exit checks.
        result = subprocess.run([
            "powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
            "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress"],
            capture_output=True, text=True, check=True, timeout=20, creationflags=subprocess.CREATE_NO_WINDOW)
        inventory = json.loads(result.stdout.lstrip("\ufeff"))
        descendants = {process.pid}
        while True:
            found = {item["ProcessId"] for item in inventory if item["ParentProcessId"] in descendants}
            if found <= descendants:
                break
            descendants.update(found)
        for pid in descendants - {process.pid}:
            handle = kernel.OpenProcess(0x00100000, False, pid)
            if handle:
                handles.append(handle)
        api_request(state, "POST", "/v1/desktop/exit", {})
        if process.wait(timeout=30) != 0:
            raise RuntimeError("The native application did not exit successfully.")
        wait_until(lambda: not user.IsWindow(window) and not (state / "runtime.json").exists()
                   and all(kernel.WaitForSingleObject(handle, 0) == 0 for handle in handles),
                   "The native window, runtime metadata or an observed WebView2 child remained after exit.")
        after = json.loads((state / "charts-cache.json").read_text(encoding="utf-8"))
        if after["lastAttemptAt"] is not None or after["automaticLastAttemptAt"] is not None:
            raise RuntimeError("The native fixture unexpectedly attempted a remote catalog update.")
        print("Native WebView2 smoke passed: custom frame, maximize/restore/minimize/show, clean exit.")
    finally:
        if process.poll() is None:
            process.terminate()
            process.wait(timeout=10)
        for handle in handles:
            kernel.CloseHandle(handle)


def main(argv=None):
    temporary, workspace = require_hosted_runner()  # Fail before touching registry, files or processes.
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--installer", required=True)
    parser.add_argument("--previous", help="Optional previously released installer and SHA-256 sidecar.")
    args = parser.parse_args(argv)
    current, version = verified_installer(args.installer, (temporary, workspace))
    baseline, baseline_version = verified_installer(args.previous, (temporary, workspace)) if args.previous else (current, version)
    if tuple(map(int, baseline_version.split("."))) > tuple(map(int, version.split("."))):
        raise ValueError("Upgrade baseline must not be newer than the candidate.")

    sys.path.insert(0, str(workspace / "src"))
    import installer
    local = installer.known_folder_path("F1B32785-6FBA-4FCF-9D55-7B8E7F157091")
    state, program = local / "SpinShareBrowser", local / "Programs" / "SpinShareBrowser"
    if os.path.lexists(state) or os.path.lexists(program) or installed_versions():
        raise RuntimeError("Smoke checks require a fresh runner with no existing SpinShare Browser data or installation.")
    fixture = Path(tempfile.mkdtemp(prefix="spinshare-install-smoke-", dir=temporary))
    if fixture.parent.resolve() != temporary:
        raise RuntimeError("Unexpected fixture directory.")
    game = fixture / "Custom"
    game.mkdir()
    sentinel = {"fixture.srtb": b"isolated chart fixture", "AlbumArt/fixture.png": b"isolated cover fixture",
                "AudioClips/fixture.ogg": b"isolated audio fixture", "download.zip": b"isolated archive fixture"}
    for name, data in sentinel.items():
        path = game / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    processes = []
    try:
        run_setup(baseline, fixture / "install.log")
        executable = program / "SpinShareBrowser.exe"
        if not executable.is_file() or baseline_version not in installed_versions():
            raise RuntimeError("Fresh installation did not register the expected version.")
        state.mkdir(exist_ok=True)
        config = {"schemaVersion": 1, "token": secrets.token_hex(32), "revision": secrets.token_hex(16),
                  "customDirectory": str(game), "language": "en"}
        (state / "config.json").write_text(json.dumps(config), encoding="utf-8")
        (state / "user-note.txt").write_bytes(b"unknown user data must remain")
        original = start_service(executable, state)
        processes.append(original)
        run_setup(current, fixture / "upgrade.log")
        if original.wait(timeout=30) != 0:
            raise RuntimeError("Upgrade did not gracefully stop the original packaged service.")
        saved = json.loads((state / "config.json").read_text(encoding="utf-8"))
        if any(saved.get(key) != config[key] for key in ("token", "customDirectory", "language")):
            raise RuntimeError("Upgrade changed saved user settings.")
        if version not in installed_versions():
            raise RuntimeError("Upgrade did not register the candidate version.")
        desktop_smoke(executable, state)
        upgraded = start_service(executable, state)
        processes.append(upgraded)
        run_setup(program / "unins000.exe", fixture / "uninstall.log")
        if upgraded.wait(timeout=30) != 0:
            raise RuntimeError("Uninstall did not gracefully stop the packaged service.")
        if executable.exists() or installed_versions() or any((state / name).exists()
                for name in ("config.json", "runtime.json", "charts-cache.json")):
            raise RuntimeError("Uninstall left the registered app or recognized settings behind.")
        if (state / "user-note.txt").read_bytes() != b"unknown user data must remain":
            raise RuntimeError("Uninstall changed an unknown state file.")
        for name, data in sentinel.items():
            if (game / name).read_bytes() != data:
                raise RuntimeError("Installation, upgrade or uninstall changed a chart fixture.")
        print(f"Hosted Windows smoke passed: {baseline_version} -> {version}; settings retained on upgrade; charts retained on uninstall.")
    finally:
        for process in processes:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=10)
        # Retain only installer logs for CI artifact upload; no config/token is exported.
        logs = workspace / "build" / "smoke-logs"
        logs.mkdir(parents=True, exist_ok=True)
        for path in fixture.glob("*.log"):
            (logs / path.name).write_bytes(path.read_bytes())


if __name__ == "__main__":
    main()
