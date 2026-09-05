"""Offline crash recovery checks; child processes only touch isolated fixture folders."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
import installer


CRASH_CHILD = r'''
import os
from pathlib import Path
import sys
sys.path.insert(0, str(Path.cwd() / "src"))
import installer
root = Path(sys.argv[1]).resolve()
assert root.is_relative_to((Path.cwd() / ".qa" / "tmp").resolve())
phase = sys.argv[2]
write = installer._write_transaction
move = installer._move_absent
unlink = installer._unlink
def stopped_write(root, record):
    write(root, record)
    if phase == record["phase"]:
        os._exit(17)
def stopped_move(root, source, target):
    move(root, source, target)
    if phase == "backup" and target.name.startswith(".spinshare-rollback-"):
        os._exit(17)
    if phase == "replacement" and source.name.startswith(".spinshare-stage-"):
        os._exit(17)
def stopped_unlink(root, path):
    existed = path.exists()
    unlink(root, path)
    if phase == "cleanup" and existed and path.name.startswith(".spinshare-rollback-") and (root / installer.INSTALL_TRANSACTION_NAME).exists():
        os._exit(17)
installer._write_transaction = stopped_write
installer._move_absent = stopped_move
installer._unlink = stopped_unlink
installer.install_archive(root / "chart.zip", root)
raise AssertionError("The crash point was not reached")
'''


class InstallRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.qa = (ROOT / ".qa" / "tmp").resolve()
        self.qa.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix="install-recovery-", dir=self.qa)
        self.root = Path(self.temporary.name).resolve()
        self.assertTrue(self.root.is_relative_to(self.qa))
        self.chart = self.root / "spinshare_ab12.srtb"
        self.cover = self.root / "AlbumArt" / "spinshare_ab12.png"
        self.journal = self.root / installer.INSTALL_TRANSACTION_NAME

    def tearDown(self):
        self.assertTrue(self.root.resolve().is_relative_to(self.qa))
        self.temporary.cleanup()

    def fixture(self, *, existing=True):
        self.cover.parent.mkdir(exist_ok=True)
        if existing:
            self.chart.write_bytes(b"old chart")
            self.cover.write_bytes(b"old cover")
        with zipfile.ZipFile(self.root / "chart.zip", "w") as archive:
            archive.writestr("spinshare_ab12.srtb", b"new chart")
            archive.writestr("AlbumArt/spinshare_ab12.png", b"new cover")

    def crash(self, phase):
        child = subprocess.run(
            [sys.executable, "-B", "-c", CRASH_CHILD, str(self.root), phase],
            cwd=ROOT, capture_output=True, timeout=15,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        self.assertEqual(child.returncode, 17, child.stderr.decode("utf-8", errors="replace"))
        self.assertTrue(self.journal.exists())

    def test_crash_before_replacement_and_between_renames_restores_originals(self):
        for phase in ("installing", "backup", "replacement"):
            with self.subTest(phase=phase):
                self.fixture()
                self.crash(phase)
                result = installer.recover_installation(self.root)
                self.assertTrue(result["recovered"])
                self.assertEqual(self.chart.read_bytes(), b"old chart")
                self.assertEqual(self.cover.read_bytes(), b"old cover")
                self.assertTrue((self.root / "chart.zip").exists(), "Rolled-back downloads remain available")
                self.assertFalse(list(self.root.rglob(".spinshare-*.tmp")))
                self.assertFalse(self.journal.exists())
                self.assertFalse(installer.recover_installation(self.root)["recovered"])

    def test_committed_and_partly_cleaned_transactions_keep_complete_new_install(self):
        for phase in ("committed", "cleanup"):
            with self.subTest(phase=phase):
                self.fixture()
                self.crash(phase)
                installer.recover_installation(self.root)
                self.assertEqual(self.chart.read_bytes(), b"new chart")
                self.assertEqual(self.cover.read_bytes(), b"new cover")
                self.assertFalse((self.root / "chart.zip").exists())
                self.assertFalse(self.journal.exists())
                self.assertFalse(list(self.root.rglob(".spinshare-*.tmp")))

    def test_interrupted_first_install_removes_only_its_own_new_files(self):
        self.fixture(existing=False)
        self.crash("replacement")
        unrelated = self.root / ".spinshare-stage-existing.tmp"
        unrelated.write_bytes(b"do not sweep")
        installer.recover_installation(self.root)
        self.assertFalse(self.chart.exists())
        self.assertFalse(self.cover.exists())
        self.assertEqual(unrelated.read_bytes(), b"do not sweep")

    def test_changed_target_blocks_recovery_without_losing_bytes(self):
        self.fixture()
        self.crash("replacement")
        transaction = json.loads(self.journal.read_text())
        backup = self.root / transaction["files"][0]["backup"]
        self.chart.write_bytes(b"user edit")
        snapshot = {path: path.read_bytes() for path in self.root.rglob("*") if path.is_file()}
        with self.assertRaises(installer.RecoveryError) as failed:
            installer.recover_installation(self.root)
        self.assertEqual(failed.exception.code, "installation_recovery_required")
        self.assertEqual({path: path.read_bytes() for path in self.root.rglob("*") if path.is_file()}, snapshot)
        self.assertEqual(backup.read_bytes(), b"old chart")

    def test_changed_backup_and_committed_target_are_never_cleaned_up(self):
        for phase in ("backup", "committed"):
            with self.subTest(phase=phase):
                self.fixture()
                self.crash(phase)
                transaction = json.loads(self.journal.read_text())
                backup = self.root / transaction["files"][0]["backup"]
                changed = backup if phase == "backup" else self.chart
                changed.write_bytes(b"external edit")
                snapshot = {path: path.read_bytes() for path in self.root.rglob("*") if path.is_file()}
                with self.assertRaises(installer.RecoveryError):
                    installer.recover_installation(self.root)
                self.assertEqual({path: path.read_bytes() for path in self.root.rglob("*") if path.is_file()}, snapshot)
                # End this independent fixture without asking recovery to discard an edit.
                for path in list(self.root.rglob("*")):
                    if path.is_file():
                        self.assertTrue(path.resolve().is_relative_to(self.root))
                        path.unlink()

    def test_recovery_does_not_overwrite_file_created_after_preflight(self):
        self.fixture()
        self.crash("backup")
        move = installer._move_absent
        def conflict(root, source, target):
            if source.name.startswith(".spinshare-rollback-") and target == self.chart:
                target.write_bytes(b"concurrent edit")
            return move(root, source, target)
        with mock.patch.object(installer, "_move_absent", side_effect=conflict):
            with self.assertRaises(installer.RecoveryError):
                installer.recover_installation(self.root)
        self.assertEqual(self.chart.read_bytes(), b"concurrent edit")
        self.assertTrue(self.journal.exists())
        self.assertTrue(any(path.read_bytes() == b"old chart" for path in self.root.glob(".spinshare-rollback-*")))

    def test_recovery_can_itself_be_interrupted_and_retried(self):
        self.fixture()
        self.crash("replacement")
        move = installer._move_absent
        def interrupted(root, source, target):
            move(root, source, target)
            if target.name.startswith(".spinshare-stage-"):
                raise KeyboardInterrupt
        with mock.patch.object(installer, "_move_absent", side_effect=interrupted):
            with self.assertRaises(KeyboardInterrupt):
                installer.recover_installation(self.root)
        installer.recover_installation(self.root)
        self.assertEqual(self.chart.read_bytes(), b"old chart")
        self.assertFalse(self.journal.exists())

    def test_failed_normal_rollback_keeps_durable_mapping_for_later_recovery(self):
        self.fixture()
        move = installer._move_absent
        def failed_move(root, source, target):
            if source.name.startswith(".spinshare-stage-") and target == self.cover:
                raise OSError("fixture replacement failed")
            if source.name.startswith(".spinshare-rollback-"):
                raise OSError("fixture original locked")
            return move(root, source, target)
        with mock.patch.object(installer, "_move_absent", side_effect=failed_move):
            with self.assertRaisesRegex(installer.InstallError, "could not be restored"):
                installer.install_archive(self.root / "chart.zip", self.root)
        self.assertTrue(self.journal.exists())
        installer.recover_installation(self.root)
        self.assertEqual(self.chart.read_bytes(), b"old chart")
        self.assertEqual(self.cover.read_bytes(), b"old cover")
        self.assertFalse(self.journal.exists())

    def test_unsafe_or_invalid_record_is_retained_without_touching_chart_files(self):
        self.fixture()
        self.crash("backup")
        valid = self.journal.read_bytes()
        transaction = json.loads(valid)
        transaction["files"][0]["target"] = "../outside.srtb"
        for raw in (b"{broken", b"[" * 2000 + b"]" * 2000, json.dumps(transaction).encode(), valid.replace(b'"schemaVersion":1', b'"schemaVersion":1,"schemaVersion":1')):
            with self.subTest(raw=raw[:30]):
                self.journal.write_bytes(raw)
                with self.assertRaises(installer.RecoveryError):
                    installer.recover_installation(self.root)
                self.assertEqual(self.journal.read_bytes(), raw)
                self.assertFalse(self.chart.exists())
        self.journal.write_bytes(valid)
        installer.recover_installation(self.root)

    def test_hardlinked_recovery_source_is_rejected(self):
        self.fixture()
        self.crash("backup")
        transaction = json.loads(self.journal.read_text())
        backup = self.root / transaction["files"][0]["backup"]
        linked = self.root / "linked-original"
        os.link(backup, linked)
        with self.assertRaises(installer.RecoveryError):
            installer.recover_installation(self.root)
        self.assertEqual(linked.read_bytes(), b"old chart")
        self.assertFalse(self.chart.exists())
        linked.unlink()
        installer.recover_installation(self.root)

    def test_no_transaction_does_not_create_a_missing_directory(self):
        missing = self.root / "missing" / "Custom"
        self.assertEqual(installer.recover_installation(missing), {"recovered": False, "filesRestored": 0})
        self.assertFalse(missing.parent.exists())

    def test_journal_write_failure_never_moves_an_original(self):
        self.fixture()
        with mock.patch.object(installer, "_write_transaction", side_effect=OSError("fixture disk full")):
            with self.assertRaises(installer.InstallError):
                installer.install_archive(self.root / "chart.zip", self.root)
        self.assertEqual(self.chart.read_bytes(), b"old chart")
        self.assertEqual(self.cover.read_bytes(), b"old cover")
        self.assertFalse(self.journal.exists())
        self.assertFalse(list(self.root.rglob(".spinshare-*.tmp")))

    def test_commit_marker_is_authoritative_if_the_final_write_reports_an_error(self):
        self.fixture()
        write = installer._write_transaction
        def late_failure(root, transaction):
            write(root, transaction)
            if transaction["phase"] == "committed":
                raise OSError("fixture failure after durable commit")
        with mock.patch.object(installer, "_write_transaction", side_effect=late_failure):
            result = installer.install_archive(self.root / "chart.zip", self.root)
        self.assertTrue(result["zipRemoved"])
        self.assertEqual(self.chart.read_bytes(), b"new chart")
        self.assertFalse(self.journal.exists())


if __name__ == "__main__":
    unittest.main()
