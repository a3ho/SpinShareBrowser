"""Build the Windows application, installer, and source archive."""

from __future__ import annotations

import argparse
import contextlib
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
VERSION = "2.1.0"
SOURCE_DATE_EPOCH = "1788048000"
WEB_FILES = ("web/index.html", "web/interface.css", "web/chart-card.js", "web/app.js", "web/locales.json")
SOURCE_FILES = (
    ".gitattributes", ".gitignore", "AGENTS.md", "LICENSE", "README.md", "README.zh-CN.md", "CHANGELOG.md",
    "PRODUCT.md", "DESIGN.md",
    "requirements-build.txt", "src/installer.py", "src/spinshare_portable.py",
    "src/desktop.py", "src/maintenance.py", "src/audio_preview.py",
    "tests/test_external_links.py", "tests/test_tag_filters.cjs", "tests/test_date_picker.cjs",
    "tests/test_catalog_ui.cjs", "tests/test_catalog_sync.cjs", "tests/test_chart_cache.py",
    "tests/test_desktop_notifications.py", "tests/test_desktop_frame.py", "tests/test_window_regions.cjs", "tests/test_windows_installer.py",
    "tests/test_review_drawers.cjs", "tests/test_installation_filters.cjs", "tests/test_chart_deletion.cjs",
    "tests/test_chart_deletion.py", "tests/test_audio_player.cjs", "tests/test_audio_preview.py", "tests/test_audio_service.py",
    "tests/test_focus_modality.cjs", "tests/test_choice_menus.cjs",
    "tests/test_install_queue.py", "tests/test_install_pipeline.py", "tests/test_download_transport.py",
    "tests/read_web_template.cjs", "tests/test_web_resources.py",
    "tests/test_install_directory_confirmation.py", "tests/test_install_directory_confirmation.cjs",
    "tests/test_installation_status.py", "tests/test_install_recovery.py",
    "tests/test_build.py", "scripts/windows_smoke.py", "scripts/installer_cancel_smoke.py", "scripts/browser_smoke.cjs", ".github/workflows/verify.yml",
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


def check_requirements(raw: bytes) -> dict[str, str]:
    """Reject a different environment before downloading tools or creating output."""
    packages = {}
    for line in raw.decode("utf-8-sig").splitlines():
        line = line.partition("#")[0].strip()
        if not line:
            continue
        match = re.fullmatch(r"([A-Za-z0-9_.-]+)==([A-Za-z0-9_.+!-]+)", line)
        if not match:
            raise ValueError(f"Build requirements must use exact versions: {line}")
        name, expected = match.groups()
        canonical = re.sub(r"[-_.]+", "-", name).lower()
        if canonical in packages:
            raise ValueError(f"Duplicate build requirement: {name}")
        try:
            actual = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError as exc:
            raise ValueError(f"Install build requirements: {name}=={expected} is missing.") from exc
        if actual != expected:
            raise ValueError(f"Build dependency mismatch: {name}=={expected} required, found {actual}.")
        packages[canonical] = actual
    if not packages:
        raise ValueError("The build dependency list is empty.")
    return dict(sorted(packages.items()))


def git_output(*arguments: str) -> str:
    result = subprocess.run(["git", *arguments], cwd=PROJECT, capture_output=True,
                            text=True, check=True, timeout=30,
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    return result.stdout.strip()


def source_revision(*, required=False) -> dict:
    try:
        return {"commit": git_output("rev-parse", "HEAD"),
                "dirty": bool(git_output("status", "--porcelain", "--untracked-files=normal"))}
    except (OSError, subprocess.SubprocessError):
        if required:
            raise ValueError("Formal builds require a clean Git checkout; use --qa for source archives.") from None
        return {"commit": None, "dirty": None}


def artifact_names(version: str) -> tuple[str, ...]:
    base = f"SpinShareBrowser-{version}"
    setup = base + "-windows-x64-setup.exe"
    return setup, setup + ".sha256", base + "-source.zip", base + "-build.json"


def check_release(output: Path, sources: dict[str, bytes], revision: dict) -> None:
    if revision.get("dirty") is not False or not revision.get("commit"):
        raise ValueError("Formal builds require a clean Git checkout. Commit changes first, or use --qa.")
    tracked = set(git_output("ls-files", "--", *sources).splitlines())
    missing = set(sources) - tracked
    if missing:
        raise ValueError("Release sources are not tracked: " + ", ".join(sorted(missing)))
    for name in artifact_names(VERSION):
        if os.path.lexists(output / name):
            raise ValueError(f"Refusing to overwrite a release artifact: {name}. Use --qa for verification builds.")
    tags = (VERSION, "v" + VERSION)
    if any(git_output("tag", "--list", tag) for tag in tags):
        raise ValueError(f"Version {VERSION} already has a local tag. Increment the release version.")
    try:
        remote_tags = git_output("ls-remote", "--tags", "origin", *("refs/tags/" + tag for tag in tags))
    except (OSError, subprocess.SubprocessError) as exc:
        raise ValueError("Could not verify origin's release tags. Retry online, or use --qa.") from exc
    if remote_tags:
        raise ValueError(f"Version {VERSION} already has a tag on origin. Increment the release version.")


def output_directory(value: str | None, *, qa: bool) -> Path:
    output = project_path(value or ("build/qa" if qa else "dist"))
    qa_roots = (project_path("build/qa"), project_path(".qa"))
    if qa and not any(output.is_relative_to(root) for root in qa_roots):
        raise ValueError("QA output must stay in build/qa or .qa; it must not replace release artifacts.")
    if not qa and output != project_path("dist"):
        raise ValueError("Formal releases are written to dist. Use --qa for a separate output directory.")
    return output


def sha256_file(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def tool_record(path: Path, version: str | None = None) -> dict:
    record = {"file": path.name, "version": version, "sha256": sha256_file(path)}
    if path.suffix.lower() == ".exe":
        literal = str(path).replace("'", "''")
        result = subprocess.run([
            "powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
            "(Get-Item -LiteralPath '" + literal + "').VersionInfo.FileVersion"],
            capture_output=True, text=True, check=True, timeout=30,
            creationflags=subprocess.CREATE_NO_WINDOW)
        record["fileVersion"] = result.stdout.strip() or None
        if version is None:
            record["version"] = record["fileVersion"]
    return record


def build_manifest(sources: dict[str, bytes], packages: dict[str, str], revision: dict,
                   tools: dict, artifacts: list[Path], *, qa: bool) -> dict:
    return {
        "schemaVersion": 1, "version": VERSION, "purpose": "qa" if qa else "release",
        "source": {**revision, "sha256": {name: hashlib.sha256(data).hexdigest()
                                         for name, data in sorted(sources.items())}},
        "python": {"version": platform.python_version(), "implementation": platform.python_implementation(),
                   "architecture": platform.machine(), "executableSha256": sha256_file(Path(sys.executable))},
        "dependencies": packages, "tools": tools,
        "artifacts": {path.name: {"sha256": sha256_file(path), "bytes": path.stat().st_size}
                      for path in artifacts},
    }


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


@contextlib.contextmanager
def build_lock():
    path = project_path("build/.build.lock")
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        lock = path.open("x", encoding="ascii")
    except FileExistsError as exc:
        raise ValueError("Another build owns build/.build.lock. If a build crashed, remove that lock after it exits.") from exc
    try:
        with lock:
            lock.write(str(os.getpid()))
            lock.flush()
            yield
    finally:
        path.unlink()


def main(argv=None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--qa", action="store_true", help="Build unpublished verification artifacts in build/qa.")
    parser.add_argument("--output-dir", help="QA output directory under build/qa or .qa.")
    parser.add_argument("--preflight", action="store_true", help="Check dependencies and release eligibility without building.")
    args = parser.parse_args(argv)
    if (sys.platform != "win32" or sys.version_info < (3, 12)
            or struct.calcsize("P") != 8 or platform.machine().upper() != "AMD64"):
        raise ValueError("Use Python 3.12 or newer on Windows x64.")
    destination = output_directory(args.output_dir, qa=args.qa)
    sources = {name: project_path(name).read_bytes() for name in SOURCE_FILES}
    packages = check_requirements(sources["requirements-build.txt"])
    subprocess.run([sys.executable, "-m", "pip", "check"], check=True,
                   creationflags=subprocess.CREATE_NO_WINDOW)
    revision = source_revision(required=not args.qa)
    if args.preflight:
        if not args.qa:
            check_release(destination, sources, revision)
        print(f"Preflight passed: {VERSION}, {len(packages)} exact dependencies, "
              + ("QA build" if args.qa else "unpublished release"))
        return
    with build_lock():
        if not args.qa:
            check_release(destination, sources, revision)
        build_application(sources, packages, revision, destination, qa=args.qa)


def build_application(sources, packages, revision, destination, *, qa):
    compiler, bootstrapper, sdk = build_tools()
    work_root = "build/qa-work" if qa else "build"
    build = project_path(work_root + "/pyinstaller")
    snapshot = project_path(work_root + "/pyinstaller/source")
    staging = project_path(work_root + "/windows")
    output = project_path(work_root + "/windows/SpinShareBrowser")
    for name in ("pyinstaller/source", "windows", "pyinstaller/work", "pyinstaller/spec", "pyinstaller/cache"):
        project_path(work_root + "/" + name).mkdir(parents=True, exist_ok=True)
    destination.mkdir(parents=True, exist_ok=True)
    for name, data in sources.items():
        path = project_path(work_root + "/pyinstaller/source/" + name)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    notices = license_text(sources)
    notice_path = project_path(work_root + "/pyinstaller/" + LICENSE_NAME)
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
    ], cwd=PROJECT, env=environment, check=True, creationflags=subprocess.CREATE_NO_WINDOW)

    # Obtain Microsoft's redistributable files directly from its NuGet package.
    with zipfile.ZipFile(sdk) as package:
        sdk_files = {
            "lib/net462/Microsoft.Web.WebView2.Core.dll": "Microsoft.Web.WebView2.Core.dll",
            "lib/net462/Microsoft.Web.WebView2.WinForms.dll": "Microsoft.Web.WebView2.WinForms.dll",
        }
        for architecture in ("win-arm64", "win-x64", "win-x86"):
            member = f"runtimes/{architecture}/native/WebView2Loader.dll"
            sdk_files[member] = member
        for member, relative_destination in sdk_files.items():
            path = project_path(work_root + "/windows/SpinShareBrowser/_internal/webview/lib/" + relative_destination)
            if not path.is_file():
                raise ValueError(f"The WebView2 assembly was not bundled: {relative_destination}")
            path.write_bytes(package.read(member))
            check_signature(path, "Microsoft Corporation")
    for name, data in {"LICENSE": sources["LICENSE"], LICENSE_NAME: notices,
                       "WEBVIEW2-LICENSE.txt": sources["licenses/webview2-runtime-license.txt"]}.items():
        (output / name).write_bytes(data)
    program_files = project_path(work_root + "/windows/program-files.iss")
    write_program_files(output, program_files)
    subprocess.run([
        str(compiler), "/Qp", "/DPayloadDir=" + str(output),
        "/DProgramFilesInclude=" + str(program_files),
        "/DWebView2Bootstrapper=" + str(bootstrapper),
        "/DRuntimeLicenseFile=" + str(notice_path),
        "/DOutputDir=" + str(destination), "/DAppVersion=" + VERSION,
        str(snapshot / "scripts" / "windows.iss"),
    ], cwd=PROJECT, check=True, creationflags=subprocess.CREATE_NO_WINDOW)
    archive_name = f"SpinShareBrowser-{VERSION}-source.zip"
    write_zip(destination / archive_name, {
        f"SpinShareBrowser-{VERSION}/{name}": data for name, data in sources.items()
    })
    setup_name = f"SpinShareBrowser-{VERSION}-windows-x64-setup.exe"
    setup_path = destination / setup_name
    checksum_path = destination / (setup_name + ".sha256")
    checksum_path.write_text(sha256_file(setup_path) + "  " + setup_name + "\n", encoding="ascii")
    manifest = build_manifest(sources, packages, revision, {
        "innoSetup": tool_record(compiler, INNO_VERSION),
        "webview2Bootstrapper": tool_record(bootstrapper),
        "webview2Sdk": tool_record(sdk, WEBVIEW2_SDK),
    }, [setup_path, checksum_path, destination / archive_name], qa=qa)
    (destination / f"SpinShareBrowser-{VERSION}-build.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for name in artifact_names(VERSION):
        print(f"Created {destination.relative_to(PROJECT) / name}")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        sys.exit(f"Build failed: {error}")
