"""Exercise the real installer worker and queue without downloading or writing charts."""
import queue
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from src import installer


class InstallQueueTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.permits = threading.Semaphore(0)
        self.started = queue.Queue()
        self.download_patch = patch.object(installer, "download_archive", side_effect=self.download)
        self.install_patch = patch.object(installer, "install_archive", side_effect=self.install)
        self.download_patch.start()
        self.install_patch.start()
        self.manager = installer.JobManager(self.directory.name)

    def download(self, song_id, target_dir, report, *, deadline=None, unique_name=False):
        self.assertTrue(unique_name)
        report({"state": "downloading"})
        self.started.put(song_id)
        if not self.permits.acquire(timeout=10):
            raise AssertionError("The test did not release the mock download")
        return Path(target_dir) / f"{song_id}.zip"

    def install(self, archive, target_dir, report, *, deadline=None):
        report({"state": "extracting"})
        return {"zipRemoved": True, "filesWritten": 1, "fileCount": 1, "overwrittenFiles": 0}

    def tearDown(self):
        self.permits.release(installer.MAX_ACTIVE_JOBS)
        self.drain()
        self.assertTrue(self.manager.close_if_idle())
        self.assertTrue(self.manager.join(10))
        self.download_patch.stop()
        self.install_patch.stop()
        self.directory.cleanup()
        self.assertFalse(any(worker.is_alive() for worker in self.manager.workers), "All test workers must stop")

    def submit(self, song_id, request_number=None):
        return self.manager.submit(song_id, f"{request_number or song_id:032x}")

    def drain(self):
        work = self.manager.work
        with work.all_tasks_done:
            self.assertTrue(work.all_tasks_done.wait_for(lambda: work.unfinished_tasks == 0, timeout=10))

    def wait_for_completion(self, jobs):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            for job in jobs:
                if self.manager.get(job["id"])["state"] == "complete":
                    return job
            threading.Event().wait(0.005)
        self.fail("No queued installation completed")

    def test_full_queue_deduplicates_and_accepts_again_after_completion(self):
        limit = installer.MAX_ACTIVE_JOBS
        first = self.submit(1)
        self.assertEqual(self.started.get(timeout=10), 1)
        jobs = [first] + [self.submit(song_id) for song_id in range(2, limit + 1)]
        self.assertEqual(self.started.get(timeout=10), 2)
        self.assertEqual(self.manager.active_count(), limit)
        self.assertTrue(self.started.empty(), "Queue capacity must not create more than two downloads")
        self.assertFalse(self.manager.close_if_idle())

        self.assertEqual(self.submit(1)["id"], first["id"])
        self.assertEqual(self.submit(2, limit + 100)["id"], jobs[1]["id"])
        self.assertEqual(self.manager.active_count(), limit)
        with self.assertRaises(installer.InstallError):
            self.submit(2, 1)
        with self.assertRaises(installer.QueueFullError) as rejected:
            self.submit(limit + 1)
        self.assertEqual(rejected.exception.code, "queue_full")
        self.assertIn(f"({limit} tasks)", str(rejected.exception))
        self.assertNotIn(f"{limit + 1:032x}", self.manager.requests)

        self.permits.release()
        completed = self.wait_for_completion(jobs)
        self.assertEqual(self.started.get(timeout=10), 3)
        replacement = self.submit(limit + 1)
        self.assertEqual(replacement["songId"], limit + 1)
        self.assertEqual(self.manager.active_count(), limit)
        self.assertEqual(self.submit(completed["songId"])["id"], completed["id"], "Retrying an accepted request must not reinstall")

    def test_history_pruning_keeps_active_jobs_and_recent_completed_results(self):
        limit = installer.MAX_ACTIVE_JOBS
        old = [self.submit(song_id) for song_id in range(1, limit + 1)]
        self.permits.release(limit)
        self.drain()
        for _ in old:
            self.started.get_nowait()
        self.assertEqual(self.manager.active_count(), 0)

        current = [self.submit(song_id) for song_id in range(limit + 1, limit * 2 + 1)]
        self.assertEqual({self.started.get(timeout=10), self.started.get(timeout=10)}, {limit + 1, limit + 2})
        self.permits.release()
        completed_job = self.wait_for_completion(current)
        added = self.submit(limit * 2 + 1)

        self.assertEqual(len(self.manager.jobs), installer.MAX_STORED_JOBS)
        self.assertIsNone(self.manager.get(old[0]["id"]))
        self.assertNotIn(f"{1:032x}", self.manager.requests)
        self.assertEqual(self.manager.get(completed_job["id"])["state"], "complete")
        with self.manager.lock:
            active_ids = {job["id"] for job in self.manager.jobs.values() if job["state"] in installer.ACTIVE_STATES}
            completed = sum(job["state"] == "complete" for job in self.manager.jobs.values())
        self.assertEqual(active_ids, {job["id"] for job in current if job["id"] != completed_job["id"]} | {added["id"]})
        self.assertEqual(completed, 128, "Recent results remain available for frontend polling at full capacity")


if __name__ == "__main__":
    unittest.main()
