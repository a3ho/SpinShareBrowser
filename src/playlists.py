"""Playlist operations over the spinsha.re session channel.

All shapes and routes verified against PRODUCTION on 2026-10-24 (the
open-source mirror is out of sync — see spec/backend/session-client.md):
- GET /api/user/{id}/playlists   → [{id,title,songs:<count>,cover,...}]
- GET /api/playlist/{id}         → full detail, songs = complete song array
- POST /playlist/create          → multipart form[title|description|coverPath|save|_token],
                                   cover REQUIRED (production marks it required and the
                                   server silently no-ops without it)
- GET /playlist/{id}/delete      → no CSRF, immediate
- POST /song/{id}                → replace-set membership via playlist_{index} checkboxes
                                   (indexes are positions in the user's playlist order);
                                   entering that route costs views+1 regardless
- GET /playlist/{id}/song/{songId}/delete → remove one song, no view cost

Writes go through the serial spaced queue in session_client and are only
invoked by explicit user actions (red line 1 exception, 2026-10-23). Reads of
public APIs are uncounted and safe. Verification is diff-based: the state is
read before and after each write and must match the intended change exactly,
otherwise a conflict error asks the caller to refresh — never a blind retry.
"""

from __future__ import annotations

import json
import re
import struct
import zlib

import session_client

SITE = session_client.SITE_ORIGIN


class PlaylistError(session_client.SessionError):
    """A playlist operation failed (message is safe to show and log)."""


class PlaylistConflict(PlaylistError):
    """The server state changed under us; the caller should refresh."""


def _identity() -> tuple[int, str]:
    summary = session_client.status_summary()
    if not summary.get("connected") or not summary.get("userId"):
        raise PlaylistError("session_disconnected")
    return summary["userId"], summary["username"] or ""


def _client() -> session_client.SpinShareWeb:
    try:
        return session_client.web_client()
    except session_client.NotConnected as exc:
        raise PlaylistError("session_disconnected") from exc


def _api_list(client: session_client.SpinShareWeb, url: str) -> list:
    final_url, body = client.get(url, timeout=30.0)
    try:
        envelope = json.loads(body)
    except ValueError as exc:
        raise PlaylistError("invalid_response") from exc
    if not isinstance(envelope, dict) or envelope.get("status") != 200 or not isinstance(envelope.get("data"), list):
        raise PlaylistError("api_error")
    return envelope["data"]


def my_playlists(user_id: int) -> list[dict]:
    """The user's playlists (public API, uncounted). Order == server checkbox order."""
    entries = _api_list(_client(), SITE + "/api/user/" + str(int(user_id)) + "/playlists")
    playlists = []
    for entry in entries:
        if isinstance(entry, dict) and isinstance(entry.get("id"), int) and isinstance(entry.get("title"), str):
            playlists.append({"id": entry["id"], "title": entry["title"],
                              "songs": entry["songs"] if isinstance(entry.get("songs"), int) else 0,
                              "cover": entry["cover"] if isinstance(entry.get("cover"), str) else None})
    return playlists


def playlist_detail(playlist_id: int) -> dict:
    """One playlist with its song ids (public API, uncounted)."""
    client = _client()
    final_url, body = client.get(SITE + "/api/playlist/" + str(int(playlist_id)), timeout=30.0)
    try:
        envelope = json.loads(body)
    except ValueError as exc:
        raise PlaylistError("invalid_response") from exc
    if not isinstance(envelope, dict) or envelope.get("status") != 200 or not isinstance(envelope.get("data"), dict):
        raise PlaylistError("api_error")
    data = envelope["data"]
    songs = [song["id"] for song in data.get("songs") or []
             if isinstance(song, dict) and isinstance(song.get("id"), int)]
    return {"id": data.get("id"), "title": data.get("title"),
            "description": data.get("description"), "songIds": songs}


def song_membership(playlists: list[dict], song_id: int) -> set[int]:
    """Which of the given playlists contain the song (fresh read, uncounted)."""
    member = set()
    for entry in playlists:
        if song_id in playlist_detail(entry["id"])["songIds"]:
            member.add(entry["id"])
    return member


def default_cover_png(size: int = 512) -> bytes:
    """A brand-language placeholder cover: graphite diagonal into magenta."""
    width = height = int(size)
    rows = []
    for y in range(height):
        row = bytearray([0])
        for x in range(width):
            t = (x + y) / (2.0 * width)
            row += bytes((int(16 + (235 - 16) * t), int(17 + (91 - 17) * t), int(20 + (161 - 20) * t)))
        rows.append(bytes(row))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + tag + data +
                struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) +
            chunk(b"IDAT", zlib.compress(b"".join(rows), 9)) + chunk(b"IEND", b""))


