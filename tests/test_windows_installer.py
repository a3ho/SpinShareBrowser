from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]


class WindowsInstallerTests(unittest.TestCase):
    def test_release_version_is_consistently_2_1_0(self):
        build = (ROOT / "scripts" / "build.py").read_text(encoding="utf-8")
        setup = (ROOT / "scripts" / "windows.iss").read_text(encoding="utf-8-sig")
        resource = (ROOT / "assets" / "windows-version.txt").read_text(encoding="utf-8")
        self.assertRegex(build, r'VERSION\s*=\s*"2\.1\.0"')
        self.assertIn('#define AppVersion "2.1.0"', setup)
        self.assertIn("StringStruct('ProductVersion', '2.1.0')", resource)
        self.assertIn('filevers=(2, 1, 0, 0)', resource)
        service = (ROOT / 'src/spinshare_portable.py').read_text(encoding='utf-8')
        interface = (ROOT / 'web/app.js').read_text(encoding='utf-8')
        self.assertIn('VERSION = "2.1.0"', service)
        self.assertIn("config.version==='2.1.0'", interface)
        self.assertIn("settings.version!=='2.1.0'", interface)

    def test_existing_install_is_an_explicit_safe_update(self):
        setup = (ROOT / "scripts" / "windows.iss").read_text(encoding="utf-8-sig")
        for fragment in (
            "DetectExistingInstall", "ExistingVersionIsNewer", "ComparePackedVersion(Installed, Current) > 0",
            "UpdateWelcomeTitle", "UpdateWelcomeBody",
            "覆盖/更新 {#AppName}", "本地已安装谱面不受影响",
            "Locally installed charts remain unchanged",
            "cannot downgrade it", "不会执行降级覆盖",
        ):
            self.assertIn(fragment, setup)
        self.assertIn("DisableWelcomePage=no", setup)
        self.assertNotIn("charts in the game's Custom directory", setup)
        self.assertNotIn("游戏 Custom 目录中的谱面", setup)
        self.assertIsNone(re.search(r"(?i)repair mode|修复模式", setup))

    def test_existing_install_detection_does_not_depend_on_display_version(self):
        setup = (ROOT / "scripts" / "windows.iss").read_text(encoding="utf-8-sig")
        helper = re.search(
            r"function DetectExistingInstallInRoot\b(?P<body>.*?)"
            r"function DetectExistingInstall\b",
            setup,
            re.S,
        )
        self.assertIsNotNone(helper)
        self.assertIn("Result := RegKeyExists(Root, UninstallKey);", helper.group("body"))
        self.assertIn("RegQueryStringValue(Root, UninstallKey, 'DisplayVersion', FoundVersion)", helper.group("body"))
        self.assertNotIn("Result := RegQueryStringValue", helper.group("body"))

        detector = re.search(
            r"function DetectExistingInstall\(var Version: String\): Boolean;(?P<body>.*?)"
            r"function ExistingVersionIsNewer\b",
            setup,
            re.S,
        )
        self.assertIsNotNone(detector)
        for root in ("HKCU64", "HKCU32", "HKLM64", "HKLM32"):
            self.assertIn(f"DetectExistingInstallInRoot({root}, Version)", detector.group("body"))
        self.assertIn("FileExists(ExpandConstant('{#InstallDir}\\SpinShareBrowser.exe'))", detector.group("body"))

    def test_conflicting_registry_roots_keep_the_highest_parseable_version(self):
        setup = (ROOT / "scripts" / "windows.iss").read_text(encoding="utf-8-sig")
        helper = re.search(
            r"function DetectExistingInstallInRoot\b(?P<body>.*?)"
            r"function DetectExistingInstall\b",
            setup,
            re.S,
        )
        self.assertIsNotNone(helper)
        body = helper.group("body")
        self.assertIn("Result := RegKeyExists(Root, UninstallKey);", body)
        self.assertIn("StrToVersion(FoundVersion, FoundPacked)", body)
        self.assertIn("StrToVersion(Version, HighestPacked)", body)
        self.assertIn("ComparePackedVersion(FoundPacked, HighestPacked) > 0", body)
        self.assertNotIn("Result and (Version = '')", body)

    def test_update_copy_is_reapplied_only_on_the_welcome_page(self):
        setup = (ROOT / "scripts" / "windows.iss").read_text(encoding="utf-8-sig")
        page_change = re.search(
            r"procedure CurPageChanged\(CurPageID: Integer\);(?P<body>.*?)"
            r"function PrepareToInstall\b",
            setup,
            re.S,
        )
        self.assertIsNotNone(page_change)
        body = page_change.group("body")
        self.assertIn("if ExistingInstall then", body)
        self.assertIn("CurPageID = wpWelcome", body)
        self.assertIn("UpdateWelcomeTitle", body)
        self.assertIn("UpdateWelcomeBody", body)
        self.assertNotIn("CurPageID = wpReady", body)
        self.assertNotIn("UpdateReady", body)

    def test_maintenance_is_bounded_by_setup_and_transient_failures_are_retryable(self):
        setup = (ROOT / "scripts" / "windows.iss").read_text(encoding="utf-8-sig")
        runner = re.search(
            r"function RunMaintenance\b(?P<body>.*?)function InstallWebView2\b",
            setup,
            re.S,
        )
        self.assertIsNotNone(runner)
        self.assertIn("--parent-pid ' + IntToStr(GetCurrentProcessId)", runner.group("body"))
        self.assertNotIn("AskRetry", runner.group("body"), "One child run must return so its caller owns retry/cancel")

        preparation = re.search(
            r"function PrepareToInstall\b(?P<body>.*?)procedure DeinitializeSetup\b",
            setup,
            re.S,
        )
        self.assertIsNotNone(preparation)
        body = preparation.group("body")
        self.assertIn("repeat", body)
        self.assertIn("RunMaintenance", body)
        self.assertIn("CheckProgramFiles", body)
        self.assertIn("RetryPreparation(Result)", body)
        self.assertLess(body.index("RunMaintenance"), body.index("CheckProgramFiles"))
        self.assertIn("MB_RETRYCANCEL", setup)
        self.assertIn("MaintenanceFilesBusy", setup)
        self.assertIn("13: Result := CustomMessage('MaintenanceTimeout')", setup)
        self.assertIn("GetProgramFiles(Files)", setup)
        self.assertIn("ProbeProgramFile(FileName, True)", setup)

    def test_prepare_cancel_and_silent_failure_both_preserve_the_nonempty_error(self):
        setup = (ROOT / "scripts" / "windows.iss").read_text(encoding="utf-8-sig")
        preparation = re.search(
            r"function PrepareToInstall\b(?P<body>.*?)procedure DeinitializeSetup\b", setup, re.S)
        self.assertIsNotNone(preparation)
        body = preparation.group("body")
        cancelled = re.search(r"if not RetryPreparation\(Result\) then\s+begin(?P<body>.*?)end;", body, re.S)
        self.assertIsNotNone(cancelled)
        branch = re.sub(r"\{.*?\}", "", cancelled.group("body"), flags=re.S)
        self.assertRegex(branch, r"\bExit\s*;")
        self.assertNotRegex(branch, r"\bResult\s*:=", "Cancel must never turn a failed prepare into success")
        self.assertNotIn("SilentOperation", branch, "Interactive cancel and silent failure share the same exit")
        self.assertNotIn("WizardForm.Close", body, "Inno disables Cancel while PrepareToInstall runs")
        self.assertLess(body.index("if Result <> '' then"), cancelled.start())

    def test_interactive_prepare_cancel_closes_after_returning_to_the_preparing_page(self):
        setup = (ROOT / "scripts" / "windows.iss").read_text(encoding="utf-8-sig")
        retry = re.search(r"function RetryPreparation\b(?P<body>.*?)procedure CancelButtonClick\b", setup, re.S)
        self.assertIsNotNone(retry)
        self.assertRegex(retry.group("body"),
                         r"if not Result and not SilentOperation then\s+begin\s+MaintenanceCancelRequested := True;")
        self.assertNotIn("WizardForm.Close", retry.group("body"))
        page = re.search(r"procedure CurPageChanged\b(?P<body>.*?)function PrepareToInstall\b", setup, re.S)
        self.assertIsNotNone(page)
        delayed = re.search(
            r"if \(CurPageID = wpPreparing\) and MaintenanceCancelRequested then\s+begin(?P<body>.*?)end;",
            page.group("body"), re.S)
        self.assertIsNotNone(delayed)
        self.assertIn("WizardForm.Close;", delayed.group("body"))
        self.assertIn("Exit;", delayed.group("body"))
        cancel = re.search(r"procedure CancelButtonClick\b(?P<body>.*?)procedure ReleaseMaintenanceGate\b", setup, re.S)
        self.assertIsNotNone(cancel)
        self.assertRegex(cancel.group("body"), r"if MaintenanceCancelRequested then\s+Confirm := False;")


if __name__ == "__main__":
    unittest.main()
