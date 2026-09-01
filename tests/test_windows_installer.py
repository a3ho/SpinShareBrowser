from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]


class WindowsInstallerTests(unittest.TestCase):
    def test_release_version_is_consistently_2_0_0(self):
        build = (ROOT / "scripts" / "build.py").read_text(encoding="utf-8")
        setup = (ROOT / "scripts" / "windows.iss").read_text(encoding="utf-8-sig")
        resource = (ROOT / "assets" / "windows-version.txt").read_text(encoding="utf-8")
        self.assertRegex(build, r'VERSION\s*=\s*"2\.0\.0"')
        self.assertIn('#define AppVersion "2.0.0"', setup)
        self.assertIn("StringStruct('ProductVersion', '2.0.0')", resource)

    def test_existing_install_is_an_explicit_safe_update(self):
        setup = (ROOT / "scripts" / "windows.iss").read_text(encoding="utf-8-sig")
        for fragment in (
            "DetectExistingInstall", "ExistingVersionIsNewer", "ComparePackedVersion(Installed, Current) > 0",
            "UpdateWelcomeTitle", "UpdateWelcomeBody", "UpdateReady",
            "覆盖/更新 {#AppName}", "游戏 Custom 目录中的谱面不会受到影响",
            "cannot downgrade it", "不会执行降级覆盖",
        ):
            self.assertIn(fragment, setup)
        self.assertIn("DisableWelcomePage=no", setup)
        self.assertIsNone(re.search(r"(?i)repair mode|修复模式", setup))


if __name__ == "__main__":
    unittest.main()
