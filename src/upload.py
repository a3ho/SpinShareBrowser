"""Chart upload and own-chart management over the spinsha.re session channel.

Production form verified 2026-10-24 (GET /upload, multipart, CSRF form[_token]):
  form[backupPath] (.zip, required for upload, OPTIONAL for update),
  form[tags] (text), form[description], form[dlc] (0 None / 1 Supporter Pack /
  2 Monstercat DLC / 3 Chillhop DLC), form[publicationStatus] (0 Public /
  1 Hide from lists / 2 Unlisted), form[isExplicit] (checkbox, value 1),
  form[save], form[_token].
Update lives at GET /song/{id}/update (own charts only); delete at
GET /song/{id}/delete. Success on both redirects to the song page — a form
re-render means the server rejected the payload.

Uploads stream the local zip into the multipart body; the local file never
enters JSON. Uploads are verified by a before/after diff of the user's public
chart list.
"""

from __future__ import annotations

import os
import re

import session_client

SITE = session_client.SITE_ORIGIN
MAX_ZIP_BYTES = 512 * 1024 * 1024
DLC_VALUES = {"none": 0, "supporter": 1, "monstercat": 2, "chillhop": 3}
PUBLICATION_VALUES = {"public": 0, "hidden": 1, "unlisted": 2}


class UploadError(session_client.SessionError):
    """An upload operation failed (message is safe to show and log)."""


def _identity() -> int:
    summary = session_client.status_summary()
    if not summary.get("connected") or not summary.get("userId"):
        raise UploadError("session_disconnected")
    return summary["userId"]


def _client() -> session_client.SpinShareWeb:
    try:
        return session_client.web_client()
    except session_client.NotConnected as exc:
        raise UploadError("session_disconnected") from exc


def _my_chart_ids(client: session_client.SpinShareWeb, user_id: int) -> set[int]:
    final_url, body = client.get(SITE + "/api/user/" + str(user_id) + "/charts", timeout=30.0)
    session_client.ensure_session_usable(final_url, body)
    import json
    try:
        envelope = json.loads(body)
    except ValueError as exc:
        raise UploadError("invalid_response") from exc
    if not isinstance(envelope, dict) or envelope.get("status") != 200 or not isinstance(envelope.get("data"), list):
        raise UploadError("api_error")
    return {entry["id"] for entry in envelope["data"]
            if isinstance(entry, dict) and isinstance(entry.get("id"), int)}


def _form_options(html: str) -> dict:
    options = {}
    for name, key in (("dlc", "dlc"), ("publicationStatus", "publication")):
        match = re.search(r'<select[^>]*name="form\[' + name + r']"[^>]*>(.*?)</select>', html, re.S)
        entries = []
        if match:
            for value, label in re.findall(r'<option value="(\d+)"[^>]*>([^<]*)</option>', match.group(1)):
                entries.append({"value": int(value), "label": label.strip()})
        options[key] = entries
    return options


def upload_options() -> dict:
    """DLC and publication options as rendered by the upload page."""
    client = _client()
    final_url, html = client.get(SITE + "/upload")
    session_client.ensure_session_usable(final_url, html)
    return _form_options(html)


def _validate_common(description, tags, dlc, publication_status, is_explicit):
    description = (description or "").strip()
    if len(description) > 4000:
        raise UploadError("invalid_description")
    tags = (tags or "").strip()
    if len(tags) > 200:
        raise UploadError("invalid_tags")
    if dlc not in DLC_VALUES.values():
        raise UploadError("invalid_dlc")
    if publication_status not in PUBLICATION_VALUES.values():
        raise UploadError("invalid_publication")
    if not isinstance(is_explicit, bool):
        raise UploadError("invalid_explicit")
    return description, tags


def upload_chart(backup_path: str, description: str, tags: str, dlc: int,
                 publication_status: int, is_explicit: bool) -> dict:
    """Upload a new chart from a local SRXD backup zip; verified by chart diff."""
    backup_path = str(backup_path or "")
    description, tags = _validate_common(description, tags, dlc, publication_status, is_explicit)
    if not os.path.isfile(backup_path) or not backup_path.lower().endswith(".zip"):
        raise UploadError("invalid_backup")
    size = os.path.getsize(backup_path)
    if size <= 0 or size > MAX_ZIP_BYTES:
        raise UploadError("invalid_backup")

    def operation() -> dict:
        client = _client()
        user_id = _identity()
        before = _my_chart_ids(client, user_id)
        final_url, html = client.get(SITE + "/upload")
        session_client.ensure_session_usable(final_url, html)
        token = session_client.parse_csrf_token(html)
        if not token:
            raise UploadError("csrf_missing")
        with open(backup_path, "rb") as handle:
            zip_bytes = handle.read()
        final_url, html = client.post_multipart(
            SITE + "/upload",
            {"form[tags]": tags, "form[description]": description, "form[dlc]": str(dlc),
             "form[publicationStatus]": str(publication_status),
             "form[isExplicit]": "1" if is_explicit else "", "form[save]": "", "form[_token]": token},
            [("form[backupPath]", os.path.basename(backup_path), zip_bytes, "application/zip")],
            timeout=600.0)
        session_client.ensure_session_usable(final_url, html)
        after = _my_chart_ids(client, user_id)
        created = after - before
        if len(created) != 1:
            raise UploadError("upload_rejected")
        return {"songId": created.pop()}

    return session_client.submit_write(operation, "chart-upload")


def update_chart(song_id: int, description: str, tags: str, dlc: int,
                 publication_status: int, is_explicit: bool) -> dict:
    """Update one of the caller's own charts (metadata; no zip replacement)."""
    song_id = int(song_id)
    description, tags = _validate_common(description, tags, dlc, publication_status, is_explicit)

    def operation() -> dict:
        client = _client()
        user_id = _identity()
        if song_id not in _my_chart_ids(client, user_id):
            raise UploadError("chart_not_found")
        final_url, html = client.get(SITE + "/song/" + str(song_id) + "/update")
        session_client.ensure_session_usable(final_url, html)
        token = session_client.parse_csrf_token(html)
        if not token:
            raise UploadError("csrf_missing")
        final_url, html = client.post_multipart(
            SITE + "/song/" + str(song_id) + "/update",
            {"form[tags]": tags, "form[description]": description, "form[dlc]": str(dlc),
             "form[publicationStatus]": str(publication_status),
             "form[isExplicit]": "1" if is_explicit else "", "form[save]": "", "form[_token]": token},
            [], timeout=120.0)
        session_client.ensure_session_usable(final_url, html)
        if not re.search(r"/song/" + str(song_id) + r"(?:[/?#]|$)", final_url or ""):
            raise UploadError("update_rejected")
        return {"songId": song_id}

    return session_client.submit_write(operation, "chart-update")


def delete_chart(song_id: int) -> None:
    """Delete one of the caller's own charts; verified by chart diff."""
    song_id = int(song_id)

    def operation() -> None:
        client = _client()
        user_id = _identity()
        if song_id not in _my_chart_ids(client, user_id):
            raise UploadError("chart_not_found")
        final_url, html = client.get(SITE + "/song/" + str(song_id) + "/delete")
        session_client.ensure_session_usable(final_url, html)
        if song_id in _my_chart_ids(client, user_id):
            raise UploadError("delete_unverified")

    session_client.submit_write(operation, "chart-delete")