def create_playlist(title: str, description: str = "") -> dict:
    """Create a playlist with a generated cover; verified by before/after diff.

    Runs on the write queue. The cover is mandatory on production: without an
    uploaded file the server re-renders the form and creates nothing.
    """
    title = title.strip()
    if not title or len(title) > 64:
        raise PlaylistError("invalid_title")
    description = (description or "").strip()
    if len(description) > 512:
        raise PlaylistError("invalid_description")

    def operation() -> dict:
        client = _client()
        user_id, _ = _identity()
        before = {entry["id"] for entry in my_playlists(user_id)}
        final_url, html = client.get(SITE + "/playlist/create")
        session_client.ensure_session_usable(final_url, html)
        token = session_client.parse_csrf_token(html)
        if not token:
            raise PlaylistError("csrf_missing")
        final_url, html = client.post_multipart(
            SITE + "/playlist/create",
            {"form[title]": title, "form[description]": description,
             "form[save]": "", "form[_token]": token},
            [("form[coverPath]", "cover.png", default_cover_png(), "image/png")])
        session_client.ensure_session_usable(final_url, html)
        after = my_playlists(user_id)
        created = [entry for entry in after if entry["id"] not in before]
        if len(created) != 1:
            # The server rejected the form (validation error re-renders it).
            raise PlaylistError("create_rejected")
        return created[0]

    return session_client.submit_write(operation, "playlist-create")


def delete_playlist(playlist_id: int) -> None:
    """Delete one of the user's playlists; verified by before/after diff."""

    def operation() -> None:
        client = _client()
        user_id, _ = _identity()
        playlist_id_int = int(playlist_id)
        before = {entry["id"] for entry in my_playlists(user_id)}
        if playlist_id_int not in before:
            raise PlaylistError("playlist_not_found")
        final_url, html = client.get(SITE + "/playlist/" + str(playlist_id_int) + "/delete")
        session_client.ensure_session_usable(final_url, html)
        after = {entry["id"] for entry in my_playlists(user_id)}
        if playlist_id_int in after:
            raise PlaylistError("delete_unverified")

    session_client.submit_write(operation, "playlist-delete")


def set_song_membership(song_id: int, member_playlist_ids: set[int]) -> list[dict]:
    """Set which of the user's playlists contain one song (replace-set semantics).

    The POST to /song/{id} rewrites the song's full membership from the
    checkbox payload; entering that route costs views+1 (accepted by the owner,
    red line 1 exception). Checkbox indexes are parsed from the song page's
    ADD TO PLAYLIST overlay and mapped through playlist TITLES — the server's
    checkbox order does not match the public API's list order (verified on
    production 2026-10-24: they are reversed). The parsed checked states are
    the pre-write truth; the change is verified afterwards and a mismatch
    raises a conflict instead of retrying.
    """
    song_id = int(song_id)
    wanted = {int(pid) for pid in member_playlist_ids}

    def operation() -> list[dict]:
        client = _client()
        user_id, _ = _identity()
        playlists = my_playlists(user_id)
        title_by_id = {entry["id"]: entry["title"] for entry in playlists}
        known = set(title_by_id)
        if not wanted <= known:
            raise PlaylistConflict("unknown_playlist")
        # The overlay page is the ground truth for indexes AND current membership.
        final_url, html = client.get(SITE + "/song/" + str(song_id))
        session_client.ensure_session_usable(final_url, html)
        overlay = session_client.parse_playlist_overlay(html)
        indexes_by_title = {}
        for index, title, _ in overlay:
            indexes_by_title.setdefault(title, []).append(index)
        fields = {"submitPlaylist": "1"}
        for playlist_id in wanted:
            indexes = indexes_by_title.get(title_by_id[playlist_id])
            if not indexes:
                raise PlaylistConflict("unknown_playlist")
            for index in indexes:
                fields["playlist_" + str(index)] = "on"
        previous = {playlist_id for playlist_id, title in title_by_id.items()
                    if any(checked for index, page_title, checked in overlay if page_title == title)}
        final_url, html = client.post_form(SITE + "/song/" + str(song_id), fields)
        session_client.ensure_session_usable(final_url, html)
        # Verify only what should have changed.
        for playlist_id in previous ^ wanted:
            contains = song_id in playlist_detail(playlist_id)["songIds"]
            if contains != (playlist_id in wanted):
                raise PlaylistConflict("membership_unverified")
        counts = {entry["id"]: entry["songs"] for entry in playlists}
        for playlist_id in previous ^ wanted:
            counts[playlist_id] += (1 if playlist_id in wanted else -1)
        return [dict(entry, songs=max(0, counts[entry["id"]])) for entry in playlists]

    return session_client.submit_write(operation, "playlist-membership")
