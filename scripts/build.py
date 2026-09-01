"""Build the Windows application, installer, and source archive."""

from __future__ import annotations

import importlib.metadata
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import struct
import subprocess
import sys
import urllib.request
import zipfile

PROJECT = Path(__file__).resolve().parent.parent
VERSION = "2.0.0"
SOURCE_DATE_EPOCH = "1788048000"
WEB_FILES = ("web/index.html", "web/interface.css", "web/chart-card.js", "web/app.js", "web/locales.json")
SOURCE_FILES = (
    ".gitattributes", ".gitignore", "LICENSE", "README.md", "README.zh-CN.md", "CHANGELOG.md",
    "PRODUCT.md", "DESIGN.md",
    "requirements-build.txt", "src/installer.py", "src/spinshare_portable.py",
    "src/desktop.py", "src/maintenance.py",
    "tests/test_external_links.py", "tests/test_tag_filters.cjs", "tests/test_date_picker.cjs",
    "tests/test_catalog_ui.cjs", "tests/test_catalog_sync.cjs", "tests/test_chart_cache.py",
    "tests/test_desktop_notifications.py", "tests/test_windows_installer.py",
    "tests/test_review_drawers.cjs", "tests/test_installation_filters.cjs", "tests/test_audio_player.cjs",
    "tests/test_focus_modality.cjs", "tests/test_choice_menus.cjs",
    "tests/test_install_queue.py", "tests/test_install_pipeline.py", "tests/test_download_transport.py",
    "tests/read_web_template.cjs", "tests/test_web_resources.py",
    "tests/test_install_directory_confirmation.py", "tests/test_install_directory_confirmation.cjs",
    *WEB_FILES, "scripts/build.py", "scripts/windows.iss",
    "assets/spinshare-browser.png", "assets/spinshare-browser-favicon.png",
    "assets/spinshare-browser.ico",
    "assets/windows-version.txt", "assets/README.md", "assets/README.zh-CN.md",
    "licenses/runtime-notices.txt", "licenses/spinshare-icon-GPL-3.0.txt",
    "licenses/webview2-runtime-license.txt", "licenses/windows-notices.txt",
    "docs/build.md", "docs/build.zh-CN.md",
    "docs/images/overview-en.png", "docs/images/overview-zh-CN.png",
    "docs/images/workflow-en.gif", "docs/images/workflow-zh-CN.gif",
)
LICENSE_NAME = "THIRD-PARTY-LICENSES.txt"
INNO_VERSION = "7.1.0"
INNO_SHA256 = "0362a383ed217d4c4239b5933866dd96d3eb2102737da92f80f6057a4b40df2f"
WEBVIEW2_SDK = "1.0.3856.49"
WEBVIEW2_SDK_SHA256 = "bc0f76eb911b569838dc4aa8f8d325269b966bedb592863d26211aef3a099f1a"


def project_path(name: str) -> Path:
    path = PROJECT / name
    resolved = path.resolve()
    if not resolved.is_relative_to(PROJECT) or resolved != path.absolute():
        raise ValueError(f"Use a regular path inside the project: {name}")
    return path


def license_text(sources: dict[str, bytes]) -> bytes:
    parts = [
        f"SpinShare Browser {VERSION} - third-party notices\n",
        f"===== Python {platform.python_version()} =====\n",
        (Path(sys.base_prefix) / "LICENSE.txt").read_text(encoding="utf-8-sig"),
    ]
    for name in ("licenses/runtime-notices.txt", "assets/README.md",
                 "licenses/spinshare-icon-GPL-3.0.txt", "licenses/windows-notices.txt",
                 "licenses/webview2-runtime-license.txt"):
        parts.extend((f"\n===== {name} =====\n", sources[name].decode("utf-8-sig")))
    for line in sources["requirements-build.txt"].decode("utf-8").splitlines():
        package = line.strip().split("==")[0]
        if not package or package.startswith("#"):
            continue
        distribution = importlib.metadata.distribution(package)
        notices = sorted(
            (file for file in distribution.files or []
             if re.fullmatch(r"(LICENSE|COPYING|NOTICE)([._-].*)?", file.name, re.I)
             and file.suffix.lower() not in {".py", ".pyc"}),
            key=str,
        )
        if not notices and package == "proxy_tools":
            continue  # The upstream license is included in windows-notices.txt.
        if not notices:
            raise ValueError(f"Install {package} with its license files.")
        for file in notices:
            parts.extend((
                f"\n===== {package} {distribution.version} / {file.as_posix()} =====\n",
                distribution.locate_file(file).read_text(encoding="utf-8-sig"),
            ))
    return "\n".join(parts).replace("\r\n", "\n").encode("utf-8")


