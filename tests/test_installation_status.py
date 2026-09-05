"""Installation presence must distinguish absent, changed and unreadable files."""
import ctypes
import hashlib
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
import spinshare_portable as portable


class InstallationStatusTests(unittest.TestCase):
    def setUp(self):
        temporary_root = ROOT / ".qa" / "tmp"
        temporary_root.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix="presence-", dir=temporary_root)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.target = self.root / "Custom"
        self.target.mkdir()
        target_patch = patch.object(portable.installer, "default_target_directory", return_value=self.target)
        target_patch.start()
        self.addCleanup(target_patch.stop)
        self.path = self.target / "spinshare_ab12.srtb"
        self.original = b'{"chart":"original"}'
        self.path.write_bytes(self.original)
        self.chart = {"songId": 1, "fileReference": "spinshare_ab12",
                      "updateHash": hashlib.md5(self.original, usedforsecurity=False).hexdigest()}

    def manager(self):
        store = portable.ConfigStore(self.root / "state")
        manager = portable.PortableManager(store, store.load())
        def close():
            self.assertTrue(manager.close_if_idle())
            self.assertTrue(manager.join(3))
        self.addCleanup(close)
        return manager

    def presence(self, manager):
        return manager.check_installations([self.chart], manager.revision)["installations"][0]["installed"]

    def test_exact_different_and_missing_remain_distinct_without_relaxing_deletion(self):
        manager = self.manager()
        self.assertIs(self.presence(manager), True)
        self.path.write_bytes(b'{"chart":"personal changes"}')
        self.assertEqual(self.presence(manager), "different")
        with self.assertRaises(portable.APIError) as denied:
            manager.delete_installation(1, self.chart["fileReference"], self.chart["updateHash"], manager.revision)
        self.assertEqual(denied.exception.code, "installation_changed")
        self.assertEqual(self.path.read_bytes(), b'{"chart":"personal changes"}')
        self.path.unlink()
        self.assertIs(self.presence(manager), False)

    def test_io_errors_fail_both_reads_instead_of_returning_absent(self):
        manager = self.manager()
        for failure in (PermissionError("locked"), OSError("disk read failed")):
            with self.subTest(failure=type(failure).__name__):
                with patch.object(portable, "_read_guarded_bytes", side_effect=failure):
                    for read in (lambda: self.presence(manager), lambda: manager.index_installations(manager.revision)):
                        with self.assertRaises(portable.APIError) as failed:
                            read()
                        self.assertEqual((failed.exception.status, failed.exception.code), (500, "invalid_installations"))
        self.assertIs(self.presence(manager), True)

    @unittest.skipUnless(os.name == "nt", "Windows file-sharing behavior")
    def test_real_exclusive_file_lock_never_reports_uninstalled(self):
        manager = self.manager()
        self.assertEqual(len(manager.index_installations(manager.revision)["installations"]), 1)
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.CreateFileW.argtypes = [ctypes.c_wchar_p, ctypes.c_ulong, ctypes.c_ulong,
                                      ctypes.c_void_p, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_void_p]
        kernel.CreateFileW.restype = ctypes.c_void_p
        kernel.CloseHandle.argtypes = [ctypes.c_void_p]
        kernel.CloseHandle.restype = ctypes.c_int
        handle = kernel.CreateFileW(str(self.path), 0x80000000, 0, None, 3, 0, None)
        self.assertNotEqual(handle, ctypes.c_void_p(-1).value)
        try:
            for read in (lambda: self.presence(manager), lambda: manager.index_installations(manager.revision)):
                with self.assertRaises(portable.APIError) as failed:
                    read()
                self.assertEqual(failed.exception.code, "invalid_installations")
        finally:
            kernel.CloseHandle(handle)
        self.assertIs(self.presence(manager), True)
        self.assertEqual(len(manager.index_installations(manager.revision)["installations"]), 1)

    def test_recovery_failure_keeps_browser_available_but_blocks_reads_and_writes_until_retry(self):
        with patch.object(portable.installer, "recover_installation",
                          side_effect=portable.installer.RecoveryError("Recovery files were retained.")) as recover:
            manager = self.manager()
            self.assertTrue(manager.settings())
            manager.confirm_install_directory(manager.revision)
            for operation in (
                lambda: self.presence(manager),
                lambda: manager.index_installations(manager.revision),
                lambda: manager.submit(1, "1" * 32, settings_revision=manager.revision),
                lambda: manager.delete_installation(1, self.chart["fileReference"], self.chart["updateHash"], manager.revision),
            ):
                with self.assertRaises(portable.APIError) as failed:
                    operation()
                self.assertEqual((failed.exception.status, failed.exception.code), (409, "installation_recovery_required"))
            self.assertGreaterEqual(recover.call_count, 5)
            self.assertEqual(manager.active_count(), 0)
            self.assertEqual(self.path.read_bytes(), self.original)
        self.assertIs(self.presence(manager), True)

    def test_exiting_or_closed_manager_does_not_start_file_recovery(self):
        for state in ("exiting", "closed"):
            with self.subTest(state=state):
                manager = self.manager()
                manager.confirm_install_directory(manager.revision)
                if state == "closed":
                    self.assertTrue(manager.close_if_idle())
                else:
                    manager.begin_exit()
                with patch.object(portable.installer, "recover_installation") as recover:
                    for operation in (
                        lambda: self.presence(manager),
                        lambda: manager.submit(1, "2" * 32, settings_revision=manager.revision),
                    ):
                        with self.assertRaises(portable.APIError) as failed:
                            operation()
                        self.assertEqual(failed.exception.code, "shutting_down")
                    recover.assert_not_called()


if __name__ == "__main__":
    unittest.main()
