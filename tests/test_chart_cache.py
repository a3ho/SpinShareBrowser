"""Catalog throttling, persistence and API checks; all remote traffic is mocked."""
from concurrent.futures import ThreadPoolExecutor
import contextlib
import http.client
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
import installer
import spinshare_portable as portable
import maintenance

FETCH_CATALOG = portable._fetch_chart_catalog
ROWS = [{"id": 101, "title": "Offline chart", "tags": ["EDM", "Piano"], "description": "Author note\n第二行"}]


def run_catalog_process_fixture(options):
    """Run a real local app lifecycle in a fresh, network-isolated interpreter."""
    root = Path(options["root"]).resolve()
    assert root.parent == (ROOT / ".qa" / "tmp").resolve()

    def only_loopback(event, args):
        if event == "socket.connect":
            address = args[1]
            if not isinstance(address, tuple) or address[0] not in {"127.0.0.1", "::1"}:
                raise AssertionError("External sockets are forbidden in this fixture")

    sys.addaudithook(only_loopback)
    reservations, replacements = [], []
    replace = os.replace
    failure = options.get("failure")
    with contextlib.ExitStack() as stack:
        https = stack.enter_context(mock.patch.object(http.client, "HTTPSConnection",
            side_effect=AssertionError("HTTPS is forbidden in this fixture")))
        stack.enter_context(mock.patch.object(installer, "known_folder_path", return_value=root / "LocalAppData"))
        stack.enter_context(mock.patch.object(Path, "home", return_value=root / "home"))
        stack.enter_context(mock.patch.object(installer, "default_target_directory", return_value=root / "Custom-A"))
        stack.enter_context(mock.patch.object(portable.time, "time_ns", return_value=options["now"] * 1000000))
        stack.enter_context(mock.patch.object(portable.time, "monotonic_ns", return_value=1000000))
        state = portable.default_state_directory()
        state.mkdir(parents=True, exist_ok=True)
        cache_path = state / portable.CHART_CACHE_NAME

        def fetch():
            reservations.append(json.loads(cache_path.read_bytes()))
            if failure == "fetch":
                raise OSError("offline fixture")
            return options["rows"]

        def atomic_replace(source, destination):
            if Path(destination) != cache_path:
                return replace(source, destination)
            source = Path(source)
            assert source != cache_path and source.name.startswith(".spinshare-charts-cache.json-")
            before = json.loads(cache_path.read_bytes()) if cache_path.exists() else None
            after = json.loads(source.read_bytes())
            if failure == "reservation" and after["refreshError"] is not None:
                raise OSError("reservation write failed")
            if failure == "commit" and after["refreshError"] is None:
                raise OSError("final catalog write failed")
            replace(source, destination)
            assert json.loads(cache_path.read_bytes()) == after
            replacements.append({"before": before, "after": after})

        stack.enter_context(mock.patch.object(portable, "_fetch_chart_catalog", side_effect=fetch))
        stack.enter_context(mock.patch.object(os, "replace", side_effect=atomic_replace))
        lock = portable.InstanceLock(state)
        app, worker = None, None
        try:
            assert lock.try_acquire(), "The prior process must release its instance lock"
            app = portable.PortableApplication(state)
            worker = threading.Thread(target=app.serve_forever, daemon=True)
            worker.start()
            assert app.started.wait(3)
            if options.get("change_directory"):
                app.manager.update_directory(root / "Custom-B", app.manager.revision)
            assert portable.default_state_directory() == state
            assert app.server.chart_cache.path == cache_path
            responses = []
            for _ in range(2):
                connection = http.client.HTTPConnection(portable.HOST, app.port, timeout=3)
                try:
                    connection.request("GET", "/v1/charts", headers={"Origin": app.origin, "X-SpinShare-Key": app.token})
                    response = connection.getresponse()
                    responses.append({"status": response.status, "body": json.loads(response.read())})
                finally:
                    connection.close()
            before_close = cache_path.read_bytes()
            result = {"pid": os.getpid(), "instanceId": app.instance_id, "cachePath": str(cache_path),
                      "targetDirectory": str(app.manager.target_dir), "responses": responses,
                      "reservations": reservations, "replacements": replacements}
        finally:
            if app is not None:
                app.close()
                if worker is not None:
                    worker.join(3)
                    assert not worker.is_alive()
                assert app.closed.is_set() and app.manager.join(3)
                assert not app.runtime_path.exists()
            lock.close()
        assert cache_path.read_bytes() == before_close, "Normal close must preserve the complete durable cache"
        assert not list(state.rglob(".spinshare-charts-cache.json-*.tmp"))
        https.assert_not_called()
        result["disk"] = json.loads(cache_path.read_bytes())
        result["closed"] = True
    print(json.dumps(result, ensure_ascii=False))


