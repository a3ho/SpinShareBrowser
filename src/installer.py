"""Download and install official SpinShare chart archives."""
from __future__ import annotations

import contextlib
import dataclasses
import email.message
import hashlib
import logging
import os
from pathlib import Path
import queue
import re
import secrets
import shutil
import stat
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

def known_folder_path(identifier):
    """Read a per-user Windows Known Folder without assuming a user name."""
    if os.name != "nt":
        raise OSError("Windows Known Folders are only available on Windows")
    import ctypes
    import uuid
    raw_guid = (ctypes.c_ubyte * 16).from_buffer_copy(uuid.UUID(identifier).bytes_le)
    shell32 = ctypes.WinDLL("shell32", use_last_error=True)
    ole32 = ctypes.WinDLL("ole32", use_last_error=True)
    shell32.SHGetKnownFolderPath.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p)]
    shell32.SHGetKnownFolderPath.restype = ctypes.c_long
    ole32.CoTaskMemFree.argtypes = [ctypes.c_void_p]
    location = ctypes.c_void_p()
    result = shell32.SHGetKnownFolderPath(ctypes.byref(raw_guid), 0x4000, None, ctypes.byref(location))
    if result != 0 or not location.value:
        raise OSError("Cannot resolve the current Windows user directory.")
    try:
        return Path(ctypes.wstring_at(location.value))
    finally:
        ole32.CoTaskMemFree(location)


def default_target_directory():
    if os.name == "nt":
        low = known_folder_path("A520A1A4-1780-4FF6-BD18-167343C5AF16")
    else:
        low = Path.home() / "AppData" / "LocalLow"
    return low / "Super Spin Digital" / "Spin Rhythm XD" / "Custom"


CHUNK_SIZE = 256 * 1024
ACTIVE_STATES = {"queued", "downloading", "validating", "extracting"}
MAX_ACTIVE_JOBS = 128  # Running plus waiting jobs, not download concurrency.
MAX_STORED_JOBS = MAX_ACTIVE_JOBS + 128  # Retain completed results while the queue is full.
DOWNLOAD_WORKERS = 2
MAX_READY_ARCHIVES = 2
JOB_TIMEOUT_SECONDS = 15 * 60
MAX_DOWNLOAD_CONNECTIONS = 4
_DOWNLOAD_CONNECTIONS = threading.BoundedSemaphore(MAX_DOWNLOAD_CONNECTIONS)


class InstallError(Exception):
    pass


class QueueFullError(InstallError):
    code = "queue_full"


class ChartChangedError(InstallError):
    """The chart stopped matching the version the caller authorized."""


class DeletePartialError(InstallError):
    """Deletion failed after at least one staged file could no longer be restored."""

    code = "delete_partial"


@dataclasses.dataclass(frozen=True)
class InstallLimits:
    max_archive_bytes: int = 512 * 1024 * 1024
    max_unpacked_bytes: int = 2 * 1024 * 1024 * 1024
    max_file_bytes: int = 512 * 1024 * 1024
    max_entries: int = 4096


DEFAULT_LIMITS = InstallLimits()
MAX_DELETE_AUDIO_FILES = DEFAULT_LIMITS.max_entries


def _deadline(deadline):
    if deadline is not None and time.monotonic() > deadline:
        raise InstallError("Installation exceeded 15 minutes.")


def _no_link(path):
    info = path.lstat()
    if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
        raise InstallError("The target contains a symbolic link or reparse point.")
    if stat.S_ISREG(info.st_mode) and info.st_nlink > 1:
        raise InstallError("The destination has hard links.")
    return info


def _root(directory):
    root = Path(os.path.abspath(os.fspath(directory)))
    if root == Path(root.anchor) or str(root).startswith("\\\\"):
        raise InstallError("The installation directory must be an ordinary local folder.")
    current = Path(root.anchor)
    for part in root.parts[1:]:
        current = current / part
        if not os.path.lexists(current):
            current.mkdir(exist_ok=True)
        if not stat.S_ISDIR(_no_link(current).st_mode):
            raise InstallError("An ancestor of the installation directory is not an ordinary folder.")
    if os.path.normcase(str(root.resolve())) != os.path.normcase(str(root)):
        raise InstallError("The installation directory resolves to another location.")
    return root


