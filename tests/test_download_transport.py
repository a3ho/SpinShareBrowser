"""Check real download/install paths using in-memory HTTP responses and temporary files."""
from concurrent.futures import ThreadPoolExecutor
import email.message
import io
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import zipfile

from src import installer


def chart_zip(files=None):
    files = files or {
        "spinshare_a.srtb": b"new chart",
        "AlbumArt/spinshare_a.png": b"new cover",
        "AudioClips/spinshare_a_0.ogg": b"new audio" * 40,
    }
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED) as archive:
        for name, content in files.items():
            archive.writestr(name, content)
    return output.getvalue(), files


class RecordingSource:
    def __init__(self, payload, *, blocked=False, declared_size=None):
        self.payload = payload
        self.declared_size = len(payload) if declared_size is None else declared_size
        self.condition = threading.Condition()
        self.readable = threading.Event()
        if not blocked:
            self.readable.set()
        self.requests = []
        self.active = self.peak = 0

    def open(self, request, timeout):
        with self.condition:
            self.requests.append(request)
            self.active += 1
            self.peak = max(self.peak, self.active)
            self.condition.notify_all()
        source = self

        class Response(io.BytesIO):
            def __init__(self):
                super().__init__(source.payload)
                self.headers = email.message.Message()
                self.headers["Content-Type"] = "application/zip"
                self.headers["Content-Length"] = str(source.declared_size)
                self.headers["Content-Disposition"] = 'attachment; filename="spinshare_a.zip"'

            def getcode(self):
                return 200

            def read(self, size=-1):
                if not source.readable.wait(timeout=5):
                    raise TimeoutError("The test did not release the response")
                return super().read(size)

            def read1(self, size=-1):
                return self.read(size)

            def close(self):
                if not self.closed:
                    with source.condition:
                        source.active -= 1
                        source.condition.notify_all()
                super().close()

        return Response()