def download_tool(url: str, name: str, *, sha256: str | None = None) -> Path:
    path = project_path("build/tools/" + name)
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.is_file():
        temporary = path.with_suffix(path.suffix + ".download")
        try:
            with urllib.request.urlopen(url, timeout=90) as response:
                data = response.read(64 * 1024 * 1024 + 1)
            if len(data) > 64 * 1024 * 1024:
                raise ValueError(f"Download exceeds the size limit: {name}")
            temporary.write_bytes(data)
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)
    if sha256 and hashlib.sha256(path.read_bytes()).hexdigest() != sha256:
        raise ValueError(f"The downloaded build tool has changed: {name}")
    return path


def check_signature(path: Path, publisher: str) -> None:
    literal = str(path).replace("'", "''")
    script = "$s=Get-AuthenticodeSignature -LiteralPath '" + literal + "'; @{status=[string]$s.Status;subject=$s.SignerCertificate.Subject}|ConvertTo-Json -Compress"
    result = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
                            capture_output=True, text=True, check=True,
                            env=dict(os.environ, PSModulePath=str(Path(os.environ["SystemRoot"]) / "System32" / "WindowsPowerShell" / "v1.0" / "Modules")),
                            creationflags=subprocess.CREATE_NO_WINDOW)
    signature = json.loads(result.stdout.lstrip("\ufeff"))
    if signature["status"] != "Valid" or publisher not in signature.get("subject", ""):
        raise ValueError(f"The publisher signature is invalid: {path.name}")


def build_tools() -> tuple[Path, Path, Path]:
    compiler = project_path("build/tools/inno-" + INNO_VERSION + "/ISCC.exe")
    if not compiler.is_file():
        setup = download_tool(
            f"https://github.com/jrsoftware/issrc/releases/download/is-{INNO_VERSION.replace('.', '_')}/innosetup-{INNO_VERSION}-x64.exe",
            f"innosetup-{INNO_VERSION}-x64.exe", sha256=INNO_SHA256)
        check_signature(setup, "Pyrsys B.V.")
        subprocess.run([str(setup), "/PORTABLE=1", "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART",
                        "/CURRENTUSER", "/NOICONS", "/TASKS=", "/DIR=" + str(compiler.parent)],
                       check=True, creationflags=subprocess.CREATE_NO_WINDOW)
    check_signature(compiler, "Pyrsys B.V.")
    bootstrapper = download_tool("https://go.microsoft.com/fwlink/p/?LinkId=2124703", "MicrosoftEdgeWebview2Setup.exe")
    check_signature(bootstrapper, "Microsoft Corporation")
    package_name = f"microsoft.web.webview2.{WEBVIEW2_SDK}.nupkg"
    sdk = download_tool(f"https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/{WEBVIEW2_SDK}/{package_name}", package_name,
                        sha256=WEBVIEW2_SDK_SHA256)
    return compiler, bootstrapper, sdk


