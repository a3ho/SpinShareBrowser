"""Exercise real Inno maintenance Cancel/Retry on a private, non-input desktop.

No global input is sent. Setup and its children belong to a kill-on-close job,
and every control message is checked against that job and the private desktop.
Only fixture snapshots/builds below .qa are changed; dependencies are stubbed and
shortcuts/uninstall registration are disabled in the compiled snapshot.
"""
from __future__ import annotations

import argparse
import ctypes
from ctypes import wintypes as W
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
QA = ROOT / ".qa"
CALLBACK = ctypes.WINFUNCTYPE(W.BOOL, W.HWND, W.LPARAM)


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def fixture_path(path):
    path = path.absolute()
    require(path == path.resolve() and path.is_relative_to(QA.resolve()) and path != QA,
            "Every generated path must be an ordinary directory below .qa")
    return path


def replace_once(source, pattern, replacement):
    result, count = re.subn(pattern, lambda match: replacement, source, flags=re.M | re.S)
    require(count == 1, "Production installer changed; review fixture patch: " + pattern[:70])
    return result


def fixture_source(source, *, negative):
    source = replace_once(source, r"^SetupIconFile=.*?$", "SetupIconFile=" + str(ROOT / "assets/spinshare-browser.ico"))
    source = replace_once(source, r"^\[Tasks\].*?(?=^\[Files\])", "")
    source = replace_once(source, r"^\[Icons\].*?(?=^\[Code\])", "")
    source = replace_once(source, r"^UninstallLogMode=.*?$", "Uninstallable=no\nCreateUninstallRegKey=no\nUsePreviousAppDir=no\nUsePreviousLanguage=no\nUsePreviousTasks=no")
    # Avoid duplicate Setup keys while retaining the explicit isolated overrides.
    for key in ("UsePreviousAppDir", "UsePreviousLanguage", "UsePreviousTasks"):
        source = source.replace(key + "=yes\n", "")
    source = replace_once(source, r"^function DotNetAvailable: Boolean;.*?(?=^function WebView2VersionSupported)",
                          "function DotNetAvailable: Boolean;\nbegin\n  Result := True;\nend;\n\n")
    source = replace_once(source, r"^function WebView2Available: Boolean;.*?(?=^function DetectExistingInstallInRoot)",
                          "function WebView2Available: Boolean;\nbegin\n  Result := True;\nend;\n\n")
    if negative:
        source = replace_once(source, r"^function RetryPreparation\(const MessageText: String\): Boolean;.*?(?=^procedure CancelButtonClick)",
                              "function RetryPreparation(const MessageText: String): Boolean;\nbegin\n  Result := AskRetry(MessageText);\n  if not Result and not SilentOperation then\n  begin\n    MaintenanceCancelRequested := True;\n    WizardForm.Close;\n  end;\nend;\n\n")
        source = replace_once(source, r"(      if not RetryPreparation\(Result\) then\n      begin\n).*?(?=        Exit;\n      end;)",
                              "      if not RetryPreparation(Result) then\n      begin\n        if not SilentOperation then\n          Result := '';\n")
    require("[Icons]" not in source and "[Tasks]" not in source and "Uninstallable=no" in source,
            "Fixture isolation is incomplete")
    return source


def run_hidden(command, log):
    temporary = fixture_path(log.parent / "compiler-temp")
    temporary.mkdir(exist_ok=True)
    environment = dict(os.environ, TEMP=str(temporary), TMP=str(temporary))
    with log.open("wb") as output:
        result = subprocess.run(command, cwd=ROOT, stdout=output, stderr=subprocess.STDOUT,
                                env=environment, creationflags=subprocess.CREATE_NO_WINDOW, timeout=90)
    require(result.returncode == 0, "Fixture compilation failed: " + str(log))


