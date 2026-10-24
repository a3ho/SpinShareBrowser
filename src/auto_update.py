"""Chart auto-update: bring installed charts to the cloud's latest version.

Semantics (owner ruling 2026-10-24, recorded as a red-line 1 amendment):
the auto-update switch is a standing, explicit download authorization for the
charts it manages. After every catalog sync, each installed .srtb is compared
with the catalog's current update hash:

- local hash == catalog hash        -> up to date; baseline refreshed.
- differs, baseline == local hash   -> untouched since the last known cloud
                                       version; the cloud moved -> reinstall
                                       through the normal transactional queue.
- differs, baseline != local hash   -> the file changed locally after install
                                       (user modification) -> never touched.
- differs, no baseline              -> unknown provenance. Pre-feature installs
                                       are the common case, so the first pass
                                       follows the owner's literal rule
                                       ("local != cloud -> make local = cloud")
                                       and the baseline makes later passes
                                       precise.
Charts missing from the catalog (removed upstream) are never touched.

The baseline (update-baseline.json, state dir) maps fileReference -> the
catalog hash the local file was last known to match.
"""

from __future__ import annotations

import hashlib
import hmac
import re
import threading
from pathlib import Path

MAX_BASELINE_ENTRIES = 4096


def load_baseline(state_dir, portable) -> dict:
    path = Path(state_dir) / portable.UPDATE_BASELINE_NAME
    try:
        raw = path.read_bytes()
    except OSError:
        return {}
    try:
        data = portable._parse_json(raw)
    except ValueError:
        return {}
    if not isinstance(data, dict) or len(data) > MAX_BASELINE_ENTRIES:
        return {}
    baseline = {}
    for reference, digest in data.items():
        if (isinstance(reference, str) and re.fullmatch(r"spinshare_[a-f0-9]{1,64}", reference)
                and isinstance(digest, str) and re.fullmatch(r"[a-f0-9]{32}", digest)):
            baseline[reference] = digest
    return baseline


def save_baseline(state_dir, portable, baseline: dict) -> None:
    path = Path(state_dir) / portable.UPDATE_BASELINE_NAME
    portable._atomic_write(path, portable._json_bytes(baseline))


def scan_installed_charts(target_dir, portable) -> dict:
    """Return {fileReference: md5} for installed .srtb files."""
    installed = {}
    with portable._directory_guard(target_dir):
        for path in sorted(target_dir.iterdir()):
            match = re.fullmatch(r"(spinshare_[a-f0-9]{1,64})\.srtb", path.name, re.I)
            if not match:
                continue
            try:
                raw = portable._read_bytes(path, limit=portable.MAX_CHART_BYTES)
                raw.decode("utf-8")
            except (OSError, portable.PortableError, UnicodeError):
                continue
            installed[match[1].lower()] = hashlib.md5(raw, usedforsecurity=False).hexdigest()
    return installed


def plan_auto_update(catalog_rows, installed, baseline):
    """Decide what to reinstall. Returns (to_update_song_ids, next_baseline).

    catalog_rows: [(songId, fileReference, catalogUpdateHash)].
    """
    catalog_by_reference = {reference: (song_id, catalog_hash)
                            for song_id, reference, catalog_hash in catalog_rows or []}
    to_update = []
    next_baseline = dict(baseline)
    for reference, local_hash in installed.items():
        entry = catalog_by_reference.get(reference)
        if entry is None:
            # Removed upstream: keep the local chart, keep the baseline entry.
            continue
        song_id, catalog_hash = entry
        if hmac.compare_digest(local_hash, catalog_hash):
            next_baseline[reference] = catalog_hash
            continue
        known = baseline.get(reference)
        if known is None or hmac.compare_digest(known, local_hash):
            # Either first sighting (pre-feature install: owner's literal rule)
            # or untouched file with a moved cloud -> update to latest.
            to_update.append(song_id)
        # A locally modified file (baseline != local hash) is never touched.
    for reference in list(next_baseline):
        if reference not in installed and reference not in catalog_by_reference:
            del next_baseline[reference]
    return to_update, next_baseline


def run_auto_update_pass(manager, chart_cache) -> dict:
    """One auto-update pass over the current catalog and install directory."""
    import spinshare_portable as portable

    if not manager.config.get("autoUpdateCharts"):
        return {"enabled": False, "updated": 0}
    with manager.lock:
        if manager.closed or manager.exiting or manager.active_count():
            return {"enabled": True, "updated": 0, "deferred": True}
        target = manager.target_dir
        state_dir = manager.store.directory
    try:
        catalog = chart_cache.status(include_data=True).get("data") or []
    except Exception:
        return {"enabled": True, "updated": 0, "deferred": True}
    catalog_rows = []
    for song in catalog:
        if not isinstance(song, dict) or not isinstance(song.get("id"), int):
            continue
        reference = str(song.get("fileReference") or "")
        update_hash = str(song.get("updateHash") or "").lower()
        if not re.fullmatch(r"spinshare_[a-f0-9]{1,64}", reference) or not re.fullmatch(r"[a-f0-9]{32}", update_hash):
            continue
        catalog_rows.append((song["id"], reference, update_hash))
    installed = scan_installed_charts(target, portable)
    baseline = load_baseline(state_dir, portable)
    to_update, next_baseline = plan_auto_update(catalog_rows, installed, baseline)
    save_baseline(state_dir, portable, next_baseline)
    submitted = 0
    for song_id in to_update:
        try:
            manager.submit(song_id, portable.secrets.token_hex(16))
            submitted += 1
        except portable.installer.InstallError:
            break
    return {"enabled": True, "updated": submitted, "considered": len(installed)}