def _owned(root, path, *, directory=False):
    path = Path(os.path.abspath(os.fspath(path)))
    try:
        relative = path.relative_to(root)
    except ValueError as exc:
        raise InstallError("The archive or destination escapes the selected installation directory.") from exc
    if not relative.parts:
        raise InstallError("The installation root itself cannot be overwritten or deleted.")
    current = root
    _no_link(root)
    for index, part in enumerate(relative.parts):
        current = current / part
        if os.path.lexists(current):
            info = _no_link(current)
            want_directory = index < len(relative.parts) - 1 or directory
            if want_directory and not stat.S_ISDIR(info.st_mode):
                raise InstallError("The target has a file/directory conflict.")
            if not want_directory and not stat.S_ISREG(info.st_mode):
                raise InstallError("The destination is not an ordinary file.")
    if os.path.commonpath([os.path.normcase(str(root)), os.path.normcase(str(path.resolve()))]) != os.path.normcase(str(root)):
        raise InstallError("The destination resolves outside the installation directory.")
    return path


def _ensure_parent(root, path):
    parent = path.parent
    if parent == root:
        _no_link(root)
        return
    _owned(root, parent, directory=True)
    current = root
    for part in parent.relative_to(root).parts:
        current = current / part
        if not current.exists():
            current.mkdir()
        _no_link(current)


def _temporary(root, parent, prefix):
    if parent != root:
        _owned(root, parent, directory=True)
    _no_link(root)
    descriptor, name = tempfile.mkstemp(prefix=prefix, suffix=".tmp", dir=parent)
    path = _owned(root, name)
    return descriptor, path


def _replace(root, source, target):
    source, target = _owned(root, source), _owned(root, target)
    if target.exists() and not target.stat().st_mode & stat.S_IWRITE:
        target.chmod(stat.S_IREAD | stat.S_IWRITE)
    os.replace(source, target)


def _unlink(root, path):
    if not os.path.lexists(path):
        return
    path = _owned(root, path)
    if not path.stat().st_mode & stat.S_IWRITE:
        path.chmod(stat.S_IREAD | stat.S_IWRITE)
    path.unlink()


def _member_parts(name):
    if not name or "\\" in name or name.startswith("/") or "\x00" in name:
        raise InstallError("The ZIP contains an unsafe member path.")
    parts = name.rstrip("/").split("/")
    for part in parts:
        if (part in {"", ".", ".."} or part.endswith((" ", ".")) or
                any(ord(char) < 32 or char in '<>:"|?*' for char in part) or
                re.match(r"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)", part, re.I)):
            raise InstallError("The ZIP contains path traversal or an unsafe Windows filename.")
    return parts


def _archive_plan(archive, root, limits):
    infos = archive.infolist()
    if not infos or len(infos) > limits.max_entries:
        raise InstallError("The ZIP is empty or exceeds the member-count limit.")
    seen, files, charts, unpacked = set(), [], [], 0
    for info in infos:
        parts = _member_parts(info.filename)
        folded = "/".join(parts).casefold()
        if folded in seen:
            raise InstallError("The ZIP contains duplicate or case-colliding Windows paths.")
        seen.add(folded)
        kind = stat.S_IFMT(info.external_attr >> 16)
        if kind not in (0, stat.S_IFREG, stat.S_IFDIR) or info.flag_bits & 1 or info.external_attr & 0x400:
            raise InstallError("The ZIP contains links, special files, or encrypted members.")
        if info.is_dir():
            if parts not in (["AlbumArt"], ["AudioClips"]):
                raise InstallError("The ZIP contains directories outside the supported official chart structure.")
            _owned(root, root.joinpath(*parts), directory=True)
            continue
        if kind == stat.S_IFDIR:
            raise InstallError("A ZIP entry type does not match its path.")
        if info.file_size < 0 or info.file_size > limits.max_file_bytes:
            raise InstallError("A ZIP member exceeds the per-file size limit.")
        unpacked += info.file_size
        if unpacked > limits.max_unpacked_bytes:
            raise InstallError("The ZIP exceeds the total unpacked size limit.")
        if len(parts) == 1 and re.fullmatch(r"spinshare_[a-fA-F0-9]{1,64}\.srtb", parts[0]):
            charts.append(parts[0][:-5])
        target = _owned(root, root.joinpath(*parts))
        files.append((info, target, parts))
    if len(charts) != 1:
        raise InstallError("The ZIP must contain exactly one official root-level .srtb chart.")
    reference = re.escape(charts[0])
    for _, _, parts in files:
        name = "/".join(parts)
        allowed = (re.fullmatch(reference + r"\.srtb", name) or
                   re.fullmatch(r"AlbumArt/" + reference + r"\.png", name) or
                   re.fullmatch(r"AudioClips/" + reference + r"_[0-9]+\.(ogg|mp3)", name))
        if not allowed:
            raise InstallError("The ZIP contains unrelated files or an unsupported layout.")
    return files, unpacked


