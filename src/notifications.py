"""Notification reading and clearing over the spinsha.re session channel.

Production markup (verified 2026-10-24): the notification dropdown lives in
every authed page's aside. Each item is ONE anchor whose href is the clear
route:

    <a href="/notification/clear/{id}?returnUrl=..." class="notification-item">
      <div class="notification-icon"><i class="mdi mdi-server"></i></div>
      OR <div class="notification-icon"><div class="cover" style="background-image: url(...)"></div></div>
      <div class="notification-text">... text with <strong> parts ...</div>
    </a>

The cover URL contains the song's fileReference (uploads/thumbnail/{ref}.jpg),
which the frontend resolves to a catalog song for the jump action. There is no
JSON endpoint: reads parse the authed homepage. Clearing uses
GET /notification/clear/{id}?returnUrl=... and /notification/clearAll?returnUrl=...

Reads happen only when the user opens the panel (red line: no background
polling, no timers). Writes run on the serial queue.
"""

from __future__ import annotations

import re

import session_client

SITE = session_client.SITE_ORIGIN
RETURN_URL = SITE + "/"


class NotificationError(session_client.SessionError):
    """A notification operation failed (message is safe to show and log)."""


def _client() -> session_client.SpinShareWeb:
    try:
        return session_client.web_client()
    except session_client.NotConnected as exc:
        raise NotificationError("session_disconnected") from exc


def _parse_notification_page(html: str) -> list[dict]:
    """Extract notification items from an authed page."""
    from html.parser import HTMLParser

    class NotificationParser(HTMLParser):
        def __init__(self):
            super().__init__(convert_charrefs=True)
            self.items = []
            self._item = None      # dict while inside a notification-item anchor
            self._depth = 0        # anchor nesting depth
            self._text_depth = 0   # inside .notification-text

        def handle_starttag(self, tag, attrs):
            attributes = dict(attrs)
            classes = set((attributes.get("class") or "").split())
            if tag == "a" and "notification-item" in classes and self._item is None:
                href = attributes.get("href") or ""
                match = re.search(r"/notification/clear/(\d+)", href)
                self._item = {"id": int(match.group(1)) if match else None, "icon": None, "text": ""}
                self._depth = 1
                return
            if self._item is not None:
                if tag == "a":
                    self._depth += 1
                if tag == "div" and "notification-text" in classes:
                    self._text_depth += 1
                if tag == "div" and "cover" in classes:
                    style = attributes.get("style") or ""
                    match = re.search(r"url\(([^)]+)\)", style)
                    if match:
                        self._item["icon"] = match.group(1).strip("'\" ")

        def handle_data(self, data):
            if self._item is not None and self._text_depth:
                self._item["text"] += data

        def handle_endtag(self, tag):
            if self._item is None:
                return
            if tag == "a" and self._depth:
                self._depth -= 1
                if self._depth == 0:
                    text = " ".join(self._item["text"].split())
                    if self._item["id"] is not None and text:
                        self.items.append({"id": self._item["id"], "icon": self._item["icon"], "text": text})
                    self._item = None
            elif tag == "div" and self._text_depth:
                self._text_depth -= 1

    parser = NotificationParser()
    parser.feed(html)
    return parser.items


def fetch_notifications() -> dict:
    """Read the notification dropdown from the authed homepage (no counters)."""
    client = _client()
    final_url, html = client.get(SITE + "/")
    session_client.ensure_session_usable(final_url, html)
    items = _parse_notification_page(html)
    return {"notifications": items, "unread": len(items)}


def clear_notification(notification_id: int) -> dict:
    """Clear one notification; verified by its disappearance."""

    def operation() -> dict:
        client = _client()
        notification_id_int = int(notification_id)
        final_url, html = client.get(
            SITE + "/notification/clear/" + str(notification_id_int) + "?returnUrl=" + RETURN_URL)
        session_client.ensure_session_usable(final_url, html)
        remaining = [item for item in _parse_notification_page(html) if item["id"] == notification_id_int]
        if remaining:
            raise NotificationError("clear_unverified")
        return {"unread": len(_parse_notification_page(html))}

    return session_client.submit_write(operation, "notification-clear")


def clear_all_notifications() -> dict:
    """Clear every notification; verified by an empty dropdown."""

    def operation() -> dict:
        client = _client()
        final_url, html = client.get(SITE + "/notification/clearAll?returnUrl=" + RETURN_URL)
        session_client.ensure_session_usable(final_url, html)
        remaining = _parse_notification_page(html)
        if remaining:
            raise NotificationError("clear_unverified")
        return {"unread": 0}

    return session_client.submit_write(operation, "notification-clear-all")