class ChartCacheTests(unittest.TestCase):
    def setUp(self):
        temporary_root = ROOT / ".qa" / "tmp"
        temporary_root.mkdir(parents=True, exist_ok=True)
        self.assertEqual(temporary_root.resolve(), temporary_root.absolute())
        self.temporary = tempfile.TemporaryDirectory(prefix="chart-cache-", dir=temporary_root)
        self.root = Path(self.temporary.name)
        self.state = self.root / "state"
        self.state.mkdir()
        self.addCleanup(self.cleanup_workspace)
        self.wall_ms, self.monotonic_ms = 1800000000000, 1000000
        for patcher in (
            mock.patch.object(portable.http.client, "HTTPSConnection", side_effect=AssertionError("Real network access is forbidden")),
            mock.patch.object(installer, "default_target_directory", return_value=self.root / "Custom"),
            mock.patch.object(portable.time, "time_ns", side_effect=lambda: self.wall_ms * 1000000),
            mock.patch.object(portable.time, "monotonic_ns", side_effect=lambda: self.monotonic_ms * 1000000),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)
        patcher = mock.patch.object(portable, "_fetch_chart_catalog", return_value=ROWS)
        self.fetch = patcher.start()
        self.addCleanup(patcher.stop)
        self.cache = portable.ChartCatalogCache(self.state)

    def cleanup_workspace(self):
        self.assertEqual(self.root.resolve().parent, (ROOT / ".qa" / "tmp").resolve())
        self.temporary.cleanup()

    def advance(self, milliseconds):
        self.wall_ms += milliseconds
        self.monotonic_ms += milliseconds

    def run_cache_process(self, now, rows, **options):
        completed = subprocess.run([sys.executable, "-B", "-X", "utf8", str(Path(__file__).resolve()), "--cache-process"],
            input=json.dumps({"root": str(self.root), "now": now, "rows": rows, **options}, ensure_ascii=False),
            cwd=ROOT, capture_output=True, text=True, encoding="utf-8", timeout=20)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        result = json.loads(completed.stdout)
        self.assertNotEqual(result["pid"], os.getpid())
        self.assertTrue(result["closed"])
        self.assertTrue(all(response["status"] == 200 for response in result["responses"]))
        return result

    def assert_api_error(self, cache, status, code):
        with self.assertRaises(portable.APIError) as caught:
            cache.get()
        self.assertEqual((caught.exception.status, caught.exception.code), (status, code))
        self.assertEqual(caught.exception.details["serverNow"], self.wall_ms)
        return caught.exception.details

    def test_persists_before_fetch_and_enforces_exact_boundary_after_restart(self):
        def fetch_after_reservation():
            saved = json.loads(self.cache.path.read_bytes())
            self.assertEqual(saved["lastAttemptAt"], self.wall_ms)
            self.assertIsNone(saved["data"])
            self.assertTrue(saved["refreshError"])
            return ROWS
        self.fetch.side_effect = fetch_after_reservation
        first = self.cache.get()
        self.assertFalse(first["cached"])
        self.assertEqual(first["data"], ROWS)
        self.assertEqual(first["fetchedAt"], self.wall_ms)
        self.assertEqual(first["nextAllowedAt"], self.wall_ms + 600000)
        self.assertEqual(first["retryAfterSeconds"], 600)
        self.advance(599999)
        restarted = portable.ChartCatalogCache(self.state)
        cached = restarted.get()
        self.assertTrue(cached["cached"])
        self.assertEqual(cached["data"], ROWS)
        self.assertEqual(cached["retryAfterSeconds"], 1)
        self.fetch.assert_called_once()
        self.advance(1)
        self.fetch.side_effect = None
        self.assertFalse(restarted.get()["cached"])
        self.assertEqual(self.fetch.call_count, 2)

    def test_concurrent_callers_share_one_remote_fetch(self):
        entered, release = threading.Event(), threading.Event()
        def delayed_fetch():
            entered.set()
            self.assertTrue(release.wait(3))
            return ROWS
        self.fetch.side_effect = delayed_fetch
        with ThreadPoolExecutor(max_workers=8) as workers:
            first = workers.submit(self.cache.get)
            self.assertTrue(entered.wait(2))
            waiting = [workers.submit(self.cache.get) for _ in range(7)]
            release.set()
            results = [future.result(timeout=3) for future in (first, *waiting)]
        self.fetch.assert_called_once()
        self.assertEqual(sum(not result["cached"] for result in results), 1)
        self.assertTrue(all(result["data"] == ROWS for result in results))

    def test_failed_attempt_stays_throttled_after_restart_without_cache(self):
        self.fetch.side_effect = OSError("offline")
        failed = self.assert_api_error(self.cache, 502, "charts_unavailable")
        self.assertEqual(failed["retryAfterSeconds"], 600)
        self.assertTrue(failed["refreshError"])
        self.advance(599999)
        self.fetch.side_effect = None
        restarted = portable.ChartCatalogCache(self.state)
        limited = self.assert_api_error(restarted, 409, "charts_cooldown")
        self.assertEqual(limited["retryAfterSeconds"], 1)
        self.fetch.assert_called_once()
        self.advance(1)
        self.assertEqual(restarted.get()["data"], ROWS)
        self.assertEqual(self.fetch.call_count, 2)

    def test_refresh_failure_keeps_previous_data_and_error_on_disk(self):
        original = self.cache.get()
        self.advance(600000)
        self.fetch.side_effect = OSError("offline")
        fallback = self.cache.get()
        self.assertTrue(fallback["cached"])
        self.assertEqual(fallback["data"], ROWS)
        self.assertEqual(fallback["fetchedAt"], original["fetchedAt"])
        self.assertTrue(fallback["refreshError"])
        self.assertEqual(portable.ChartCatalogCache(self.state).get(), fallback)
        self.assertEqual(self.fetch.call_count, 2)

    def test_system_clock_jump_cannot_shorten_running_process_cooldown(self):
        self.cache.get()
        self.wall_ms += 86400000
        self.monotonic_ms += 1000
        cached = self.cache.get()
        self.assertTrue(cached["cached"])
        self.assertEqual(cached["retryAfterSeconds"], 599)
        self.fetch.assert_called_once()

    def test_storage_failures_and_unsafe_files_block_remote_requests(self):
        with mock.patch.object(portable, "_atomic_write", side_effect=OSError("disk full")):
            self.assert_api_error(self.cache, 500, "charts_cache_error")
        self.fetch.assert_not_called()
        self.assertFalse(self.cache.path.exists())
        self.cache.path.write_bytes(b'{"broken":')
        self.assert_api_error(portable.ChartCatalogCache(self.state), 500, "charts_cache_error")
        self.assertEqual(self.cache.path.read_bytes(), b'{"broken":')
        linked_dir = self.root / "hardlink"
        linked_dir.mkdir()
        os.link(self.cache.path, linked_dir / portable.CHART_CACHE_NAME)
        self.assert_api_error(portable.ChartCatalogCache(linked_dir), 500, "charts_cache_error")
        self.fetch.assert_not_called()

    def test_failed_final_cache_write_keeps_durable_attempt_reservation(self):
        write = portable._atomic_write
        calls = 0
        def fail_after_reservation(path, data):
            nonlocal calls
            if path.name == portable.CHART_CACHE_NAME:
                calls += 1
                if calls == 2:
                    raise OSError("disk full after network response")
            write(path, data)
        with mock.patch.object(portable, "_atomic_write", side_effect=fail_after_reservation):
            failed = self.assert_api_error(self.cache, 500, "charts_cache_error")
        self.assertTrue(failed["refreshError"])
        self.assertIsNone(self.cache.state["data"])
        self.assertIsNone(self.cache.state["fetchedAt"])
        self.assertIsNone(json.loads(self.cache.path.read_bytes())["data"])
        self.assert_api_error(self.cache, 409, "charts_cooldown")
        self.assert_api_error(portable.ChartCatalogCache(self.state), 409, "charts_cooldown")
        self.fetch.assert_called_once()

    def test_failed_refresh_commit_keeps_previous_catalog_in_memory_and_on_disk(self):
        original = self.cache.get()
        self.advance(600000)
        updated = [{"id": 202, "title": "Replacement chart", "description": "A newly fetched version"}]
        self.fetch.return_value = updated
        write = portable._atomic_write

        def fail_new_catalog(path, raw):
            if path.name == portable.CHART_CACHE_NAME and json.loads(raw)["data"] == updated:
                self.assertEqual(self.cache.state["data"], ROWS, "New data must not be published before its durable write")
                raise OSError("disk full after reservation")
            write(path, raw)

        with mock.patch.object(portable, "_atomic_write", side_effect=fail_new_catalog):
            fallback = self.cache.get()
        self.assertTrue(fallback["cached"])
        self.assertEqual(fallback["data"], ROWS)
        self.assertEqual(fallback["fetchedAt"], original["fetchedAt"])
        self.assertEqual(fallback["lastAttemptAt"], self.wall_ms)
        self.assertEqual(fallback["retryAfterSeconds"], 600)
        self.assertIn("could not be saved", fallback["refreshError"])
        for cache in (self.cache, portable.ChartCatalogCache(self.state)):
            restored = cache.get()
            self.assertEqual(restored["data"], ROWS)
            self.assertEqual(restored["fetchedAt"], original["fetchedAt"])
            self.assertEqual(restored["lastAttemptAt"], self.wall_ms)
        self.assertEqual(self.fetch.call_count, 2)
        self.advance(600000)
        self.assertEqual(self.cache.get()["data"], updated)
        self.assertEqual(portable.ChartCatalogCache(self.state).get()["data"], updated)

    def test_reservation_write_failure_reuses_valid_cache_without_remote_fetch(self):
        original = self.cache.get()
        saved = self.cache.path.read_bytes()
        self.advance(600000)
        self.fetch.reset_mock()
        with mock.patch.object(portable, "_atomic_write", side_effect=OSError("disk full")):
            for cache in (self.cache, portable.ChartCatalogCache(self.state)):
                fallback = cache.get()
                self.assertTrue(fallback["cached"])
                self.assertEqual(fallback["data"], ROWS)
                self.assertEqual(fallback["lastAttemptAt"], original["lastAttemptAt"])
                self.assertEqual(fallback["fetchedAt"], original["fetchedAt"])
                self.assertIn("cooldown could not be saved", fallback["refreshError"])
        self.fetch.assert_not_called()
        self.assertEqual(self.cache.path.read_bytes(), saved)
        self.assertFalse(self.cache.get()["cached"], "A failed reservation must not invent a successful remote attempt")
        self.fetch.assert_called_once()

    def test_unsafe_warm_cache_does_not_fall_back_as_an_ordinary_write_failure(self):
        self.cache.get()
        self.advance(600000)
        raw = self.cache.path.read_bytes()
        os.link(self.cache.path, self.root / "cache-hardlink.json")
        self.assert_api_error(self.cache, 500, "charts_cache_error")
        self.fetch.assert_called_once()
        self.assertEqual(self.cache.path.read_bytes(), raw)

    def test_normal_close_and_fresh_process_preserve_complete_catalog_and_exact_cooldown(self):
        initial = [dict(ROWS[0], views=9, downloads=2, uploader=7, uploadDate={"date": "2026-08-31", "timezone": "Europe/Berlin"}),
                   {"id": 202, "title": "All difficulties", "hasEasyDifficulty": True, "easyDifficulty": 1,
                    "tags": [], "description": "", "extra": {"keep": [True, None, "完整字段"]}}]
        updated = [{"id": 303, "title": "Entirely replaced catalog", "tags": ["Rock"], "description": "新版完整说明"}]
        first = self.run_cache_process(self.wall_ms, initial)
        self.assertFalse(first["responses"][0]["body"]["cached"])
        self.assertTrue(first["responses"][1]["body"]["cached"])
        self.assertEqual(first["disk"]["data"], initial)
        self.assertEqual(first["disk"]["lastAttemptAt"], self.wall_ms)
        self.assertEqual(first["disk"]["fetchedAt"], self.wall_ms)
        self.assertEqual(len(first["reservations"]), 1)
        self.assertIsNone(first["reservations"][0]["data"])
        self.assertEqual(first["reservations"][0]["lastAttemptAt"], self.wall_ms)
        self.assertEqual(len(first["replacements"]), 2)
        early = self.run_cache_process(self.wall_ms + 599999, updated, change_directory=True)
        self.assertEqual(early["cachePath"], first["cachePath"])
        self.assertNotEqual(early["targetDirectory"], first["targetDirectory"])
        self.assertEqual(early["disk"], first["disk"])
        self.assertEqual(early["reservations"], [])
        self.assertEqual(early["replacements"], [])
        for response in early["responses"]:
            self.assertTrue(response["body"]["cached"])
            self.assertEqual(response["body"]["data"], initial)
            self.assertEqual(response["body"]["retryAfterSeconds"], 1)
        due = self.run_cache_process(self.wall_ms + 600000, updated)
        self.assertEqual(due["cachePath"], first["cachePath"])
        self.assertEqual(due["targetDirectory"], early["targetDirectory"])
        self.assertEqual(len(due["reservations"]), 1)
        self.assertEqual(due["reservations"][0]["data"], initial)
        self.assertEqual(due["reservations"][0]["lastAttemptAt"], self.wall_ms + 600000)
        self.assertEqual(len(due["replacements"]), 2)
        self.assertEqual(due["replacements"][1]["before"], due["reservations"][0])
        self.assertEqual(due["replacements"][1]["after"], due["disk"])
        self.assertFalse(due["responses"][0]["body"]["cached"])
        self.assertTrue(due["responses"][1]["body"]["cached"])
        self.assertEqual(due["disk"]["data"], updated)
        self.assertEqual(due["disk"]["fetchedAt"], self.wall_ms + 600000)
        restored = self.run_cache_process(self.wall_ms + 600001, initial)
        self.assertEqual(restored["disk"], due["disk"])
        self.assertEqual(restored["reservations"], [])
        self.assertEqual(restored["replacements"], [])
        self.assertEqual(restored["responses"][0]["body"]["data"], updated)
        self.assertEqual(len({step["instanceId"] for step in (first, early, due, restored)}), 4)

    def test_fresh_process_failures_keep_old_catalog_and_durable_attempt(self):
        updated = [{"id": 404, "description": "Recovered catalog"}]
        first = self.run_cache_process(self.wall_ms, ROWS)
        network_failure = self.run_cache_process(self.wall_ms + 600000, updated, failure="fetch")
        self.assertEqual(len(network_failure["reservations"]), 1)
        self.assertEqual(network_failure["disk"]["data"], ROWS)
        self.assertEqual(network_failure["disk"]["fetchedAt"], first["disk"]["fetchedAt"])
        self.assertEqual(network_failure["disk"]["lastAttemptAt"], self.wall_ms + 600000)
        self.assertTrue(network_failure["responses"][0]["body"]["refreshError"])
        cooling = self.run_cache_process(self.wall_ms + 1199999, updated)
        self.assertEqual(cooling["reservations"], [])
        self.assertEqual(cooling["disk"], network_failure["disk"])
        self.assertEqual(cooling["responses"][0]["body"]["retryAfterSeconds"], 1)
        reservation_failure = self.run_cache_process(self.wall_ms + 1200000, updated, failure="reservation")
        self.assertEqual(reservation_failure["reservations"], [])
        self.assertEqual(reservation_failure["disk"], network_failure["disk"])
        self.assertIn("cooldown could not be saved", reservation_failure["responses"][0]["body"]["refreshError"])
        commit_failure = self.run_cache_process(self.wall_ms + 1200000, updated, failure="commit")
        self.assertEqual(len(commit_failure["reservations"]), 1)
        self.assertEqual(commit_failure["disk"]["data"], ROWS)
        self.assertEqual(commit_failure["disk"]["fetchedAt"], first["disk"]["fetchedAt"])
        self.assertEqual(commit_failure["disk"]["lastAttemptAt"], self.wall_ms + 1200000)
        self.assertTrue(commit_failure["responses"][0]["body"]["cached"])
        self.assertEqual(commit_failure["responses"][0]["body"]["data"], ROWS)
        self.assertIn("could not be saved", commit_failure["responses"][0]["body"]["refreshError"])
        restarted = self.run_cache_process(self.wall_ms + 1799999, updated)
        self.assertEqual(restarted["reservations"], [])
        self.assertEqual(restarted["disk"], commit_failure["disk"])
        self.assertEqual(restarted["responses"][0]["body"]["retryAfterSeconds"], 1)
        recovered = self.run_cache_process(self.wall_ms + 1800000, updated)
        self.assertEqual(len(recovered["reservations"]), 1)
        self.assertEqual(recovered["disk"]["data"], updated)
        self.assertEqual(recovered["disk"]["lastAttemptAt"], self.wall_ms + 1800000)

    def test_uninstall_removes_large_owned_catalog_and_temporaries_but_upgrade_keeps_cache(self):
        program = self.root / "program"
        program.mkdir()
        self.fetch.return_value = [{"id": 101, "description": "x" * (maintenance.MAX_PAGE_BYTES + 1)}]
        self.cache.get()
        raw = self.cache.path.read_bytes()
        legacy = self.state / ".spinshare-charts-cache.json-abc123__.tmp"
        legacy.write_bytes(raw)
        unknown = self.state / ".spinshare-charts-cache.json-def456__.tmp"
        unknown.write_bytes(b"unrecognized file")
        notes = self.state / "notes.txt"
        notes.write_bytes(b"user notes")
        with maintenance.prepare_temp_directory(self.state) as temporary:
            (temporary / ".spinshare-charts-cache.json-ghi789__.tmp").write_bytes(b'{"unfinished":')
        with mock.patch.object(portable, "default_state_directory", return_value=self.state):
            maintenance.prepare_upgrade(self.state, program)
            self.assertEqual(self.cache.path.read_bytes(), raw)
            result = maintenance.cleanup_state(self.state, program)
        self.assertIn(portable.CHART_CACHE_NAME, result["removed"])
        self.assertIn(legacy.name, result["removed"])
        self.assertEqual(set(result["retained"]), {unknown.name, notes.name})
        self.assertFalse(self.cache.path.exists())
        self.assertFalse((self.state / "Temp").exists())
        self.assertEqual(unknown.read_bytes(), b"unrecognized file")
        self.assertEqual(notes.read_bytes(), b"user notes")

    def test_uninstall_retains_corrupt_or_linked_catalog_without_deleting_other_data(self):
        program = self.root / "program"
        program.mkdir()
        for case in ("corrupt", "hardlink"):
            with self.subTest(case=case):
                state = self.root / case
                state.mkdir()
                notes = state / "notes.txt"
                notes.write_bytes(b"user notes")
                path = state / portable.CHART_CACHE_NAME
                if case == "corrupt":
                    path.write_bytes(b'{"schemaVersion":999}')
                else:
                    os.link(notes, path)
                original = path.read_bytes()
                with mock.patch.object(portable, "default_state_directory", return_value=state):
                    with self.assertRaises(maintenance.MaintenanceError):
                        maintenance.cleanup_state(state, program)
                self.assertEqual(path.read_bytes(), original)
                self.assertEqual(notes.read_bytes(), b"user notes")
        self.fetch.assert_not_called()

    def test_uninstall_preserves_downloads_with_unique_suffixes_inside_data_components(self):
        program = self.root / "program"
        program.mkdir()
        for index, name in enumerate(("spinshare_abcdef-" + "c" * 32 + ".zip", "spinshare-download-123-" + "d" * 32 + ".zip")):
            with self.subTest(name=name):
                state = self.root / ("downloads-" + str(index))
                with maintenance.prepare_temp_directory(state) as temporary:
                    chart = temporary / name
                    chart.write_bytes(b"protected chart archive")
                with mock.patch.object(portable, "default_state_directory", return_value=state):
                    with self.assertRaises(maintenance.MaintenanceError):
                        maintenance.cleanup_state(state, program)
                self.assertEqual(chart.read_bytes(), b"protected chart archive")
        self.fetch.assert_not_called()

    def test_remote_transport_only_posts_search_charts_and_rejects_redirects(self):
        def connection_for(raw, status=200, length=None):
            response = mock.Mock(status=status)
            response.getheader.side_effect = lambda name: (str(len(raw)) if length is None else length) if name == "Content-Length" else "https://spinsha.re/api/song/101"
            response.read1.side_effect = io.BytesIO(raw).read1
            connection = mock.Mock(sock=None)
            connection.getresponse.return_value = response
            return connection
        raw = json.dumps({"status": 200, "data": ROWS}).encode()
        connection = connection_for(raw)
        with mock.patch.object(portable.http.client, "HTTPSConnection", return_value=connection) as factory:
            self.assertEqual(FETCH_CATALOG(), ROWS)
        factory.assert_called_once_with("spinsha.re", timeout=30)
        args, kwargs = connection.request.call_args
        self.assertEqual(args, ("POST", "/api/searchCharts"))
        query = json.loads(kwargs["body"])
        self.assertEqual(query, {"searchQuery": "", "diffEasy": True, "diffNormal": True, "diffHard": True,
            "diffExpert": True, "diffXD": True, "diffRatingFrom": 0, "diffRatingTo": 999, "showExplicit": True})
        connection.close.assert_called_once()
        for status, length in ((302, None), (200, str(portable.MAX_CHART_BYTES + 1)), (200, str(len(raw) + 1))):
            with self.subTest(status=status, length=length):
                connection = connection_for(raw, status, length)
                with mock.patch.object(portable.http.client, "HTTPSConnection", return_value=connection):
                    with self.assertRaises(portable.PortableError):
                        FETCH_CATALOG()
                connection.request.assert_called_once()
                self.assertEqual(connection.request.call_args.args[1], "/api/searchCharts")
                connection.close.assert_called_once()
        for raw in (b'{"status":200,"data":[{"bad":1e999}]}', b'{"status":200,"data":[{"bad":"\\ud800"}]}',
                    b'{"status":200,"data":[null]}', b'{"status":200,"status":200,"data":[]}', b'bad json'):
            with self.subTest(raw=raw):
                connection = connection_for(raw)
                with mock.patch.object(portable.http.client, "HTTPSConnection", return_value=connection):
                    with self.assertRaises((portable.PortableError, ValueError)):
                        FETCH_CATALOG()

    def test_local_endpoint_requires_auth_and_preserves_typed_queue_errors(self):
        with mock.patch.object(installer, "default_target_directory", return_value=self.root / "Custom"):
            app = portable.PortableApplication(self.root / "app-state")
        worker = threading.Thread(target=app.serve_forever, daemon=True)
        worker.start()
        self.assertTrue(app.started.wait(2))
        def stop():
            app.close()
            worker.join(3)
            self.assertTrue(app.manager.join(3))
            self.assertFalse(worker.is_alive())
        self.addCleanup(stop)
        def request(path="/v1/charts", method="GET", headers=None, body=None):
            values = {"Origin": app.origin, "X-SpinShare-Key": app.token, "Content-Type": "application/json",
                      "X-SpinShare-Settings": app.manager.revision}
            values.update(headers or {})
            connection = http.client.HTTPConnection("127.0.0.1", app.port, timeout=3)
            try:
                connection.request(method, path, body=body, headers=values)
                response = connection.getresponse()
                raw = response.read()
                return response.status, json.loads(raw) if raw else None
            finally:
                connection.close()
        self.assertEqual(request(headers={"X-SpinShare-Key": "0" * 64})[0], 403)
        self.assertEqual(request(headers={"Origin": "https://untrusted.example"})[0], 403)
        self.assertEqual(request("/v1/charts?force=1")[0], 400)
        self.assertEqual(request(method="OPTIONS", headers={"Access-Control-Request-Method": "GET"})[0], 204)
        self.fetch.assert_not_called()
        status, first = request()
        self.assertEqual(status, 200)
        self.assertEqual(first["data"], ROWS)
        self.assertFalse(first["cached"])
        self.assertTrue(request()[1]["cached"])
        self.assertEqual(request(method="POST", body="{}")[0], 404)
        self.fetch.assert_called_once()
        error = installer.InstallError("Queue full")
        error.code = "queue_full"
        with mock.patch.object(app.manager, "submit", side_effect=error):
            status, result = request("/v1/install", method="POST", body=json.dumps({"songId": 101, "requestId": "a" * 32}))
        self.assertEqual((status, result["code"]), (429, "queue_full"))


if __name__ == "__main__":
    if sys.argv[1:] == ["--cache-process"]:
        run_catalog_process_fixture(json.load(sys.stdin))
    else:
        unittest.main()