def _copy_member(archive, info, destination, deadline):
    written = 0
    with archive.open(info) as source:
        while True:
            _deadline(deadline)
            block = source.read(CHUNK_SIZE)
            if not block:
                break
            written += len(block)
            if written > info.file_size:
                raise InstallError("The actual unpacked size does not match the ZIP metadata.")
            if destination is not None:
                destination.write(block)
    if written != info.file_size:
        raise InstallError("A ZIP member is incomplete.")


def _rollback(root, records):
    errors = []
    for record in reversed(records):
        try:
            if record["backup"] is not None:
                _replace(root, record["backup"], record["target"])
                if record["old_mode"] is not None:
                    record["target"].chmod(record["old_mode"])
                record["backup"] = None
            elif record["committed"]:
                _unlink(root, record["target"])
            _unlink(root, record["temp"])
        except (OSError, InstallError) as exc:
            errors.append(str(exc))
    return errors


def _staged_chart_digest(root, path, max_chart_bytes):
    try:
        path = _owned(root, path)
        before = _no_link(path)
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_BINARY", 0) |
                             getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(descriptor, "rb") as stream:
            info = os.fstat(stream.fileno())
            if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or
                    (info.st_dev, info.st_ino) != (before.st_dev, before.st_ino) or
                    info.st_size > max_chart_bytes):
                raise ChartChangedError("The installed chart no longer matches this version.")
            digest = hashlib.md5(usedforsecurity=False)
            remaining = max_chart_bytes + 1
            while remaining:
                block = stream.read(min(CHUNK_SIZE, remaining))
                if not block:
                    break
                digest.update(block)
                remaining -= len(block)
        if not remaining:
            raise ChartChangedError("The installed chart no longer matches this version.")
        return digest.hexdigest()
    except ChartChangedError:
        raise
    except (OSError, InstallError) as exc:
        raise ChartChangedError("The installed chart no longer matches this version.") from exc