def build_fixture(directory, compiler, source, negative):
    directory = fixture_path(directory)
    directory.mkdir()
    payload = directory / "payload"
    payload.mkdir()
    state = directory / "state"
    state.mkdir()
    (state / "sentinel.txt").write_bytes(b"fixture state must remain unchanged")
    app = directory / "app"
    trace, ready = directory / "helper-trace.txt", directory / "ready"
    helper = directory / "Fixture.cs"
    cs_string = lambda value: '@"' + str(value).replace('"', '""') + '"'
    helper.write_text("""using System;
using System.IO;
class Fixture {
  static int Main(string[] args) {
    string state = null, app = null, mode = null;
    for (int i = 0; i + 1 < args.Length; i++) {
      if (args[i] == "--state-dir") state = args[i + 1];
      if (args[i] == "--install-dir") app = args[i + 1];
      if (args[i] == "--maintenance") mode = args[i + 1];
    }
    if (state != STATE || app != APP || mode != "prepare") return 11;
    int result = File.Exists(READY) ? 0 : 10;
    File.AppendAllText(TRACE, "prepare:" + result + Environment.NewLine);
    return result;
  }
}
""".replace("STATE", cs_string(state)).replace("APP", cs_string(app)).replace("READY", cs_string(ready)).replace("TRACE", cs_string(trace)), encoding="utf-8")
    csc = Path(os.environ["WINDIR"]) / "Microsoft.NET/Framework64/v4.0.30319/csc.exe"
    require(csc.is_file(), "The local .NET C# fixture compiler is unavailable")
    run_hidden([str(csc), "/nologo", "/target:winexe", "/out:" + str(payload / "SpinShareBrowser.exe"), str(helper)], directory / "compile-helper.log")
    (payload / "fixture-marker.txt").write_bytes(b"isolated installer payload")
    license_file = directory / "license.txt"
    license_file.write_text("Isolated automated regression fixture. No production program is bundled.\n", encoding="utf-8")
    include = directory / "program-files.iss"
    include.write_text("procedure GetProgramFiles(var Files: TArrayOfString);\nbegin\n  SetArrayLength(Files, 2);\n  Files[0] := 'SpinShareBrowser.exe';\n  Files[1] := 'fixture-marker.txt';\nend;\n", encoding="utf-8")
    snapshot = directory / "windows.iss"
    snapshot.write_text(fixture_source(source, negative=negative), encoding="utf-8")
    defines = {"PayloadDir": payload, "WebView2Bootstrapper": payload / "SpinShareBrowser.exe",
               "RuntimeLicenseFile": license_file, "ProgramFilesInclude": include,
               "AppId": "SpinShareBrowser.QA.Private." + uuid.uuid4().hex,
               "AppName": "SpinShare Private Regression", "StateDir": state, "InstallDir": app,
               "OutputDir": directory, "SetupBaseName": "fixture-setup"}
    run_hidden([str(compiler), *["/D" + name + "=" + str(value) for name, value in defines.items()], str(snapshot)], directory / "compile-setup.log")
    return directory / "fixture-setup.exe"


class StartupInfo(ctypes.Structure):
    _fields_ = [("cb", W.DWORD), ("reserved", W.LPWSTR), ("desktop", W.LPWSTR), ("title", W.LPWSTR),
                ("x", W.DWORD), ("y", W.DWORD), ("cx", W.DWORD), ("cy", W.DWORD),
                ("xchars", W.DWORD), ("ychars", W.DWORD), ("fill", W.DWORD), ("flags", W.DWORD),
                ("show", W.WORD), ("reserved_count", W.WORD), ("reserved_bytes", ctypes.c_void_p),
                ("stdin", W.HANDLE), ("stdout", W.HANDLE), ("stderr", W.HANDLE)]


class ProcessInfo(ctypes.Structure):
    _fields_ = [("process", W.HANDLE), ("thread", W.HANDLE), ("pid", W.DWORD), ("tid", W.DWORD)]


class BasicLimits(ctypes.Structure):
    _fields_ = [("process_time", ctypes.c_longlong), ("job_time", ctypes.c_longlong), ("flags", W.DWORD),
                ("min_working", ctypes.c_size_t), ("max_working", ctypes.c_size_t), ("active_limit", W.DWORD),
                ("affinity", ctypes.c_size_t), ("priority", W.DWORD), ("scheduling", W.DWORD)]


class ExtendedLimits(ctypes.Structure):
    _fields_ = [("basic", BasicLimits), ("io", ctypes.c_ulonglong * 6),
                ("process_memory", ctypes.c_size_t), ("job_memory", ctypes.c_size_t),
                ("peak_process", ctypes.c_size_t), ("peak_job", ctypes.c_size_t)]