class DownloadTransportTests(unittest.TestCase):
    def test_unique_names_isolate_identical_content_dispositions_and_keep_default_behavior(self):
        payload, _ = chart_zip()
        source = RecordingSource(payload)
        with tempfile.TemporaryDirectory() as directory, patch.object(installer.urllib.request, "build_opener", return_value=source):
            root = Path(directory)
            first = installer.download_archive(1, root, lambda _: None, unique_name=True)
            second = installer.download_archive(2, root, lambda _: None, unique_name=True)
            self.assertNotEqual(first, second)
            for archive in (first, second):
                self.assertRegex(archive.name, r"^spinshare_a-[a-f0-9]{32}\.zip$")
                self.assertEqual(archive.read_bytes(), payload)
            legacy = installer.download_archive(3, root, lambda _: None)
            self.assertEqual(legacy, root / "spinshare_a.zip")
            self.assertEqual(installer.download_archive(4, root, lambda _: None), legacy)
            self.assertEqual(legacy.read_bytes(), payload)
            self.assertFalse(list(root.glob(".spinshare-*")))
        self.assertEqual(source.active, 0)
        self.assertEqual(len(source.requests), 4)
        self.assertEqual([request.full_url for request in source.requests], [
            f"https://spinsha.re/api/song/{song_id}/download" for song_id in range(1, 5)
        ])
        for request in source.requests:
            self.assertEqual(request.get_method(), "GET")
            self.assertFalse(request.has_header("Range"), "The counting endpoint must not be probed for ranges")

    def test_serial_and_parallel_downloads_share_the_connection_limit(self):
        payload, _ = chart_zip()
        for workers, expected_open in ((1, 1), (2, 2), (6, installer.MAX_DOWNLOAD_CONNECTIONS)):
            with self.subTest(workers=workers):
                source = RecordingSource(payload, blocked=True)
                with tempfile.TemporaryDirectory() as directory, patch.object(installer.urllib.request, "build_opener", return_value=source):
                    with ThreadPoolExecutor(max_workers=workers) as pool:
                        futures = [pool.submit(installer.download_archive, song_id, directory, lambda _: None, unique_name=True)
                                   for song_id in range(1, 7)]
                        try:
                            with source.condition:
                                self.assertTrue(source.condition.wait_for(lambda: source.active == expected_open, timeout=3))
                                self.assertEqual(len(source.requests), expected_open)
                        finally:
                            source.readable.set()
                        results = [future.result(timeout=5) for future in futures]
                    self.assertEqual(len(set(results)), 6)
                    for archive in results:
                        self.assertEqual(archive.read_bytes(), payload)
                self.assertEqual(source.active, 0)
                self.assertEqual(source.peak, expected_open)
                self.assertEqual(len(source.requests), 6, "Parallelism must not replay a counting request")

    def test_two_first_downloads_can_create_the_same_missing_custom_directory(self):
        payload, _ = chart_zip()
        source = RecordingSource(payload)
        original_mkdir = Path.mkdir
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory) / "new-parent"
            root = parent / "Custom"
            barriers = {path: threading.Barrier(2) for path in (parent, root)}

            def simultaneous_mkdir(path, *args, **kwargs):
                if path in barriers:
                    barriers[path].wait(timeout=3)  # Both callers observed a missing directory before either creates it.
                return original_mkdir(path, *args, **kwargs)

            with patch.object(Path, "mkdir", simultaneous_mkdir), patch.object(installer.urllib.request, "build_opener", return_value=source):
                with ThreadPoolExecutor(max_workers=2) as pool:
                    futures = [pool.submit(installer.download_archive, song_id, root, lambda _: None, unique_name=True)
                               for song_id in (1, 2)]
                    archives = [future.result(timeout=5) for future in futures]
            self.assertEqual(len(set(archives)), 2)
            self.assertTrue(root.is_dir())
            for archive in archives:
                self.assertEqual(archive.parent, root)
                self.assertEqual(archive.read_bytes(), payload)
            self.assertFalse(list(root.glob(".spinshare-*")))
        self.assertEqual(len(source.requests), 2)
        self.assertEqual(source.active, 0)

    def test_non_directory_custom_root_is_rejected_before_network_access(self):
        payload, _ = chart_zip()
        source = RecordingSource(payload)
        with tempfile.TemporaryDirectory() as directory, patch.object(installer.urllib.request, "build_opener", return_value=source):
            root = Path(directory) / "Custom"
            root.write_bytes(b"existing ordinary file")
            with self.assertRaisesRegex(installer.InstallError, "ordinary folder"):
                installer.download_archive(1, root, lambda _: None, unique_name=True)
            self.assertEqual(root.read_bytes(), b"existing ordinary file")
        self.assertEqual(source.requests, [])

    def test_failed_download_cleans_partial_file_and_releases_connection(self):
        payload, _ = chart_zip()
        source = RecordingSource(payload, declared_size=len(payload) - 1)
        with tempfile.TemporaryDirectory() as directory, patch.object(installer.urllib.request, "build_opener", return_value=source):
            root = Path(directory)
            original = root / "spinshare_a.zip"
            original.write_bytes(b"previous ZIP")
            with self.assertRaises(installer.InstallError):
                installer.download_archive(1, root, lambda _: None)
            self.assertEqual(source.active, 0)
            self.assertEqual(original.read_bytes(), b"previous ZIP")
            self.assertEqual(set(root.iterdir()), {original})
            source.declared_size = len(payload)
            self.assertEqual(installer.download_archive(2, root, lambda _: None).read_bytes(), payload)
        self.assertEqual(source.active, 0)

    def test_http_error_is_closed_without_automatic_replay(self):
        payload, _ = chart_zip()

        class FailOnce(RecordingSource):
            def open(self, request, timeout):
                response = super().open(request, timeout)
                if len(self.requests) == 1:
                    raise installer.urllib.error.HTTPError(request.full_url, 503, "Unavailable", response.headers, response)
                return response

        source = FailOnce(payload)
        with tempfile.TemporaryDirectory() as directory, patch.object(installer.urllib.request, "build_opener", return_value=source):
            with self.assertRaisesRegex(installer.InstallError, "HTTP 503"):
                installer.download_archive(1, directory, lambda _: None)
            self.assertEqual(len(source.requests), 1)
            self.assertEqual(source.active, 0, "Close the error body before releasing its connection permit")
            self.assertFalse(list(Path(directory).iterdir()))
            self.assertEqual(installer.download_archive(2, directory, lambda _: None).read_bytes(), payload)
        self.assertEqual(source.active, 0)

    def test_expired_deadlines_do_not_contact_the_counting_api_or_leak_permits(self):
        payload, _ = chart_zip()
        source = RecordingSource(payload)
        with tempfile.TemporaryDirectory() as directory, patch.object(installer.urllib.request, "build_opener", return_value=source):
            for _ in range(installer.MAX_DOWNLOAD_CONNECTIONS + 1):
                with self.assertRaisesRegex(installer.InstallError, "15 minutes"):
                    installer.download_archive(1, directory, lambda _: None, deadline=time.monotonic() - 1)
            self.assertEqual(source.requests, [])
            archive = installer.download_archive(2, directory, lambda _: None, deadline=time.monotonic() + 2)
            self.assertEqual(archive.read_bytes(), payload)
        self.assertEqual(source.active, 0)

    def test_trickling_response_checks_deadline_and_cleans_up_between_partial_reads(self):
        payload, _ = chart_zip()
        clock = [100.0]
        batches = []

        class TricklingSource(RecordingSource):
            def open(self, request, timeout):
                response = super().open(request, timeout)

                def read1(size=-1):
                    clock[0] += 0.6
                    batches.append(size)
                    return io.BytesIO.read(response, 8)

                def read(size=-1):
                    raise AssertionError("A filling read hides the deadline on a trickling socket")

                response.read1 = read1
                response.read = read
                return response

        source = TricklingSource(payload)
        with tempfile.TemporaryDirectory() as directory, patch.object(installer.urllib.request, "build_opener", return_value=source), patch.object(installer.time, "monotonic", side_effect=lambda: clock[0]):
            root = Path(directory)
            original = root / "spinshare_a.zip"
            original.write_bytes(b"previous ZIP")
            progress = []
            with self.assertRaisesRegex(installer.InstallError, "15 minutes"):
                installer.download_archive(1, root, progress.append, deadline=101.0)
            self.assertEqual(len(batches), 2, "Check the deadline after each available batch")
            self.assertEqual(progress[-1]["downloadedBytes"], 8)
            self.assertEqual(original.read_bytes(), b"previous ZIP")
            self.assertEqual(set(root.iterdir()), {original}, "Remove the partial download on timeout")
        self.assertEqual(len(source.requests), 1, "Timeout must not replay the counting request")
        self.assertEqual(source.active, 0)
        acquired = 0
        try:
            for _ in range(installer.MAX_DOWNLOAD_CONNECTIONS):
                self.assertTrue(installer._DOWNLOAD_CONNECTIONS.acquire(blocking=False), "Timeout must return every connection permit")
                acquired += 1
        finally:
            for _ in range(acquired):
                installer._DOWNLOAD_CONNECTIONS.release()

    def test_staging_decompresses_each_member_once_before_replacing_files(self):
        payload, files = chart_zip()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / "chart.zip"
            archive.write_bytes(payload)
            with patch.object(installer, "_copy_member", wraps=installer._copy_member) as copy:
                result = installer.install_archive(archive, root)
            self.assertEqual(copy.call_count, len(files))
            self.assertTrue(all(call.args[2] is not None for call in copy.call_args_list),
                            "Validation must not decompress a second discarded copy")
            self.assertTrue(result["zipRemoved"])
            self.assertFalse(archive.exists())
            for name, content in files.items():
                self.assertEqual((root / name).read_bytes(), content)

    def test_late_crc_failure_preserves_every_old_file_and_removes_staging(self):
        payload, files = chart_zip()
        damaged = bytearray(payload)
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            last = archive.infolist()[-1]
            offset = last.header_offset + 30 + len(last.filename.encode()) + len(last.extra)
        damaged[offset + last.file_size - 1] ^= 1  # Leave headers/central metadata intact; fail the last member's CRC.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original = {}
            for name in files:
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                original[name] = b"old " + name.encode()
                target.write_bytes(original[name])
            archive = root / "chart.zip"
            archive.write_bytes(damaged)
            with self.assertRaisesRegex(installer.InstallError, "Original files are intact"):
                installer.install_archive(archive, root)
            self.assertEqual(archive.read_bytes(), bytes(damaged), "Keep the failed ZIP for diagnosis/retry")
            for name, content in original.items():
                self.assertEqual((root / name).read_bytes(), content)
            self.assertFalse(list(root.rglob(".spinshare-*")), "No staging or rollback files should remain")


if __name__ == "__main__":
    unittest.main()