def delete_chart_files(target_dir, file_reference, expected_hash, *, max_chart_bytes=32 * 1024 * 1024):
    """Delete one installed official chart and its directly owned resources."""
    if (not isinstance(file_reference, str) or
            not re.fullmatch(r"spinshare_[a-fA-F0-9]{1,64}", file_reference) or
            not isinstance(expected_hash, str) or not re.fullmatch(r"[a-fA-F0-9]{32}", expected_hash) or
            type(max_chart_bytes) is not int or not 0 < max_chart_bytes <= DEFAULT_LIMITS.max_file_bytes):
        raise InstallError("Invalid official chart file reference.")
    root = _root(target_dir)
    try:
        chart = _owned(root, root / (file_reference + ".srtb"))
        if not os.path.lexists(chart):
            raise FileNotFoundError(str(chart))
    except (OSError, InstallError) as exc:
        raise ChartChangedError("The installed chart no longer exists.") from exc

    # Move the chart first, then verify the staged bytes. This closes the gap
    # between the API's presence check and the filesystem mutation: a chart
    # edited after the click is restored instead of being deleted.
    targets = [chart]
    cover = root / "AlbumArt" / (file_reference + ".png")
    if os.path.lexists(cover):
        targets.append(_owned(root, cover))
    audio_dir = root / "AudioClips"
    if os.path.lexists(audio_dir):
        audio_dir = _owned(root, audio_dir, directory=True)
        pattern = re.compile(re.escape(file_reference) + r"_[0-9]+\.(?:ogg|mp3)", re.I)
        audio = {}
        for path in audio_dir.iterdir():
            if not pattern.fullmatch(path.name):
                continue
            folded = path.name.casefold()
            if folded in audio:
                raise InstallError("Matching audio files collide by Windows filename rules.")
            if len(audio) >= MAX_DELETE_AUDIO_FILES:
                raise InstallError("The chart has too many matching audio files to delete safely.")
            audio[folded] = _owned(root, path)
        targets.extend(audio[name] for name in sorted(audio))

    staged = []
    try:
        for index, target in enumerate(targets):
            descriptor, backup = _temporary(root, target.parent, ".spinshare-delete-")
            os.close(descriptor)
            try:
                _replace(root, target, backup)
            except Exception as exc:
                with contextlib.suppress(OSError, InstallError):
                    _unlink(root, backup)
                if index == 0 and isinstance(exc, (FileNotFoundError, InstallError)):
                    raise ChartChangedError("The installed chart no longer matches this version.") from exc
                raise
            staged.append((target, backup))
            if index == 0:
                digest = _staged_chart_digest(root, backup, max_chart_bytes)
                if not secrets.compare_digest(digest, expected_hash.lower()):
                    raise ChartChangedError("The installed chart no longer matches this version.")
    except Exception as exc:
        rollback_errors = []
        for target, backup in reversed(staged):
            try:
                _replace(root, backup, target)
            except (OSError, InstallError) as rollback_exc:
                rollback_errors.append(str(rollback_exc))
        if rollback_errors:
            raise DeletePartialError("Chart deletion failed and some files could not be restored; check for files locked by the game.") from exc
        if isinstance(exc, ChartChangedError):
            raise
        raise InstallError("Chart deletion failed; original files were restored.") from exc

    # Keep the chart backup until every resource is gone. If cleanup fails,
    # the installation-status file is therefore the first thing restored.
    cleanup = [*staged[1:], staged[0]]
    for index, (_, backup) in enumerate(cleanup):
        try:
            _unlink(root, backup)
        except (OSError, InstallError) as exc:
            complete = index == 0
            for target, remaining in reversed(cleanup[index:]):
                if not os.path.lexists(remaining):
                    complete = False
                    continue
                try:
                    _replace(root, remaining, target)
                except (OSError, InstallError):
                    complete = False
            if complete:
                raise InstallError("Chart deletion cleanup failed; original files were restored.") from exc
            raise DeletePartialError("Chart deletion cleanup failed and some files could not be restored.") from exc
    return {"filesDeleted": len(staged)}