class PrivateSetup:
    def __init__(self, setup, directory, language):
        self.directory, self.events = directory, []
        self.kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        self.user = ctypes.WinDLL("user32", use_last_error=True)
        k, u = self.kernel, self.user
        for name, args, result in (
            ("CreateJobObjectW", [ctypes.c_void_p, W.LPCWSTR], W.HANDLE),
            ("SetInformationJobObject", [W.HANDLE, ctypes.c_int, ctypes.c_void_p, W.DWORD], W.BOOL),
            ("AssignProcessToJobObject", [W.HANDLE, W.HANDLE], W.BOOL),
            ("IsProcessInJob", [W.HANDLE, W.HANDLE, ctypes.POINTER(W.BOOL)], W.BOOL),
            ("OpenProcess", [W.DWORD, W.BOOL, W.DWORD], W.HANDLE),
            ("CloseHandle", [W.HANDLE], W.BOOL),
            ("ResumeThread", [W.HANDLE], W.DWORD),
            ("TerminateProcess", [W.HANDLE, W.UINT], W.BOOL),
            ("GetExitCodeProcess", [W.HANDLE, ctypes.POINTER(W.DWORD)], W.BOOL),
            ("WaitForSingleObject", [W.HANDLE, W.DWORD], W.DWORD),
            ("CreateProcessW", [W.LPCWSTR, W.LPWSTR, ctypes.c_void_p, ctypes.c_void_p, W.BOOL, W.DWORD, ctypes.c_void_p, W.LPCWSTR, ctypes.POINTER(StartupInfo), ctypes.POINTER(ProcessInfo)], W.BOOL),
        ):
            function = getattr(k, name)
            function.argtypes, function.restype = args, result
        for name, args, result in (
            ("CreateDesktopW", [W.LPCWSTR, W.LPCWSTR, ctypes.c_void_p, W.DWORD, W.DWORD, ctypes.c_void_p], W.HANDLE),
            ("CloseDesktop", [W.HANDLE], W.BOOL),
            ("EnumDesktopWindows", [W.HANDLE, CALLBACK, W.LPARAM], W.BOOL),
            ("EnumChildWindows", [W.HWND, CALLBACK, W.LPARAM], W.BOOL),
            ("GetWindowThreadProcessId", [W.HWND, ctypes.POINTER(W.DWORD)], W.DWORD),
            ("GetClassNameW", [W.HWND, W.LPWSTR, ctypes.c_int], ctypes.c_int),
            ("GetWindowTextW", [W.HWND, W.LPWSTR, ctypes.c_int], ctypes.c_int),
            ("IsWindowVisible", [W.HWND], W.BOOL),
            ("IsWindowEnabled", [W.HWND], W.BOOL),
            ("PostMessageW", [W.HWND, W.UINT, W.WPARAM, W.LPARAM], W.BOOL),
        ):
            function = getattr(u, name)
            function.argtypes, function.restype = args, result
        self.desktop = self.job = None
        self.process = ProcessInfo()
        try:
            name = "SpinSharePrivateQA_" + uuid.uuid4().hex
            self.desktop = u.CreateDesktopW(name, None, None, 0, 0xC3, None)
            require(self.desktop, "Could not create a private desktop: " + str(ctypes.get_last_error()))
            self.job = k.CreateJobObjectW(None, None)
            require(self.job, "Could not create a fixture process job")
            limits = ExtendedLimits()
            limits.basic.flags = 0x2000
            require(k.SetInformationJobObject(self.job, 9, ctypes.byref(limits), ctypes.sizeof(limits)), "Could not bound fixture process lifetime")
            startup = StartupInfo()
            # A desktop-only lpDesktop uses the window station that created it.
            startup.cb, startup.desktop = ctypes.sizeof(startup), name
            startup.flags, startup.show = 1 | 0x80, 1
            command = subprocess.list2cmdline([str(setup), "/SP-", "/LANG=" + language, "/NOICONS", "/TASKS=", "/LOG=" + str(directory / "setup.log")])
            temporary = fixture_path(directory / "setup-temp")
            temporary.mkdir()
            environment = dict(os.environ, TEMP=str(temporary), TMP=str(temporary))
            environment_block = ctypes.create_unicode_buffer("\0".join(key + "=" + value for key, value in sorted(environment.items())) + "\0\0")
            require(k.CreateProcessW(str(setup), ctypes.create_unicode_buffer(command), None, None, False,
                                     4 | 0x400, environment_block, str(directory), ctypes.byref(startup), ctypes.byref(self.process)),
                    "Could not launch fixture on its private desktop: " + str(ctypes.get_last_error()))
            require(k.AssignProcessToJobObject(self.job, self.process.process), "Could not contain the fixture process")
            require(k.ResumeThread(self.process.thread) != 0xffffffff, "Could not start the contained fixture")
        except BaseException:
            if self.process.process:
                k.TerminateProcess(self.process.process, 90)
            self.close()
            raise

    def close(self):
        if self.job:
            self.kernel.CloseHandle(self.job)
            self.job = None
        if self.process.process:
            self.kernel.WaitForSingleObject(self.process.process, 3000)
        for name in ("thread", "process"):
            handle = getattr(self.process, name)
            if handle:
                self.kernel.CloseHandle(handle)
                setattr(self.process, name, None)
        if self.desktop:
            self.user.CloseDesktop(self.desktop)
            self.desktop = None

    def owned(self, window):
        pid, answer = W.DWORD(), W.BOOL()
        self.user.GetWindowThreadProcessId(window, ctypes.byref(pid))
        process = self.kernel.OpenProcess(0x1000, False, pid.value)
        if not process:
            return False
        try:
            return bool(self.kernel.IsProcessInJob(process, self.job, ctypes.byref(answer)) and answer.value)
        finally:
            self.kernel.CloseHandle(process)

    def describe(self, window):
        kind, text = ctypes.create_unicode_buffer(128), ctypes.create_unicode_buffer(2048)
        self.user.GetClassNameW(window, kind, len(kind))
        self.user.GetWindowTextW(window, text, len(text))
        return {"hwnd": int(window), "kind": kind.value, "text": text.value,
                "visible": bool(self.user.IsWindowVisible(window)), "enabled": bool(self.user.IsWindowEnabled(window))}

    def windows(self):
        result = []
        @CALLBACK
        def inspect(window, parameter):
            if self.owned(window) and self.user.IsWindowVisible(window):
                entry = self.describe(window)
                entry["children"] = []
                @CALLBACK
                def child(handle, unused):
                    entry["children"].append(self.describe(handle))
                    return True
                self.user.EnumChildWindows(window, child, 0)
                result.append(entry)
            return True
        ctypes.set_last_error(0)
        enumerated = self.user.EnumDesktopWindows(self.desktop, inspect, 0)
        require(enumerated or ctypes.get_last_error() == 0,
                "Could not enumerate the private desktop: " + str(ctypes.get_last_error()))
        return result

    def click(self, control, action):
        require(self.owned(control["hwnd"]) and control["visible"] and control["enabled"], "Refusing an unowned or inactive button")
        require(self.user.PostMessageW(control["hwnd"], 0xF5, 0, 0), "Could not click the fixture button")
        self.events.append({"action": action, "kind": control["kind"], "caption": control["text"]})

    def exit_code(self):
        code = W.DWORD()
        require(self.kernel.GetExitCodeProcess(self.process.process, ctypes.byref(code)), "Cannot read fixture exit status")
        return None if code.value == 259 else code.value

    def exercise(self, action):
        handled, deadline, last_click = False, time.monotonic() + 35, 0
        last_windows = []
        while self.exit_code() is None and time.monotonic() < deadline:
            last_windows = self.windows()
            if time.monotonic() - last_click < .25:
                time.sleep(.03)
                continue
            for window in last_windows:
                controls = [item for item in window["children"] if item["visible"] and item["enabled"]]
                captions = {re.sub(r"\([a-z]\)|（[a-z]）", "", item["text"].replace("&", "").lower()).strip().rstrip(">").strip(): item for item in controls}
                retry_caption = next((text for text in ("retry", "try again", "重试", "再试一次") if text in captions), None)
                cancel_caption = next((text for text in ("cancel", "取消") if text in captions), None)
                if retry_caption and cancel_caption:
                    require(not handled, "The maintenance dialog unexpectedly repeated")
                    trace = (self.directory / "helper-trace.txt").read_text()
                    require("prepare:10" in trace, "The dialog is not the controlled maintenance-busy branch")
                    if action == "retry":
                        (self.directory / "ready").write_text("ready", encoding="ascii")
                    self.click(captions[retry_caption if action == "retry" else cancel_caption], "maintenance-" + action)
                    handled, last_click = True, time.monotonic()
                    break
                if window["kind"] != "TWizardForm":
                    continue
                accept = next((item for text, item in captions.items() if text.startswith(("i accept", "我同意"))), None)
                advance = next((captions[text] for text in ("next", "install", "finish", "下一步", "安装", "完成") if text in captions), None)
                if advance:
                    self.click(advance, "wizard-advance")
                    last_click = time.monotonic()
                    break
                if accept:
                    self.click(accept, "accept-fixture-license")
                    last_click = time.monotonic()
                    break
            time.sleep(.03)
        (self.directory / "interaction.json").write_text(json.dumps({"events": self.events, "lastWindows": last_windows}, ensure_ascii=False, indent=2), encoding="utf-8")
        require(self.exit_code() is not None, "Private fixture did not exit; diagnostic interaction.json was retained")
        require(handled, "The maintenance Retry/Cancel interaction was not exercised")
        return self.exit_code()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--compiler", type=Path, default=ROOT / "build/tools/inno-7.1.0/ISCC.exe")
    parser.add_argument("--work-dir", type=Path)
    parser.add_argument("--prove-regression", dest="negative_control", action="store_true", help="Also compile the old cancellation bug and require it to continue installing after Cancel")
    args = parser.parse_args()
    require(os.name == "nt", "This private-desktop native regression requires Windows")
    work = fixture_path(args.work_dir or QA / ("native-maintenance-" + uuid.uuid4().hex[:12]))
    require(not work.exists(), "Use a fresh test directory")
    require(args.compiler.is_file(), "Inno compiler is unavailable")
    work.mkdir(parents=True)
    source = (ROOT / "scripts/windows.iss").read_text(encoding="utf-8")
    (work / "production-source.iss").write_text(source, encoding="utf-8")
    results = []
    scenarios = [(language + "-" + action, action, language, False)
                 for language in ("en", "zh_CN") for action in ("cancel", "retry")]
    if args.negative_control:
        scenarios.append(("legacy-cancel", "cancel", "en", True))
    for scenario, action, language, negative in scenarios:
        directory = work / scenario
        setup = build_fixture(directory, args.compiler, source, negative)
        fixture = PrivateSetup(setup, directory, language)
        try:
            exit_code = fixture.exercise(action)
        finally:
            fixture.close()
        installed = (directory / "app/fixture-marker.txt").exists()
        calls = (directory / "helper-trace.txt").read_text().splitlines()
        require((directory / "state/sentinel.txt").read_bytes() == b"fixture state must remain unchanged", "Fixture settings changed")
        if action == "cancel":
            passed = exit_code != 0 and not (directory / "app").exists() and calls == ["prepare:10"]
            if negative:
                require(exit_code == 0 and installed and calls == ["prepare:10"],
                        "Negative control did not reproduce installation after failed maintenance and Cancel")
            else:
                require(passed, "Cancellation failed: Setup continued or wrote application files")
        else:
            passed = exit_code == 0 and installed and calls == ["prepare:10", "prepare:0"]
            require(passed, "Retry did not finish the isolated installation")
        results.append({"scenario": scenario, "language": language, "action": action,
                        "exitCode": exit_code, "installed": installed, "calls": calls,
                        "passed": passed or negative, "legacyBugDetected": negative})
    report = {"privateDesktop": True, "globalInputUsed": False, "negativeControl": args.negative_control,
              "sourceSha256": hashlib.sha256(source.encode()).hexdigest(), "results": results}
    (work / "results.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"workDir": str(work), **report}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
