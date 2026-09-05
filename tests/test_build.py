"""Offline release guard and build-snapshot checks; no tools or installers are executed."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zipfile


ROOT = Path(__file__).resolve().parents[1]


def load_script(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


build = load_script("build")
smoke = load_script("windows_smoke")


class BuildChecks(unittest.TestCase):
    def test_tool_manifest_preserves_release_version_when_executable_metadata_is_a_placeholder(self):
        with tempfile.TemporaryDirectory() as directory:
            executable = Path(directory) / "fixture.exe"
            executable.write_bytes(b"fixture tool; never executed")
            for release, file_version, expected in (("7.1.0", "0.0.0.0", "7.1.0"),
                                                     (None, "1.3.245.1", "1.3.245.1")):
                result = subprocess.CompletedProcess([], 0, stdout=file_version + "\n")
                with self.subTest(release=release), patch.object(build.subprocess, "run", return_value=result):
                    record = build.tool_record(executable, release)
                self.assertEqual(record["version"], expected)
                self.assertEqual(record["fileVersion"], file_version)
                self.assertEqual(record["sha256"], hashlib.sha256(executable.read_bytes()).hexdigest())

    def test_exact_dependencies_reject_drift_missing_unpinned_and_duplicates(self):
        with patch.object(build.importlib.metadata, "version", return_value="1.2.3"):
            self.assertEqual(build.check_requirements(b"# fixture\nExample_Package==1.2.3\n"),
                             {"example-package": "1.2.3"})
            for raw in (b"example==1.2.4", b"example>=1.2.3", b"example==1.*", b"",
                        b"example_package==1.2.3\nexample-package==1.2.3"):
                with self.subTest(raw=raw), self.assertRaises(ValueError):
                    build.check_requirements(raw)
        with patch.object(build.importlib.metadata, "version", side_effect=build.importlib.metadata.PackageNotFoundError):
            with self.assertRaisesRegex(ValueError, "is missing"):
                build.check_requirements(b"example==1.2.3")

    def test_qa_output_cannot_target_release_or_escape_project(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(build, "PROJECT", Path(directory)):
            self.assertEqual(build.output_directory(None, qa=True), Path(directory) / "build" / "qa")
            self.assertEqual(build.output_directory(None, qa=False), Path(directory) / "dist")
            for value, qa in (("dist", True), ("../outside", True), ("build/qa/../../dist", True),
                              ("build/qa", False)):
                with self.subTest(value=value, qa=qa), self.assertRaises(ValueError):
                    build.output_directory(value, qa=qa)

    def test_formal_release_rejects_dirty_untracked_existing_and_published_versions(self):
        revision = {"commit": "a" * 40, "dirty": False}
        sources = {"example.py": b"example"}
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            def git(*args):
                return "example.py" if args[0] == "ls-files" else ""
            with patch.object(build, "git_output", side_effect=git):
                build.check_release(output, sources, revision)
                with self.assertRaisesRegex(ValueError, "clean Git"):
                    build.check_release(output, sources, dict(revision, dirty=True))
                with self.assertRaisesRegex(ValueError, "not tracked"):
                    build.check_release(output, {"unknown.py": b""}, revision)
                for name in build.artifact_names(build.VERSION):
                    path = output / name
                    path.write_bytes(b"preserved release")
                    with self.assertRaisesRegex(ValueError, "overwrite"):
                        build.check_release(output, sources, revision)
                    self.assertEqual(path.read_bytes(), b"preserved release")
                    path.unlink()
            for remote in (False, True):
                def published(*args):
                    if args[0] == "ls-files":
                        return "example.py"
                    return "existing tag" if args[0] == ("ls-remote" if remote else "tag") else ""
                with self.subTest(remote=remote), patch.object(build, "git_output", side_effect=published):
                    with self.assertRaisesRegex(ValueError, "already has"):
                        build.check_release(output, sources, revision)
            def offline(*args):
                if args[0] == "ls-remote":
                    raise subprocess.TimeoutExpired("git", 30)
                return git(*args)
            with patch.object(build, "git_output", side_effect=offline):
                with self.assertRaisesRegex(ValueError, "Could not verify"):
                    build.check_release(output, sources, revision)

    def test_build_lock_is_exclusive_and_released_after_failure(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(build, "PROJECT", Path(directory)):
            with self.assertRaisesRegex(RuntimeError, "fixture"):
                with build.build_lock():
                    with self.assertRaisesRegex(ValueError, "Another build"):
                        with build.build_lock():
                            self.fail("Second build acquired the lock")
                    raise RuntimeError("fixture")
            with build.build_lock():
                self.assertTrue((Path(directory) / "build" / ".build.lock").is_file())
            self.assertFalse((Path(directory) / "build" / ".build.lock").exists())

    def test_build_uses_one_snapshot_and_manifest_matches_emitted_artifacts(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(build, "PROJECT", Path(directory)):
            root = Path(directory)
            sources = {"scripts/windows.iss": b"snapshot installer", "LICENSE": b"license",
                       "licenses/webview2-runtime-license.txt": b"runtime license"}
            (root / "scripts").mkdir()
            (root / "scripts" / "windows.iss").write_bytes(b"subsequent working tree edit")
            preserved = ("build/windows/SpinShareBrowser/_internal/webview/lib/Microsoft.Web.WebView2.Core.dll",
                         "build/pyinstaller/source/scripts/windows.iss", "build/windows/program-files.iss",
                         "build/pyinstaller/THIRD-PARTY-LICENSES.txt")
            for name in preserved:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"existing build must remain untouched")
            sdk = root / "sdk.nupkg"
            members = {"lib/net462/Microsoft.Web.WebView2.Core.dll": "Microsoft.Web.WebView2.Core.dll",
                       "lib/net462/Microsoft.Web.WebView2.WinForms.dll": "Microsoft.Web.WebView2.WinForms.dll"}
            members.update({f"runtimes/{arch}/native/WebView2Loader.dll": f"runtimes/{arch}/native/WebView2Loader.dll"
                            for arch in ("win-arm64", "win-x64", "win-x86")})
            with zipfile.ZipFile(sdk, "w") as archive:
                for member in members:
                    archive.writestr(member, b"fixture redistributable")
            destination = root / "build" / "qa"
            calls = []
            def run(command, **kwargs):
                calls.append(command)
                if "PyInstaller" in command:
                    self.assertEqual(Path(command[command.index("--distpath") + 1]), root / "build/qa-work/windows")
                    self.assertEqual(Path(command[command.index("--workpath") + 1]), root / "build/qa-work/pyinstaller/work")
                    self.assertEqual(Path(kwargs["env"]["PYINSTALLER_CONFIG_DIR"]), root / "build/qa-work/pyinstaller/cache")
                    for name in members.values():
                        path = root / "build/qa-work/windows/SpinShareBrowser/_internal/webview/lib" / name
                        path.parent.mkdir(parents=True, exist_ok=True)
                        path.write_bytes(b"original library")
                else:
                    self.assertEqual(Path(command[-1]).read_bytes(), sources["scripts/windows.iss"])
                    self.assertEqual(Path(command[-1]), root / "build/qa-work/pyinstaller/source/scripts/windows.iss")
                    (destination / build.artifact_names(build.VERSION)[0]).write_bytes(b"fixture executable")
            with (patch.object(build, "build_tools", return_value=(root / "ISCC.exe", root / "bootstrap.exe", sdk)),
                  patch.object(build, "license_text", return_value=b"notices"),
                  patch.object(build.subprocess, "run", side_effect=run),
                  patch.object(build, "check_signature"),
                  patch.object(build, "tool_record", return_value={"version": "fixture", "sha256": "b" * 64})):
                build.build_application(sources, {"example": "1.2.3"}, {"commit": "a" * 40, "dirty": True},
                                        destination, qa=True)
            self.assertEqual(len(calls), 2)
            for name in preserved:
                self.assertEqual((root / name).read_bytes(), b"existing build must remain untouched")
            manifest = json.loads((destination / build.artifact_names(build.VERSION)[-1]).read_text(encoding="utf-8"))
            self.assertEqual(manifest["purpose"], "qa")
            self.assertEqual(manifest["source"]["commit"], "a" * 40)
            self.assertTrue(manifest["source"]["dirty"])
            self.assertEqual(manifest["dependencies"], {"example": "1.2.3"})
            for name, record in manifest["artifacts"].items():
                data = (destination / name).read_bytes()
                self.assertEqual(record, {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
            with zipfile.ZipFile(destination / build.artifact_names(build.VERSION)[2]) as archive:
                self.assertEqual(archive.read(f"SpinShareBrowser-{build.VERSION}/scripts/windows.iss"),
                                 sources["scripts/windows.iss"])

    def test_installer_smoke_refuses_local_and_self_hosted_execution_before_writes(self):
        for environment in ({}, {"GITHUB_ACTIONS": "true", "RUNNER_ENVIRONMENT": "self-hosted"}):
            with self.subTest(environment=environment), patch.dict(os.environ, environment, clear=True):
                with self.assertRaisesRegex(RuntimeError, "dedicated GitHub-hosted"):
                    smoke.main(["--installer", "must-not-run.exe"])
                with self.assertRaisesRegex(RuntimeError, "dedicated GitHub-hosted"):
                    smoke.desktop_smoke(Path("must-not-run.exe"), Path("must-not-write"))

    def test_smoke_verifies_exact_filename_checksum_and_location_before_execution(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "SpinShareBrowser-1.2.3-windows-x64-setup.exe"
            path.write_bytes(b"fixture installer")
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            sidecar = path.with_name(path.name + ".sha256")
            sidecar.write_text(digest + "  " + path.name + "\n", encoding="ascii")
            self.assertEqual(smoke.verified_installer(path, (root,)), (path, "1.2.3"))
            path.write_bytes(b"changed installer")
            with self.assertRaisesRegex(ValueError, "mismatch"):
                smoke.verified_installer(path, (root,))
            with self.assertRaisesRegex(ValueError, "CI artifact"):
                smoke.verified_installer(path, (root / "other",))


if __name__ == "__main__":
    unittest.main()