def install_archive(zip_path, target_dir, report=lambda update: None, limits=DEFAULT_LIMITS, deadline=None):
    root = _root(target_dir)
    zip_path = _owned(root, zip_path)
    if not zip_path.is_file() or zip_path.stat().st_size > limits.max_archive_bytes:
        raise InstallError("The ZIP is missing or exceeds the archive size limit.")
    records, overwritten, written = [], 0, 0
    try:
        with zipfile.ZipFile(zip_path) as archive:
            files, unpacked = _archive_plan(archive, root, limits)
            report({"state": "validating", "message": "Checking ZIP contents.", "fileCount": len(files)})
            if shutil.disk_usage(root).free < unpacked:
                raise InstallError("The target disk has insufficient free space.")
            # Staging verifies every member's CRC before the replacement loop below.
            report({"state": "extracting", "message": "Extracting chart files."})
            for info, target, _ in files:
                _deadline(deadline)
                _ensure_parent(root, target)
                descriptor, temp = _temporary(root, target.parent, ".spinshare-stage-")
                record = {"target": target, "temp": temp, "backup": None, "old_mode": None, "committed": False}
                records.append(record)
                with os.fdopen(descriptor, "wb") as destination:
                    _copy_member(archive, info, destination, deadline)
                    destination.flush()
                    os.fsync(destination.fileno())
        # All bytes and CRCs are checked before any old payload is replaced.
        for record in records:
            target = _owned(root, record["target"])
            if target.exists():
                record["old_mode"] = target.stat().st_mode
                descriptor, backup = _temporary(root, target.parent, ".spinshare-rollback-")
                os.close(descriptor)
                try:
                    _replace(root, target, backup)
                except Exception:
                    _unlink(root, backup)
                    raise
                record["backup"] = backup
                overwritten += 1
            _replace(root, record["temp"], target)
            record["committed"] = True
            written += 1
            report({"state": "extracting", "message": "Replacing installed chart files.", "filesWritten": written})
    except Exception as exc:
        rollback_errors = _rollback(root, records)
        if rollback_errors:
            raise InstallError("Installation failed and some originals could not be restored. The ZIP and recovery files were retained; check for files locked by the game.") from exc
        report({"filesWritten": 0})
        message = str(exc) if isinstance(exc, InstallError) else "The ZIP is corrupt or a file write failed: " + str(exc)
        raise InstallError(message + " Original files are intact; the ZIP was retained.") from exc
    try:
        for record in records:
            if record["backup"] is not None:
                _unlink(root, record["backup"])
        _unlink(root, zip_path)
    except (OSError, InstallError) as exc:
        raise InstallError("Extraction completed, but cleanup failed. Check for locked ZIP or recovery files.") from exc
    return {"filesWritten": written, "overwrittenFiles": overwritten, "fileCount": len(records), "zipRemoved": True}


@contextlib.contextmanager
def _download_connection(deadline):
    remaining = None if deadline is None else max(0, deadline - time.monotonic())
    if not _DOWNLOAD_CONNECTIONS.acquire(timeout=remaining):
        raise InstallError("Installation exceeded 15 minutes.")
    try:
        _deadline(deadline)
        yield
    except urllib.error.HTTPError as exc:
        exc.close()
        raise
    finally:
        _DOWNLOAD_CONNECTIONS.release()


class OfficialRedirects(urllib.request.HTTPRedirectHandler):
    max_redirections = 3

    def redirect_request(self, request, file_pointer, code, message, headers, new_url):
        parsed = urllib.parse.urlsplit(new_url)
        if (parsed.scheme != "https" or parsed.hostname not in {"spinsha.re", "spinshare.b-cdn.net"} or
                parsed.port not in (None, 443) or parsed.username is not None or parsed.password is not None):
            file_pointer.close()
            raise InstallError("The download redirected to an unapproved location.")
        return super().redirect_request(request, file_pointer, code, message, headers, new_url)


