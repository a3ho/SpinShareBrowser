"""Offline pipeline checks; --benchmark uses controlled delays, never real network speed."""
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src import installer


def fixture_zip(directory, song_id, *, extra=False):
    """Distinct downloaded paths, even when every response names spinshare_aa.zip."""
    with tempfile.NamedTemporaryFile(prefix="spinshare_aa-", suffix=".zip", dir=directory, delete=False) as file:
        path = Path(file.name)
    reference = f"spinshare_{song_id:x}"
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr(reference + ".srtb", f"chart-{song_id}")
        if extra:
            archive.writestr("AlbumArt/" + reference + ".png", f"cover-{song_id}")
    return path


def zip_song(path):
    with zipfile.ZipFile(path) as archive:
        return int(Path(archive.namelist()[0]).stem.removeprefix("spinshare_"), 16)


class InstallPipelineTests(unittest.TestCase):
    def setUp(self):
        temporary_root = ROOT / ".qa" / "tmp"
        temporary_root.mkdir(parents=True, exist_ok=True)
        self.assertEqual(temporary_root.resolve(), temporary_root.absolute())
        self.directory = tempfile.TemporaryDirectory(prefix="pipeline-", dir=temporary_root)
        self.root = Path(self.directory.name)
        self.manager = None
        self.patchers = []
        self.gates = []
        self.real_install = installer.install_archive

    def gate(self):
        gate = threading.Event()
        self.gates.append(gate)
        return gate

    def start_manager(self, download, install=None):
        for name, function in (("download_archive", download), ("install_archive", install or self.real_install)):
            patcher = patch.object(installer, name, side_effect=function)
            patcher.start()
            self.patchers.append(patcher)
        self.manager = installer.JobManager(self.root)
        return self.manager

    def submit(self, song_id):
        return self.manager.submit(song_id, f"{song_id:032x}")

    def wait_for(self, predicate, message="Pipeline condition was not reached"):
        deadline = time.monotonic() + 10
        while not predicate():
            if time.monotonic() >= deadline:
                self.fail(message)
            threading.Event().wait(0.005)

    def drain(self):
        work = self.manager.work
        with work.all_tasks_done:
            self.assertTrue(work.all_tasks_done.wait_for(lambda: work.unfinished_tasks == 0, timeout=10),
                            "work.join must include installation, not just download completion")

    def tearDown(self):
        for gate in self.gates:
            gate.set()
        try:
            if self.manager is not None:
                self.drain()
                self.assertTrue(self.manager.close_if_idle())
                self.assertTrue(self.manager.join(10), "All download and installation threads must stop")
                self.assertEqual(self.manager.work.unfinished_tasks, 0)
                self.assertEqual(self.manager.ready.unfinished_tasks, 0)
        finally:
            for patcher in reversed(self.patchers):
                patcher.stop()
            self.directory.cleanup()

    def test_parallel_downloads_serial_installation_and_bounded_unique_prefetch(self):
        downloads = {song: self.gate() for song in range(1, 7)}
        installations = {song: self.gate() for song in range(1, 7)}
        lock = threading.Lock()
        stats = {"downloading": 0, "installing": 0, "max_downloads": 0, "max_installs": 0, "overlap": False}
        started, installed, archives = [], [], {}

        def download(song_id, target_dir, report, *, deadline=None, unique_name=False):
            self.assertTrue(unique_name, "The pipeline must request a unique final ZIP path")
            with lock:
                started.append(song_id)
                stats["downloading"] += 1
                stats["max_downloads"] = max(stats["max_downloads"], stats["downloading"])
                stats["overlap"] |= stats["installing"] > 0
            try:
                if not downloads[song_id].wait(10):
                    raise AssertionError("Mock download was not released")
                archive = fixture_zip(target_dir, song_id)
                with lock:
                    archives[song_id] = archive
                report({"zipName": "spinshare_aa.zip", "downloadedBytes": archive.stat().st_size})
                return archive
            finally:
                with lock:
                    stats["downloading"] -= 1

        def install(archive, target_dir, report, *, deadline=None):
            song_id = zip_song(archive)
            with lock:
                installed.append(song_id)
                stats["installing"] += 1
                stats["max_installs"] = max(stats["max_installs"], stats["installing"])
                stats["overlap"] |= stats["downloading"] > 0
            try:
                if not installations[song_id].wait(10):
                    raise AssertionError("Mock installation was not released")
                return self.real_install(archive, target_dir, report, deadline=deadline)
            finally:
                with lock:
                    stats["installing"] -= 1

        manager = self.start_manager(download, install)
        jobs = [self.submit(song) for song in range(1, 7)]
        self.wait_for(lambda: len(started) == 2)
        self.assertEqual(set(started), {1, 2})
        downloads[1].set()
        self.wait_for(lambda: installed == [1] and len(started) == 3)
        downloads[2].set()
        downloads[3].set()
        self.wait_for(lambda: manager.ready.qsize() == installer.MAX_READY_ARCHIVES)
        self.assertEqual(set(started), {1, 2, 3}, "A full ready queue must stop further downloads")
        self.assertEqual(installed, [1], "Replacement and rollback must never start concurrently")
        self.assertEqual(len(list(self.root.glob("*.zip"))), 3, "At most two prefetched ZIPs plus the current install")
        for job in jobs[1:3]:
            state = manager.get(job["id"])
            self.assertEqual(state["state"], "validating")
            self.assertEqual(state["message"], "Downloaded; waiting for installation.")
        for gate in self.gates:
            gate.set()
        self.drain()
        self.assertEqual(stats["max_downloads"], 2)
        self.assertEqual(stats["max_installs"], 1)
        self.assertTrue(stats["overlap"])
        self.assertEqual(len(set(archives.values())), 6)
        for song, job in enumerate(jobs, 1):
            self.assertEqual(manager.get(job["id"])["state"], "complete")
            self.assertEqual((self.root / f"spinshare_{song:x}.srtb").read_text(), f"chart-{song}")
        self.assertFalse(list(self.root.glob("*.zip")))

    def test_work_join_waits_for_install_and_shutdown_joins_every_thread(self):
        entered, release, joined = self.gate(), self.gate(), threading.Event()

        def download(song_id, target_dir, report, **options):
            return fixture_zip(target_dir, song_id)

        def install(archive, target_dir, report, **options):
            entered.set()
            if not release.wait(10):
                raise AssertionError("Installation was not released")
            return self.real_install(archive, target_dir, report, **options)

        manager = self.start_manager(download, install)
        job = self.submit(1)
        self.assertTrue(entered.wait(10))
        waiter = threading.Thread(target=lambda: (manager.work.join(), joined.set()), daemon=True)
        waiter.start()
        self.assertFalse(joined.wait(0.05))
        self.assertFalse(manager.close_if_idle())
        self.assertFalse(manager.closed)
        release.set()
        self.assertTrue(joined.wait(10))
        waiter.join(10)
        self.assertEqual(manager.get(job["id"])["state"], "complete")
        self.assertTrue(manager.close_if_idle())
        self.assertTrue(manager.close_if_idle(), "Shutdown is idempotent")
        self.assertTrue(manager.join(10))
        self.assertFalse(any(worker.is_alive() for worker in manager.workers))
        with self.assertRaises(installer.InstallError):
            self.submit(2)

    def test_download_and_crc_failures_do_not_block_later_jobs(self):
        archives = {}
        original = self.root / "spinshare_2.srtb"
        original.write_bytes(b"existing chart")

        def download(song_id, target_dir, report, **options):
            if song_id == 1:
                raise installer.InstallError("Simulated download failure")
            archive = fixture_zip(target_dir, song_id)
            archives[song_id] = archive
            if song_id == 2:
                content = bytearray(archive.read_bytes())
                content[content.index(b"chart-2")] ^= 1  # Valid ZIP structure, invalid member CRC.
                archive.write_bytes(content)
            return archive

        manager = self.start_manager(download)
        with self.assertLogs(level="WARNING"):
            jobs = [self.submit(song) for song in (1, 2, 3)]
            self.drain()
        self.assertEqual([manager.get(job["id"])["state"] for job in jobs], ["error", "error", "complete"])
        self.assertEqual(original.read_bytes(), b"existing chart")
        self.assertTrue(archives[2].exists(), "A failed installation retains its ZIP for recovery")
        self.assertFalse(archives[3].exists())
        self.assertEqual((self.root / "spinshare_3.srtb").read_text(), "chart-3")

    def test_replace_failure_rolls_back_before_the_next_install(self):
        art = self.root / "AlbumArt"
        art.mkdir()
        original = self.root / "spinshare_1.srtb"
        cover = art / "spinshare_1.png"
        original.write_bytes(b"old chart")
        cover.write_bytes(b"old cover")
        replace = installer._replace
        failed = []

        def failing_replace(root, source, target):
            if not failed and target == cover and source.name.startswith(".spinshare-stage-"):
                failed.append(True)
                raise OSError("Simulated replacement failure")
            return replace(root, source, target)

        def download(song_id, target_dir, report, **options):
            return fixture_zip(target_dir, song_id, extra=True)

        manager = self.start_manager(download)
        with patch.object(installer, "_replace", side_effect=failing_replace), self.assertLogs(level="WARNING"):
            first, second = self.submit(1), self.submit(2)
            self.drain()
        self.assertTrue(failed)
        self.assertEqual(manager.get(first["id"])["state"], "error")
        self.assertEqual(manager.get(second["id"])["state"], "complete")
        self.assertEqual(original.read_bytes(), b"old chart")
        self.assertEqual(cover.read_bytes(), b"old cover")
        self.assertEqual((self.root / "spinshare_2.srtb").read_text(), "chart-2")
        self.assertFalse(list(self.root.rglob(".spinshare-stage-*")))
        self.assertFalse(list(self.root.rglob(".spinshare-rollback-*")))


