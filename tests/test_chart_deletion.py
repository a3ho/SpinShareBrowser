"""Delete installed charts through the authenticated local API."""
import concurrent.futures
import hashlib
import http.client
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
import installer
import spinshare_portable as portable


class ChartDeletionTests(unittest.TestCase):
    def setUp(self):
        temporary_root = ROOT / ".qa" / "tmp"
        temporary_root.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix="chart-deletion-", dir=temporary_root)
        self.root = Path(self.temporary.name)
        self.target = self.root / "Custom"
        (self.target / "AlbumArt").mkdir(parents=True)
        (self.target / "AudioClips").mkdir()
        self.target_patch = mock.patch.object(installer, "default_target_directory", return_value=self.target)
        self.target_patch.start()

    def tearDown(self):
        self.target_patch.stop()
        self.temporary.cleanup()

    def write_chart(self, reference, body=b'{"chart":true}', *, resources=True):
        (self.target / (reference + ".srtb")).write_bytes(body)
        if resources:
            (self.target / "AlbumArt" / (reference + ".png")).write_bytes(b"cover")
            (self.target / "AudioClips" / (reference + "_0.ogg")).write_bytes(b"audio-0")
            (self.target / "AudioClips" / (reference + "_1.mp3")).write_bytes(b"audio-1")
        return hashlib.md5(body, usedforsecurity=False).hexdigest()

    def request(self, app, body, *, authenticated=True, path="/v1/installations/delete"):
        headers = {"Origin": app.origin, "Content-Type": "application/json"}
        if authenticated:
            headers["X-SpinShare-Key"] = app.token
        connection = http.client.HTTPConnection(portable.HOST, app.port, timeout=3)
        try:
            connection.request("POST", path, body=json.dumps(body), headers=headers)
            response = connection.getresponse()
            raw = response.read()
            return response.status, json.loads(raw) if raw else None
        finally:
            connection.close()

    def options(self, app, path):
        connection = http.client.HTTPConnection(portable.HOST, app.port, timeout=3)
        try:
            connection.request("OPTIONS", path, headers={
                "Origin": app.origin,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type,x-spinshare-key",
            })
            response = connection.getresponse()
            response.read()
            return response.status
        finally:
            connection.close()

    def run_app(self):
        app = portable.PortableApplication(self.root / ("state-" + str(time.time_ns())))
        worker = threading.Thread(target=app.serve_forever, daemon=True)
        worker.start()
        self.assertTrue(app.started.wait(2))
        self.addCleanup(self.stop_app, app, worker)
        return app

    def stop_app(self, app, worker):
        if not app.closed.is_set():
            app.close()
        worker.join(3)
        self.assertFalse(worker.is_alive())

    def deletion_body(self, app, song_id, reference, update_hash):
        return {"expectedRevision": app.manager.revision, "songId": song_id,
                "fileReference": reference, "updateHash": update_hash}

    def test_installation_index_enumerates_only_safe_root_charts_and_returns_actual_hashes(self):
        current = self.target / "spinshare_ab12.srtb"
        old = self.target / "SPINSHARE_CAFE.SRTB"
        current.write_bytes(b'{"current":true}')
        old.write_bytes(b'{"old":true}')
        invalid = {
            "spinshare_.srtb": b"empty",
            "spinshare_xyz.srtb": b"not hex",
            "prefix_spinshare_ab.srtb": b"prefix",
            "spinshare_ab.srtb.backup": b"backup",
            "spinshare_" + "a" * 65 + ".srtb": b"too long",
        }
        for name, body in invalid.items():
            (self.target / name).write_bytes(body)
        nested = self.target / "Nested"
        nested.mkdir()
        (nested / "spinshare_babe.srtb").write_bytes(b"nested")
        (self.target / "spinshare_bad1.srtb").write_bytes(b"\xff")
        oversized = self.target / "spinshare_f00d.srtb"
        with oversized.open("wb") as stream:
            stream.truncate(17)
        (self.target / "spinshare_d1e.srtb").mkdir()
        hardlink_source = self.target / "hardlink-source.bin"
        hardlink_source.write_bytes(b"linked")
        os.link(hardlink_source, self.target / "spinshare_feed.srtb")
        disappearing = self.target / "spinshare_dead.srtb"
        disappearing.write_bytes(b"gone")
        store = portable.ConfigStore(self.root / "index-state")
        manager = portable.PortableManager(store, store.load())
        reads = []
        read_guarded_bytes = portable._read_guarded_bytes

        def observed_read(path, *, limit):
            path = Path(path)
            reads.append(path.name)
            if path.name.lower() == disappearing.name:
                path.unlink()
            return read_guarded_bytes(path, limit=limit)

        try:
            with mock.patch.object(portable, "MAX_CHART_BYTES", 16), \
                    mock.patch.object(portable, "_directory_guard", wraps=portable._directory_guard) as directory_guard, \
                    mock.patch.object(portable, "_read_guarded_bytes", side_effect=observed_read):
                result = manager.index_installations(manager.revision)
        finally:
            self.assertTrue(manager.close_if_idle())
            self.assertTrue(manager.join(3))

        self.assertEqual(result, {"settingsRevision": manager.revision, "installations": [
            {"fileReference": "spinshare_ab12",
             "updateHash": hashlib.md5(current.read_bytes(), usedforsecurity=False).hexdigest()},
            {"fileReference": "spinshare_cafe",
             "updateHash": hashlib.md5(old.read_bytes(), usedforsecurity=False).hexdigest()},
        ]})
        self.assertEqual({name.lower() for name in reads}, {
            "spinshare_ab12.srtb", "spinshare_cafe.srtb", "spinshare_bad1.srtb",
            "spinshare_dead.srtb",
        })
        self.assertEqual(directory_guard.call_count, 1, "The installation root is guarded once per index scan")

    def test_installation_index_revision_closed_and_directory_error_boundaries(self):
        store = portable.ConfigStore(self.root / "index-boundaries-state")
        manager = portable.PortableManager(store, store.load())
        revision = manager.revision
        try:
            for invalid in (None, True, "", "A" * 32):
                with self.assertRaises(portable.APIError) as rejected:
                    manager.index_installations(invalid)
                self.assertEqual((rejected.exception.status, rejected.exception.code),
                                 (400, "invalid_installations"))
            with self.assertRaises(portable.APIError) as stale:
                manager.index_installations("0" * 32)
            self.assertEqual((stale.exception.status, stale.exception.code),
                             (409, "settings_changed"))
            with manager.lock:
                manager.jobs["a" * 32] = {"songId": 1, "state": "queued"}
                manager.exiting = True
            with mock.patch.object(portable, "_directory_guard") as guard:
                with self.assertRaises(portable.APIError) as busy:
                    manager.index_installations(revision)
            self.assertEqual((busy.exception.status, busy.exception.code),
                             (409, "installer_busy"))
            guard.assert_not_called()
            with manager.lock:
                manager.jobs.clear()
            with self.assertRaises(portable.APIError) as exiting:
                manager.index_installations(revision)
            self.assertEqual((exiting.exception.status, exiting.exception.code),
                             (409, "shutting_down"))
            manager.exiting = False
            manager.target_dir = self.root / "missing-install-directory"
            with self.assertRaises(portable.APIError) as unreadable:
                manager.index_installations(revision)
            self.assertEqual((unreadable.exception.status, unreadable.exception.code),
                             (500, "invalid_installations"))
            self.assertTrue(manager.close_if_idle())
            with self.assertRaises(portable.APIError) as closed:
                manager.index_installations(revision)
            self.assertEqual((closed.exception.status, closed.exception.code),
                             (409, "shutting_down"))
        finally:
            manager.close_if_idle()
            self.assertTrue(manager.join(3))

    def test_installation_index_limits_fail_the_whole_streaming_scan(self):
        for index in range(3):
            (self.target / f"spinshare_{index + 1:x}.srtb").write_bytes(b"{}")
        store = portable.ConfigStore(self.root / "index-limits-state")
        manager = portable.PortableManager(store, store.load())
        try:
            with mock.patch.object(portable, "INSTALLATION_INDEX_MAX_ENTRIES", 2):
                with self.assertRaises(portable.APIError) as entries:
                    manager.index_installations(manager.revision)
            self.assertEqual((entries.exception.status, entries.exception.code),
                             (413, "invalid_installations"))

            with mock.patch.object(portable, "INSTALLATION_INDEX_MAX_BYTES", 5):
                with self.assertRaises(portable.APIError) as byte_limit:
                    manager.index_installations(manager.revision)
            self.assertEqual((byte_limit.exception.status, byte_limit.exception.code),
                             (413, "invalid_installations"))

            with mock.patch.object(portable.time, "monotonic", side_effect=[100, 109]):
                with self.assertRaises(portable.APIError) as timeout:
                    manager.index_installations(manager.revision)
            self.assertEqual((timeout.exception.status, timeout.exception.code),
                             (408, "invalid_installations"))

            produced = []

            def paths():
                for index in range(4):
                    produced.append(index)
                    if index == 3:
                        raise AssertionError("The directory iterator was eagerly consumed")
                    yield self.target / f"unrelated-{index}"

            with mock.patch.object(Path, "iterdir", return_value=paths()), \
                    mock.patch.object(portable, "INSTALLATION_INDEX_MAX_DIRECTORY_ENTRIES", 2):
                with self.assertRaises(portable.APIError) as directory_entries:
                    manager.index_installations(manager.revision)
            self.assertEqual((directory_entries.exception.status, directory_entries.exception.code),
                             (413, "invalid_installations"))
            self.assertEqual(produced, [0, 1, 2])
        finally:
            self.assertTrue(manager.close_if_idle())
            self.assertTrue(manager.join(3))

    def test_installation_index_holds_the_manager_lock_until_handles_close(self):
        (self.target / "spinshare_bead.srtb").write_bytes(b"safe")
        store = portable.ConfigStore(self.root / "index-concurrency-state")
        manager = portable.PortableManager(store, store.load())
        manager.config["installDirectoryConfirmed"] = True
        entered, release = threading.Event(), threading.Event()
        read_guarded_bytes = portable._read_guarded_bytes

        def paused_read(*args, **kwargs):
            entered.set()
            self.assertTrue(release.wait(2))
            return read_guarded_bytes(*args, **kwargs)

        fake_job = {"id": "b" * 32, "songId": 9, "state": "queued"}
        try:
            with mock.patch.object(portable, "_read_guarded_bytes", side_effect=paused_read), \
                    mock.patch.object(installer.JobManager, "submit", return_value=fake_job):
                with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
                    index = executor.submit(manager.index_installations, manager.revision)
                    self.assertTrue(entered.wait(2))
                    submit = executor.submit(manager.submit, 9, "c" * 32,
                                             settings_revision=manager.revision)
                    time.sleep(.05)
                    self.assertFalse(submit.done(), "Install submission must wait for the index scan lock")
                    release.set()
                    self.assertEqual(len(index.result(timeout=2)["installations"]), 1)
                    self.assertEqual(submit.result(timeout=2), fake_job)
        finally:
            release.set()
            self.assertTrue(manager.close_if_idle())
            self.assertTrue(manager.join(3))

    def test_guarded_reader_keeps_read_bytes_size_limit_semantics(self):
        path = self.target / "spinshare_1010.srtb"
        body = b"x" * 16
        path.write_bytes(body)

        self.assertEqual(portable._read_bytes(path, limit=len(body)), body)
        with path.open("ab") as stream:
            stream.write(b"x")
        with self.assertRaisesRegex(portable.PortableError, "exceeds the size limit"):
            portable._read_bytes(path, limit=len(body))

    def test_installation_index_api_is_authenticated_strict_and_keeps_legacy_check(self):
        reference = "spinshare_1dea"
        update_hash = self.write_chart(reference, b'{"legacy":true}', resources=False)
        app = self.run_app()
        path = "/v1/installations/index"
        body = {"expectedRevision": app.manager.revision}

        self.assertEqual(self.options(app, path), 204)
        self.assertEqual(self.request(app, body, authenticated=False, path=path)[0], 403)
        for invalid in ({}, dict(body, extra=True), {"expectedRevision": True}):
            status, result = self.request(app, invalid, path=path)
            self.assertEqual((status, result["code"]), (400, "invalid_installations"))
        status, result = self.request(app, {"expectedRevision": "0" * 32}, path=path)
        self.assertEqual((status, result["code"]), (409, "settings_changed"))
        self.assertEqual(self.request(app, body, path=path), (200, {
            "settingsRevision": app.manager.revision,
            "installations": [{"fileReference": reference, "updateHash": update_hash}],
        }))
        status, result = self.request(app, {
            "expectedRevision": app.manager.revision,
            "charts": [{"songId": 71, "fileReference": reference, "updateHash": update_hash}],
        }, path="/v1/installations/check")
        self.assertEqual((status, result["installations"]),
                         (200, [{"songId": 71, "installed": True}]))

    def test_api_is_authenticated_strict_hash_bound_and_deletes_only_owned_files(self):
        reference = "spinshare_ab12"
        update_hash = self.write_chart(reference)
        unrelated = {
            self.target / "another.srtb": b"other chart",
            self.target / "AudioClips" / (reference + "_2.wav"): b"other audio",
            self.target / "AudioClips" / (reference + "_3.ogg.backup"): b"backup",
            self.target / (reference + ".zip"): b"old zip",
            self.target / ".spinshare-existing.tmp": b"old temp",
        }
        for path, body in unrelated.items():
            path.write_bytes(body)
        app = self.run_app()
        body = self.deletion_body(app, 17, reference, update_hash)

        self.assertEqual(self.request(app, body, authenticated=False)[0], 403)
        self.assertEqual(self.request(app, dict(body, extra=True))[0], 400)
        invalid = dict(body, songId=True)
        status, result = self.request(app, invalid)
        self.assertEqual((status, result["code"]), (400, "invalid_deletion"))
        stale = dict(body, expectedRevision="0" * 32)
        status, result = self.request(app, stale)
        self.assertEqual((status, result["code"]), (409, "settings_changed"))
        changed = dict(body, updateHash="f" * 32)
        status, result = self.request(app, changed)
        self.assertEqual((status, result["code"]), (409, "installation_changed"))
        self.assertTrue((self.target / (reference + ".srtb")).exists())

        status, result = self.request(app, body)
        self.assertEqual(status, 200)
        self.assertEqual(result, {"settingsRevision": app.manager.revision, "songId": 17,
                                  "deleted": True, "filesDeleted": 4})
        self.assertFalse((self.target / (reference + ".srtb")).exists())
        self.assertFalse((self.target / "AlbumArt" / (reference + ".png")).exists())
        self.assertFalse((self.target / "AudioClips" / (reference + "_0.ogg")).exists())
        self.assertFalse((self.target / "AudioClips" / (reference + "_1.mp3")).exists())
        self.assertTrue((self.target / "AlbumArt").is_dir())
        self.assertTrue((self.target / "AudioClips").is_dir())
        for path, content in unrelated.items():
            self.assertEqual(path.read_bytes(), content)
        self.assertFalse(list(self.target.rglob(".spinshare-delete-*")))
        self.assertEqual(app.manager.check_installations([{
            "songId": 17, "fileReference": reference, "updateHash": update_hash,
        }], app.manager.revision)["installations"], [{"songId": 17, "installed": False}])

    def test_staging_failure_restores_every_original(self):
        reference = "spinshare_cafe"
        update_hash = self.write_chart(reference)
        originals = {path: path.read_bytes() for path in self.target.rglob("*") if path.is_file()}
        replace = installer._replace

        def fail_chart_stage(root, source, target):
            if Path(source).name == reference + ".srtb":
                raise PermissionError("locked")
            return replace(root, source, target)

        with mock.patch.object(installer, "_replace", side_effect=fail_chart_stage):
            with self.assertRaisesRegex(installer.InstallError, "original files were restored"):
                installer.delete_chart_files(self.target, reference, update_hash)

        self.assertEqual({path: path.read_bytes() for path in self.target.rglob("*") if path.is_file()}, originals)
        self.assertFalse(list(self.target.rglob(".spinshare-delete-*")))

    def test_first_cleanup_failure_restores_every_original(self):
        reference = "spinshare_dead"
        update_hash = self.write_chart(reference)
        originals = {path: path.read_bytes() for path in self.target.rglob("*") if path.is_file()}
        unlink = installer._unlink
        failed = False

        def fail_first_cleanup(root, path):
            nonlocal failed
            if not failed and Path(path).name.startswith(".spinshare-delete-"):
                failed = True
                raise PermissionError("locked")
            return unlink(root, path)

        with mock.patch.object(installer, "_unlink", side_effect=fail_first_cleanup):
            with self.assertRaisesRegex(installer.InstallError, "original files were restored"):
                installer.delete_chart_files(self.target, reference, update_hash)

        self.assertEqual({path: path.read_bytes() for path in self.target.rglob("*") if path.is_file()}, originals)
        self.assertFalse(list(self.target.rglob(".spinshare-delete-*")))

    def test_chart_changed_after_api_check_is_restored_instead_of_deleted(self):
        reference = "spinshare_face"
        update_hash = self.write_chart(reference)
        app = self.run_app()
        body = self.deletion_body(app, 19, reference, update_hash)
        original_delete = installer.delete_chart_files

        def change_then_delete(*args, **kwargs):
            (self.target / (reference + ".srtb")).write_bytes(b'{"locallyEdited":true}')
            return original_delete(*args, **kwargs)

        with mock.patch.object(installer, "delete_chart_files", side_effect=change_then_delete):
            status, result = self.request(app, body)

        self.assertEqual((status, result["code"]), (409, "installation_changed"))
        self.assertEqual((self.target / (reference + ".srtb")).read_bytes(), b'{"locallyEdited":true}')
        self.assertTrue((self.target / "AlbumArt" / (reference + ".png")).exists())
        self.assertTrue((self.target / "AudioClips" / (reference + "_0.ogg")).exists())
        self.assertFalse(list(self.target.rglob(".spinshare-delete-*")))

    def test_later_cleanup_failure_reports_partial_restore_and_keeps_chart(self):
        reference = "spinshare_fade"
        update_hash = self.write_chart(reference)
        unlink = installer._unlink
        cleanup_calls = 0

        def fail_second_cleanup(root, path):
            nonlocal cleanup_calls
            if Path(path).name.startswith(".spinshare-delete-"):
                cleanup_calls += 1
                if cleanup_calls == 2:
                    raise PermissionError("locked")
            return unlink(root, path)

        with mock.patch.object(installer, "_unlink", side_effect=fail_second_cleanup):
            with self.assertRaisesRegex(installer.DeletePartialError, "some files could not be restored"):
                installer.delete_chart_files(self.target, reference, update_hash)

        self.assertTrue((self.target / (reference + ".srtb")).exists())
        self.assertFalse(list(self.target.rglob(".spinshare-delete-*")))

    def test_matching_audio_names_are_case_insensitive(self):
        reference = "spinshare_abcd"
        update_hash = self.write_chart(reference)
        audio = self.target / "AudioClips" / (reference + "_0.ogg")
        upper = self.target / "AudioClips" / (reference.upper() + "_0.OGG")
        audio.rename(upper)

        result = installer.delete_chart_files(self.target, reference, update_hash)

        self.assertEqual(result["filesDeleted"], 4)
        self.assertFalse(upper.exists())

    def test_casefold_colliding_audio_aborts_before_staging(self):
        reference = "spinshare_a11d"
        update_hash = self.write_chart(reference, resources=False)
        lower = self.target / "AudioClips" / (reference + "_0.ogg")
        lower.write_bytes(b"audio")
        upper = lower.with_name(lower.name.upper())
        with mock.patch.object(Path, "iterdir", return_value=iter((lower, upper))), \
                mock.patch.object(installer, "_replace", wraps=installer._replace) as replace:
            with self.assertRaisesRegex(installer.InstallError, "collide"):
                installer.delete_chart_files(self.target, reference, update_hash)

        replace.assert_not_called()
        self.assertTrue((self.target / (reference + ".srtb")).exists())
        self.assertTrue(lower.exists())

    def test_matching_audio_limit_aborts_without_deleting_anything(self):
        reference = "spinshare_4096"
        update_hash = self.write_chart(reference, resources=False)
        audio = [self.target / "AudioClips" / f"{reference}_{index}.ogg" for index in range(3)]
        for path in audio:
            path.write_bytes(b"audio")

        with mock.patch.object(installer, "MAX_DELETE_AUDIO_FILES", 2):
            with self.assertRaisesRegex(installer.InstallError, "too many"):
                installer.delete_chart_files(self.target, reference, update_hash)

        self.assertTrue((self.target / (reference + ".srtb")).exists())
        self.assertTrue(all(path.exists() for path in audio))
        self.assertFalse(list(self.target.rglob(".spinshare-delete-*")))

    def test_staged_chart_hash_is_size_bounded_and_rolls_back(self):
        reference = "spinshare_b0ad"
        body = b"five!"
        update_hash = self.write_chart(reference, body, resources=False)

        with self.assertRaises(installer.ChartChangedError):
            installer.delete_chart_files(self.target, reference, update_hash,
                                         max_chart_bytes=len(body) - 1)

        self.assertEqual((self.target / (reference + ".srtb")).read_bytes(), body)
        self.assertFalse(list(self.target.rglob(".spinshare-delete-*")))

    def test_chart_disappearing_after_api_precheck_is_installation_changed(self):
        reference = "spinshare_d15a"
        update_hash = self.write_chart(reference, resources=False)
        app = self.run_app()
        body = self.deletion_body(app, 29, reference, update_hash)
        original_delete = installer.delete_chart_files
        observed = {}

        def disappear_then_delete(*args, **kwargs):
            observed.update(kwargs)
            (self.target / (reference + ".srtb")).unlink()
            return original_delete(*args, **kwargs)

        with mock.patch.object(installer, "delete_chart_files", side_effect=disappear_then_delete):
            status, result = self.request(app, body)

        self.assertEqual((status, result["code"]), (409, "installation_changed"))
        self.assertEqual(observed["max_chart_bytes"], portable.MAX_CHART_BYTES)

    def test_partial_restore_has_a_distinct_api_error(self):
        reference = "spinshare_d00d"
        update_hash = self.write_chart(reference, resources=False)
        app = self.run_app()
        body = self.deletion_body(app, 21, reference, update_hash)
        with mock.patch.object(installer, "delete_chart_files",
                               side_effect=installer.DeletePartialError("some files could not be restored")):
            status, result = self.request(app, body)
        self.assertEqual((status, result["code"]), (500, "delete_partial"))

    def test_active_install_blocks_deletion_without_touching_files(self):
        reference = "spinshare_beef"
        update_hash = self.write_chart(reference, resources=False)
        app = self.run_app()
        body = self.deletion_body(app, 23, reference, update_hash)
        with app.manager.lock:
            app.manager.jobs["a" * 32] = {"songId": 99, "state": "queued"}
        try:
            status, result = self.request(app, body)
            self.assertEqual((status, result["code"]), (409, "installer_busy"))
            self.assertTrue((self.target / (reference + ".srtb")).exists())
        finally:
            with app.manager.lock:
                app.manager.jobs.clear()

    def test_concurrent_requests_are_serial_and_independent(self):
        app = self.run_app()
        charts = [(31, "spinshare_31"), (32, "spinshare_32")]
        bodies = [self.deletion_body(app, song_id, reference, self.write_chart(reference))
                  for song_id, reference in charts]
        original_delete = installer.delete_chart_files
        guard = threading.Lock()
        active = 0
        maximum = 0

        def observed_delete(*args, **kwargs):
            nonlocal active, maximum
            with guard:
                active += 1
                maximum = max(maximum, active)
            try:
                time.sleep(.05)
                return original_delete(*args, **kwargs)
            finally:
                with guard:
                    active -= 1

        with mock.patch.object(installer, "delete_chart_files", side_effect=observed_delete):
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
                results = list(executor.map(lambda body: self.request(app, body), bodies))

        self.assertEqual([status for status, _ in results], [200, 200])
        self.assertEqual({result["songId"] for _, result in results}, {31, 32})
        self.assertEqual(maximum, 1)
        for _, reference in charts:
            self.assertFalse((self.target / (reference + ".srtb")).exists())


if __name__ == "__main__":
    unittest.main()