def download_archive(song_id, target_dir, report, limits=DEFAULT_LIMITS, deadline=None, *, unique_name=False):
    if type(song_id) is not int or not 0 < song_id <= 9007199254740991:
        raise InstallError("Invalid chart ID.")
    root = _root(target_dir)
    opener = urllib.request.build_opener(OfficialRedirects())
    request = urllib.request.Request(
        "https://spinsha.re/api/song/" + str(song_id) + "/download",
        headers={"User-Agent": "SpinShareBrowser/2.0.0", "Cache-Control": "no-store", "Pragma": "no-cache", "Accept": "application/zip"},
    )
    temp = None
    try:
        # The counting API is contacted exactly once; it currently streams a full ZIP.
        with _download_connection(deadline), opener.open(request, timeout=30) as response:
            if response.getcode() != 200:
                raise InstallError("The official server did not provide a download; HTTP " + str(response.getcode()) + ".")
            content_type = response.headers.get("Content-Type", "").split(";")[0].strip().lower()
            if content_type not in {"application/zip", "application/x-zip-compressed", "application/octet-stream"}:
                raise InstallError("The official server returned no ZIP. Open the chart on SpinShare for details.")
            length = response.headers.get("Content-Length")
            total = int(length) if length and length.isdigit() else None
            if total is not None and (total <= 0 or total > limits.max_archive_bytes):
                raise InstallError("The official download is empty or exceeds the 512 MiB size limit.")
            disposition = email.message.Message()
            disposition["Content-Disposition"] = response.headers.get("Content-Disposition", "")
            name = disposition.get_filename() or ""
            if not re.fullmatch(r"spinshare_[a-fA-F0-9]{1,64}\.zip", name):
                name = "spinshare-download-" + str(song_id) + ".zip"
            if unique_name:
                name = Path(name).stem + "-" + secrets.token_hex(16) + ".zip"
            destination = _owned(root, root / name)
            descriptor, temp = _temporary(root, root, ".spinshare-download-")
            received, last_report = 0, 0
            report({"state": "downloading", "message": "Downloading the official ZIP.", "downloadedBytes": 0, "totalBytes": total, "zipName": name})
            with os.fdopen(descriptor, "wb") as output:
                # Read available bytes so a trickling response cannot hide the deadline while filling a chunk.
                read = getattr(response, "read1", response.read)
                while True:
                    _deadline(deadline)
                    block = read(CHUNK_SIZE)
                    _deadline(deadline)
                    if not block:
                        break
                    received += len(block)
                    if received > limits.max_archive_bytes or total is not None and received > total:
                        raise InstallError("The actual download exceeds its declared size or the safety limit.")
                    output.write(block)
                    if time.monotonic() - last_report >= 0.2:
                        report({"downloadedBytes": received})
                        last_report = time.monotonic()
                output.flush()
                os.fsync(output.fileno())
            if not received or total is not None and received != total:
                raise InstallError("The ZIP download is incomplete.")
            if not zipfile.is_zipfile(temp):
                raise InstallError("The official response is not a valid ZIP.")
            _replace(root, temp, destination)
            temp = None
            report({"downloadedBytes": received})
            return destination
    except urllib.error.HTTPError as exc:
        raise InstallError("The official download failed; HTTP " + str(exc.code) + ".") from exc
    except (urllib.error.URLError, TimeoutError) as exc:
        raise InstallError("The download connection failed or timed out.") from exc
    finally:
        if temp is not None:
            _unlink(root, temp)


def install_song(song_id, target_dir, report):
    deadline = time.monotonic() + 15 * 60
    archive = download_archive(song_id, target_dir, report, deadline=deadline)
    return install_archive(archive, target_dir, report, deadline=deadline)