def write_zip(path: Path, entries: dict[str, bytes]) -> None:
    with zipfile.ZipFile(path, "w") as archive:
        for name, data in sorted(entries.items()):
            info = zipfile.ZipInfo(name, (2026, 8, 30, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data, zipfile.ZIP_DEFLATED, compresslevel=9)


def write_program_files(payload: Path, destination: Path) -> None:
    files = sorted(path.relative_to(payload).as_posix().replace("/", "\\")
                   for path in payload.rglob("*") if path.is_file())
    lines = ["procedure GetProgramFiles(var Files: TArrayOfString);", "begin",
             f"  SetArrayLength(Files, {len(files)});"]
    lines.extend(f"  Files[{index}] := '" + name.replace("'", "''") + "';" for index, name in enumerate(files))
    destination.write_text("\n".join([*lines, "end;", ""]), encoding="utf-8")


def main() -> None:
    if (sys.platform != "win32" or sys.version_info < (3, 12)
            or struct.calcsize("P") != 8 or platform.machine().upper() != "AMD64"):
        raise ValueError("Use Python 3.12 or newer on Windows x64.")

    compiler, bootstrapper, sdk = build_tools()
    sources = {name: project_path(name).read_bytes() for name in SOURCE_FILES}
    build = project_path("build/pyinstaller")
    snapshot = project_path("build/pyinstaller/source")
    staging = project_path("build/windows")
    output = project_path("build/windows/SpinShareBrowser")
    for name in ("build/pyinstaller/source", "build/windows",
                 "build/pyinstaller/work", "build/pyinstaller/spec",
                 "build/pyinstaller/cache", "dist"):
        project_path(name).mkdir(parents=True, exist_ok=True)
    for name, data in sources.items():
        path = project_path("build/pyinstaller/source/" + name)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    notices = license_text(sources)
    notice_path = project_path("build/pyinstaller/" + LICENSE_NAME)
    notice_path.write_bytes(notices)
    environment = dict(os.environ, PYTHONHASHSEED="1", SOURCE_DATE_EPOCH=SOURCE_DATE_EPOCH,
                       PYINSTALLER_CONFIG_DIR=str(build / "cache"))
    subprocess.run([
        sys.executable, "-m", "PyInstaller", "--onedir", "--windowed", "--noupx",
        "--noconfirm", "--name", "SpinShareBrowser",
        "--icon", str(snapshot / "assets" / "spinshare-browser.ico"),
        "--version-file", str(snapshot / "assets" / "windows-version.txt"),
        "--distpath", str(staging), "--workpath", str(build / "work"),
        "--specpath", str(build / "spec"), "--paths", str(snapshot / "src"),
        *[argument for name in WEB_FILES for argument in ("--add-data", f"{snapshot / name}{os.pathsep}web")],
        "--add-data", f"{snapshot / 'assets' / 'spinshare-browser.ico'}{os.pathsep}assets",
        "--resource", f"{os.path.relpath(notice_path, build / 'spec')},10,22000,0",
        str(snapshot / "src" / "spinshare_portable.py"),
    ], cwd=PROJECT, env=environment, check=True)

    # Obtain Microsoft's redistributable files directly from its NuGet package.
    with zipfile.ZipFile(sdk) as package:
        sdk_files = {
            "lib/net462/Microsoft.Web.WebView2.Core.dll": "Microsoft.Web.WebView2.Core.dll",
            "lib/net462/Microsoft.Web.WebView2.WinForms.dll": "Microsoft.Web.WebView2.WinForms.dll",
        }
        for architecture in ("win-arm64", "win-x64", "win-x86"):
            member = f"runtimes/{architecture}/native/WebView2Loader.dll"
            sdk_files[member] = member
        for member, destination in sdk_files.items():
            path = project_path("build/windows/SpinShareBrowser/_internal/webview/lib/" + destination)
            if not path.is_file():
                raise ValueError(f"The WebView2 assembly was not bundled: {destination}")
            path.write_bytes(package.read(member))
            check_signature(path, "Microsoft Corporation")
    for name, data in {"LICENSE": sources["LICENSE"], LICENSE_NAME: notices,
                       "WEBVIEW2-LICENSE.txt": sources["licenses/webview2-runtime-license.txt"]}.items():
        (output / name).write_bytes(data)
    program_files = project_path("build/windows/program-files.iss")
    write_program_files(output, program_files)
    subprocess.run([
        str(compiler), "/Qp", "/DPayloadDir=" + str(output),
        "/DProgramFilesInclude=" + str(program_files),
        "/DWebView2Bootstrapper=" + str(bootstrapper),
        "/DRuntimeLicenseFile=" + str(notice_path),
        "/DOutputDir=" + str(project_path("dist")), "/DAppVersion=" + VERSION,
        str(project_path("scripts/windows.iss")),
    ], cwd=PROJECT, check=True, creationflags=subprocess.CREATE_NO_WINDOW)
    archive_name = f"SpinShareBrowser-{VERSION}-source.zip"
    write_zip(project_path("dist/" + archive_name), {
        f"SpinShareBrowser-{VERSION}/{name}": data for name, data in sources.items()
    })
    setup_name = f"SpinShareBrowser-{VERSION}-windows-x64-setup.exe"
    setup_path = project_path("dist/" + setup_name)
    project_path("dist/" + setup_name + ".sha256").write_text(
        hashlib.sha256(setup_path.read_bytes()).hexdigest() + "  " + setup_name + "\n", encoding="ascii")
    print(f"Created dist/{setup_name}")
    print(f"Created dist/{archive_name}")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        sys.exit(f"Build failed: {error}")
