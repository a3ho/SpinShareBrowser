"""Review writing over the spinsha.re session channel.

Production shapes verified on 2026-10-24 (the open-source mirror is an older
revision — reviews moved to a dedicated tab page):
- The add form lives at GET /song/{id}?tab=reviews&action=add and posts to the
  same URL: reviewRecommended=yes|no, reviewComment, submitReview=Submit.
  No CSRF token (hand-written form). Entering the song route costs views+1
  (accepted by the owner, red line 1 exception).
- Deleting uses GET /song/{songId}/review/{reviewId}/delete (no CSRF).
- Reads are public: /api/song/{id}/reviews (used by the app already) and
  /api/user/{id}/reviews.

Posts are verified by finding the caller's own review in the song's public
reviews; deletes by its disappearance. Writes run on the serial queue.
"""

from __future__ import annotations

import json

import session_client

SITE = session_client.SITE_ORIGIN
MAX_COMMENT_LENGTH = 2000


class ReviewError(session_client.SessionError):
    """A review operation failed (message is safe to show and log)."""


def _identity() -> int:
    summary = session_client.status_summary()
    if not summary.get("connected") or not summary.get("userId"):
        raise ReviewError("session_disconnected")
    return summary["userId"]


def _client() -> session_client.SpinShareWeb:
    try:
        return session_client.web_client()
    except session_client.NotConnected as exc:
        raise ReviewError("session_disconnected") from exc


def _song_reviews(client: session_client.SpinShareWeb, song_id: int) -> list[dict]:
    final_url, body = client.get(SITE + "/api/song/" + str(int(song_id)) + "/reviews", timeout=30.0)
    try:
        envelope = json.loads(body)
    except ValueError as exc:
        raise ReviewError("invalid_response") from exc
    if not isinstance(envelope, dict) or envelope.get("status") != 200 or not isinstance(envelope.get("data"), dict):
        raise ReviewError("api_error")
    entries = envelope["data"].get("reviews")
    if entries is None and envelope["data"].get("average") is False:
        entries = []
    if not isinstance(entries, list):
        raise ReviewError("api_error")
    return [entry for entry in entries if isinstance(entry, dict)]


def my_reviews_on(client: session_client.SpinShareWeb, song_id: int, user_id: int) -> list[dict]:
    return [entry for entry in _song_reviews(client, song_id)
            if isinstance(entry.get("user"), dict) and entry["user"].get("id") == user_id
            and isinstance(entry.get("id"), int)]


def my_review_on(client: session_client.SpinShareWeb, song_id: int, user_id: int) -> dict | None:
    mine = my_reviews_on(client, song_id, user_id)
    return mine[0] if mine else None


def post_review(song_id: int, recommended: bool, comment: str) -> dict:
    """Publish one review for the song; returns the created review summary."""
    song_id = int(song_id)
    comment = (comment or "").strip()
    if not comment or len(comment) > MAX_COMMENT_LENGTH:
        raise ReviewError("invalid_comment")
    if not isinstance(recommended, bool):
        raise ReviewError("invalid_recommendation")

    def operation() -> dict:
        client = _client()
        user_id = _identity()
        url = SITE + "/song/" + str(song_id) + "?tab=reviews&action=add"
        before = {entry["id"] for entry in my_reviews_on(client, song_id, user_id)}
        final_url, html = client.get(url)
        session_client.ensure_session_usable(final_url, html)
        fields = {"reviewRecommended": "yes" if recommended else "no",
                  "reviewComment": comment, "submitReview": "Submit"}
        final_url, html = client.post_form(url, fields)
        session_client.ensure_session_usable(final_url, html)
        created = [entry for entry in my_reviews_on(client, song_id, user_id) if entry["id"] not in before]
        if len(created) != 1:
            raise ReviewError("post_unverified")
        mine = created[0]
        return {"reviewId": mine["id"], "recommended": mine.get("recommended") is True,
                "comment": str(mine.get("comment") or "")}

    return session_client.submit_write(operation, "review-post")


def delete_review(song_id: int, review_id: int) -> None:
    """Delete one of the caller's own reviews; verified by disappearance."""
    song_id, review_id = int(song_id), int(review_id)

    def operation() -> None:
        client = _client()
        user_id = _identity()
        if my_review_on(client, song_id, user_id) is None:
            raise ReviewError("review_not_found")
        final_url, html = client.get(SITE + "/song/" + str(song_id) + "/review/" + str(review_id) + "/delete")
        session_client.ensure_session_usable(final_url, html)
        if my_review_on(client, song_id, user_id) is not None:
            raise ReviewError("delete_unverified")

    session_client.submit_write(operation, "review-delete")