class JobManager:
    def __init__(self, target_dir):
        self.target_dir = Path(os.path.abspath(os.fspath(target_dir)))
        self.lock = threading.RLock()
        self.jobs = {}
        self.requests = {}
        self.work = queue.Queue()
        self.ready = queue.Queue(maxsize=MAX_READY_ARCHIVES)
        # Reserve space before downloading, including ZIPs waiting to be installed.
        self._prefetch_slots = threading.BoundedSemaphore(MAX_READY_ARCHIVES)
        self.closed = False
        # Keep the old worker attribute; only this thread may replace or roll back files.
        self.worker = threading.Thread(target=self._run, name="SpinShareInstaller", daemon=True)
        self.download_workers = tuple(
            threading.Thread(target=self._download, name=f"SpinShareDownload-{index + 1}", daemon=True)
            for index in range(DOWNLOAD_WORKERS)
        )
        self.workers = (*self.download_workers, self.worker)
        self.worker.start()
        for worker in self.download_workers:
            worker.start()

    def submit(self, song_id, request_id):
        if type(song_id) is not int or not 0 < song_id <= 9007199254740991:
            raise InstallError("The chart ID must be a positive integer.")
        if not isinstance(request_id, str) or not re.fullmatch(r"[a-f0-9]{32}", request_id):
            raise InstallError("Invalid installation request ID.")
        with self.lock:
            if self.closed:
                raise InstallError("The installer is exiting. Reopen SpinShareBrowser.exe.")
            if request_id in self.requests:
                existing = self.jobs[self.requests[request_id]]
                if existing["songId"] != song_id:
                    raise InstallError("The same request ID cannot be used for different charts.")
                return dict(existing)
            for job in self.jobs.values():
                if job["songId"] == song_id and job["state"] in ACTIVE_STATES:
                    self.requests[request_id] = job["id"]
                    return dict(job)
            if self.active_count() >= MAX_ACTIVE_JOBS:
                raise QueueFullError(f"The install queue is full ({MAX_ACTIVE_JOBS} tasks). Wait for a task to finish.")
            identifier = secrets.token_hex(16)
            job = {
                "id": identifier, "songId": song_id, "state": "queued",
                "message": "Queued for installation.", "downloadedBytes": 0,
                "totalBytes": None, "fileCount": 0, "filesWritten": 0,
                "overwrittenFiles": 0, "zipRemoved": False,
                "targetDirectory": str(self.target_dir),
            }
            self.jobs[identifier] = job
            self.requests[request_id] = identifier
            if len(self.jobs) > MAX_STORED_JOBS:
                for old_id in list(self.jobs):
                    if len(self.jobs) <= MAX_STORED_JOBS:
                        break
                    if self.jobs[old_id]["state"] not in ACTIVE_STATES:
                        del self.jobs[old_id]
                self.requests = {key: value for key, value in self.requests.items() if value in self.jobs}
            self.work.put(identifier)
            return dict(job)

    def get(self, identifier):
        with self.lock:
            job = self.jobs.get(identifier)
            return dict(job) if job is not None else None

    def active_count(self):
        with self.lock:
            return sum(job["state"] in ACTIVE_STATES for job in self.jobs.values())

    def close_if_idle(self):
        with self.lock:
            if self.active_count():
                return False
            if not self.closed:
                self.closed = True
                for _ in self.download_workers:
                    self.work.put(None)
                self.ready.put(None)
            return True

    def join(self, timeout=None):
        """Join every pipeline thread after close_if_idle succeeds."""
        deadline = None if timeout is None else time.monotonic() + max(0, timeout)
        for worker in self.workers:
            worker.join(None if deadline is None else max(0, deadline - time.monotonic()))
        return not any(worker.is_alive() for worker in self.workers)

    def _report(self, identifier, update):
        allowed = {"state", "message", "downloadedBytes", "totalBytes", "fileCount", "filesWritten", "zipName"}
        with self.lock:
            self.jobs[identifier].update({key: value for key, value in update.items() if key in allowed})

    def _failed(self, identifier, exc):
        message = str(exc) if isinstance(exc, InstallError) else "Installation failed: " + str(exc)
        with self.lock:
            self.jobs[identifier].update({"state": "error", "message": message})
        logging.warning("An installation failed: %s", type(exc).__name__)

    def _download(self):
        while True:
            identifier = self.work.get()
            if identifier is None:
                self.work.task_done()
                return
            self._prefetch_slots.acquire()
            handed_off = False
            try:
                with self.lock:
                    song_id = self.jobs[identifier]["songId"]
                    target_dir = Path(self.jobs[identifier]["targetDirectory"])
                report = lambda update, job_id=identifier: self._report(job_id, update)
                report({"state": "downloading", "message": "Downloading the official ZIP."})
                deadline = time.monotonic() + JOB_TIMEOUT_SECONDS
                archive = download_archive(song_id, target_dir, report, deadline=deadline, unique_name=True)
                # Waiting for the serial installer does not consume the execution budget.
                remaining = max(0, deadline - time.monotonic())
                report({"state": "validating", "message": "Downloaded; waiting for installation."})
                self.ready.put((identifier, archive, target_dir, remaining))
                handed_off = True
            except Exception as exc:
                self._failed(identifier, exc)
            finally:
                if not handed_off:
                    self._prefetch_slots.release()
                    self.work.task_done()

    def _run(self):
        while True:
            item = self.ready.get()
            if item is None:
                self.ready.task_done()
                return
            identifier, archive, target_dir, remaining = item
            self._prefetch_slots.release()
            try:
                report = lambda update, job_id=identifier: self._report(job_id, update)
                result = install_archive(archive, target_dir, report, deadline=time.monotonic() + remaining)
                if result.get("zipRemoved") is not True:
                    raise InstallError("Installation did not finish.")
                with self.lock:
                    self.jobs[identifier].update({
                        key: result[key] for key in ("filesWritten", "overwrittenFiles", "fileCount", "zipRemoved") if key in result
                    })
                    self.jobs[identifier].update({"state": "complete", "message": "Installed; matching files replaced and ZIP deleted."})
            except Exception as exc:
                self._failed(identifier, exc)
            finally:
                self.ready.task_done()
                self.work.task_done()