def controlled_benchmark():
    """Compare six simulated 80ms transfers + 40ms installs; this is not a network benchmark."""
    temporary_root = ROOT / ".qa" / "tmp"
    temporary_root.mkdir(parents=True, exist_ok=True)
    if temporary_root.resolve() != temporary_root.absolute():
        raise RuntimeError("The benchmark directory must not be redirected")
    real_install = installer.install_archive

    def download(song_id, target_dir, report, **options):
        time.sleep(0.08)
        return fixture_zip(target_dir, song_id)

    def install(archive, target_dir, report, **options):
        time.sleep(0.04)
        return real_install(archive, target_dir, report, **options)

    results = {}
    for mode in ("serial", "pipeline"):
        with tempfile.TemporaryDirectory(prefix="pipeline-benchmark-", dir=temporary_root) as directory:
            with patch.object(installer, "download_archive", side_effect=download), patch.object(installer, "install_archive", side_effect=install):
                started = time.perf_counter()
                if mode == "serial":
                    for song in range(1, 7):
                        installer.install_song(song, directory, lambda update: None)
                else:
                    manager = installer.JobManager(directory)
                    jobs = [manager.submit(song, f"{song:032x}") for song in range(1, 7)]
                    manager.work.join()
                    try:
                        if any(manager.get(job["id"])["state"] != "complete" for job in jobs):
                            raise AssertionError("The pipeline benchmark did not install every fixture")
                    finally:
                        if not manager.close_if_idle() or not manager.join(10):
                            raise AssertionError("The benchmark workers did not stop")
                results[mode] = time.perf_counter() - started
    print("Controlled simulation: six ZIPs, 80ms download delay + 40ms install delay each; real local ZIP validation/writes.")
    print(f"Serial: {results['serial']:.3f}s; pipeline: {results['pipeline']:.3f}s; ratio: {results['serial'] / results['pipeline']:.2f}x.")
    print("No remote requests were made. These values do not measure SpinShare or internet download speed.")


if __name__ == "__main__":
    if "--benchmark" in sys.argv:
        controlled_benchmark()
    else:
        unittest.main()
