"""SpinShare website session channel: storage, form driver and write queue.

This module owns the signed-in spinsha.re state. The login window (desktop
shell) captures the session cookies; everything after that — verification,
identity resolution, form posts and the serial write queue — lives here.

Discipline (red line 1 exception, 2026-10-23):
- Cookie values never appear in logs or errors; only counts and names do.
- All write operations are user-initiated, serial, spaced, and never retried
  automatically.
- The stored session is the account itself: DPAPI-encrypted at rest, clearable
  at any time ("disconnect").
"""

from __future__ import annotations

import ctypes
from ctypes import wintypes
import email.utils
from html.parser import HTMLParser
import http.cookiejar
import io
import json
import mimetypes
import os
from pathlib import Path
import queue
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid


SITE_ORIGIN = "https://spinsha.re"
LOGIN_PATH_PREFIX = "/login"
MAX_PAGE_BYTES = 4 * 1024 * 1024
WRITE_MIN_GAP_SECONDS = 1.2


class SessionError(Exception):
    """Base class for session channel failures (no secrets in messages)."""


class NotConnected(SessionError):
    """An operation needs a signed-in session but none is stored."""


class SessionExpired(SessionError):
    """The stored session was rejected by the website (back at the login form)."""


class WebError(SessionError):
    """A network or response problem while talking to spinsha.re."""


# ---------------------------------------------------------------------------
# DPAPI protection (current Windows user only)


class _DATA_BLOB(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]


_DPAPI_ENTROPY = b"SpinShareBrowser-session-v1"


def _blob_from_bytes(data: bytes) -> _DATA_BLOB:
    buffer = ctypes.create_string_buffer(data, len(data))
    return _DATA_BLOB(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_char)))


def _bytes_from_blob(blob: _DATA_BLOB) -> bytes:
    return ctypes.string_at(blob.pbData, blob.cbData)


def protect_bytes(data: bytes) -> bytes:
    """Encrypt with DPAPI (CryptProtectData) for the current user."""
    if not isinstance(data, (bytes, bytearray)):
        raise SessionError("DPAPI protection accepts bytes only.")
    input_blob = _blob_from_bytes(bytes(data))
    entropy_blob = _blob_from_bytes(_DPAPI_ENTROPY)
    output_blob = _DATA_BLOB()
    if not ctypes.windll.crypt32.CryptProtectData(
            ctypes.byref(input_blob), None, ctypes.byref(entropy_blob), None, None, 0,
            ctypes.byref(output_blob)):
        raise SessionError("DPAPI protection failed.")
    try:
        return _bytes_from_blob(output_blob)
    finally:
        ctypes.windll.kernel32.LocalFree(output_blob.pbData)


def unprotect_bytes(data: bytes) -> bytes:
    """Decrypt DPAPI output produced by protect_bytes."""
    input_blob = _blob_from_bytes(data)
    entropy_blob = _blob_from_bytes(_DPAPI_ENTROPY)
    output_blob = _DATA_BLOB()
    if not ctypes.windll.crypt32.CryptUnprotectData(
            ctypes.byref(input_blob), None, ctypes.byref(entropy_blob), None, None, 0,
            ctypes.byref(output_blob)):
        raise SessionError("DPAPI unprotection failed.")
    try:
        return _bytes_from_blob(output_blob)
    finally:
        ctypes.windll.kernel32.LocalFree(output_blob.pbData)


# ---------------------------------------------------------------------------
# Cookie records (http.cookiejar.Cookie <-> plain dict)


def cookie_to_record(cookie: http.cookiejar.Cookie) -> dict:
    return {"name": cookie.name, "value": cookie.value, "domain": cookie.domain,
            "path": cookie.path, "expires": cookie.expires, "secure": bool(cookie.secure)}


def record_to_cookie(record: dict) -> http.cookiejar.Cookie:
    domain = str(record["domain"])
    dotted = domain.startswith(".")
    expires = record.get("expires")
    return http.cookiejar.Cookie(
        version=0, name=str(record["name"]), value=str(record["value"]),
        port=None, port_specified=False, domain=domain, domain_specified=dotted,
        domain_initial_dot=dotted, path=str(record.get("path") or "/"), path_specified=True,
        secure=bool(record.get("secure")), expires=expires, discard=expires is None,
        comment=None, comment_url=None, rest={}, rfc2109=False)


def _parse_expires(value) -> int | None:
    """pywebview hands cookie expiry as an RFC 1123 string; pre-2000 = session."""
    if value in (None, ""):
        return None
    try:
        parsed = email.utils.parsedate_to_datetime(str(value))
        if parsed.year < 2000:
            return None
        return int(parsed.timestamp())
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def normalize_webview_cookies(items, cookie_domain: str = "spinsha.re") -> list[http.cookiejar.Cookie]:
    """Convert whatever pywebview's get_cookies() returns into cookiejar cookies.

    pywebview 6.2.1 returns one SimpleCookie per captured cookie (name → Morsel
    with domain/path/expires/secure/httponly attributes). Anything already
    cookiejar-shaped passes through. Only cookies for the site domain survive.
    """
    result = []
    for item in items or []:
        try:
            if isinstance(item, http.cookiejar.Cookie):
                cookies = [item]
            else:
                cookies = []
                for name in item.keys():
                    morsel = item[name]
                    cookies.append(http.cookiejar.Cookie(
                        version=0, name=str(name), value=str(morsel.value),
                        port=None, port_specified=False,
                        domain=str(morsel["domain"] or ""), domain_specified=False,
                        domain_initial_dot=False, path=str(morsel["path"] or "/"),
                        path_specified=True, secure=str(morsel["secure"]).lower() == "true",
                        expires=_parse_expires(morsel["expires"]), discard=False,
                        comment=None, comment_url=None, rest={}, rfc2109=False))
            for cookie in cookies:
                if cookie.name and cookie.value and cookie_domain in (cookie.domain or ""):
                    result.append(cookie)
        except (AttributeError, KeyError, TypeError, ValueError):
            continue
    return result


# ---------------------------------------------------------------------------
# Session store: <state>/session.dat, DPAPI-encrypted JSON, atomic writes


def _valid_identity(value) -> bool:
    return (isinstance(value, dict) and isinstance(value.get("userId"), int) and value["userId"] > 0
            and isinstance(value.get("username"), str) and 0 < len(value["username"]) <= 64
            and isinstance(value.get("userAgent"), str) and value["userAgent"])


def _valid_cookies(value) -> bool:
    return (isinstance(value, list) and value
            and all(isinstance(item, dict) and isinstance(item.get("name"), str)
                    and isinstance(item.get("value"), str) and isinstance(item.get("domain"), str)
                    and item["name"] and item["value"] for item in value))


class SessionStore:
    def __init__(self, directory: Path):
        self.path = Path(directory) / "session.dat"
        self._lock = threading.Lock()

    def load(self) -> dict | None:
        """Return the stored session state, or None when signed out or unreadable."""
        with self._lock:
            try:
                raw = self.path.read_bytes()
            except OSError:
                return None
        try:
            state = json.loads(unprotect_bytes(raw).decode("utf-8"))
        except (SessionError, ValueError, UnicodeError):
            return None
        if (not isinstance(state, dict) or state.get("schemaVersion") != 1
                or not _valid_identity(state.get("identity")) or not _valid_cookies(state.get("cookies"))):
            return None
        return state

    def save(self, state: dict) -> None:
        if (state.get("schemaVersion") != 1 or not _valid_identity(state.get("identity"))
                or not _valid_cookies(state.get("cookies"))):
            raise SessionError("Refusing to save an invalid session state.")
        payload = protect_bytes(json.dumps(state, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
        with self._lock:
            temporary = self.path.with_suffix(".dat." + uuid.uuid4().hex + ".tmp")
            with open(temporary, "wb") as handle:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, self.path)

    def clear(self) -> None:
        with self._lock:
            try:
                self.path.unlink()
            except OSError:
                pass


# ---------------------------------------------------------------------------
# HTML parsing (stdlib only; structures verified against the server templates)


class SymfonyFormParser(HTMLParser):
    """Collect form fields: hidden CSRF tokens, inputs, textareas and selects."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.inputs = {}
        self.checked = {}
        self.textareas = {}
        self.selects = {}

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        name = attributes.get("name")
        if tag == "input" and name:
            if attributes.get("type") in (None, "hidden", "text", "password"):
                self.inputs[name] = attributes.get("value") or ""
            elif attributes.get("type") == "checkbox":
                # Boolean attributes arrive as None values in HTMLParser.
                self.checked[name] = "checked" in attributes
        elif tag == "textarea" and name:
            self.textareas[name] = ""
        elif tag == "select" and name:
            self.selects[name] = {"options": [], "selected": None}
        elif tag == "option" and self.selects:
            latest = next(reversed(self.selects.values()))
            latest["options"].append(attributes.get("value") or "")
            if "selected" in attributes and latest["selected"] is None:
                latest["selected"] = attributes.get("value") or ""

    def handle_data(self, data):
        for name in list(self.textareas):
            if self.get_starttag_text() and self.lasttag == "textarea":
                self.textareas[name] += data
                break

    def csrf_token(self, form: str = "form") -> str | None:
        value = self.inputs.get(form + "[_token]")
        return value if value else None

    def checkbox_indexes(self, prefix: str) -> dict[int, bool]:
        result = {}
        pattern = re.compile("^" + re.escape(prefix) + r"(\d+)$")
        for name, checked in self.checked.items():
            match = pattern.match(name)
            if match:
                result[int(match.group(1))] = checked
        return result


class IdentityParser(HTMLParser):
    """Find the signed-in user id from the header's user-actions block."""

    USER_LINK = re.compile(r"^/user/(\d+)/charts$")

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.user_id = None
        self._depth = 0

    def handle_starttag(self, tag, attrs):
        classes = (dict(attrs).get("class") or "").split()
        if tag == "div" and "user-actions" in classes:
            self._depth += 1
        elif self._depth and tag == "a":
            match = self.USER_LINK.match(dict(attrs).get("href") or "")
            if match and self.user_id is None:
                self.user_id = int(match.group(1))

    def handle_endtag(self, tag):
        if self._depth and tag == "div":
            self._depth -= 1


def parse_csrf_token(html: str) -> str | None:
    parser = SymfonyFormParser()
    parser.feed(html)
    return parser.csrf_token()


def parse_checkbox_indexes(html: str, prefix: str = "playlist_") -> dict[int, bool]:
    parser = SymfonyFormParser()
    parser.feed(html)
    return parser.checkbox_indexes(prefix)


def looks_like_login_page(final_url: str, html: str) -> bool:
    """A response is a login page when the URL bounced to /login or the form is present."""
    path = urllib.parse.urlparse(final_url).path
    if path.startswith(LOGIN_PATH_PREFIX):
        return True
    return 'name="_username"' in html[:65536]


def parse_signed_in_user_id(html: str) -> int | None:
    parser = IdentityParser()
    parser.feed(html)
    return parser.user_id


# ---------------------------------------------------------------------------
# Website client: cookie jar + urllib, redirect-aware, login-page detection


def encode_multipart(fields: dict[str, str], files, boundary: str) -> tuple[bytes, str]:
    """Build a multipart/form-data body. files: [(name, filename, content, content_type)]."""
    buffer = io.BytesIO()
    for name, value in fields.items():
        buffer.write(("--" + boundary + "\r\n").encode("utf-8"))
        buffer.write(('Content-Disposition: form-data; name="' + name.replace('"', "") + '"\r\n\r\n').encode("utf-8"))
        buffer.write(str(value).encode("utf-8"))
        buffer.write(b"\r\n")
    for name, filename, content, content_type in files:
        buffer.write(("--" + boundary + "\r\n").encode("utf-8"))
        buffer.write(('Content-Disposition: form-data; name="' + name.replace('"', "")
                      + '"; filename="' + filename.replace('"', "") + '"\r\n').encode("utf-8"))
        buffer.write(("Content-Type: " + (content_type or "application/octet-stream") + "\r\n\r\n").encode("utf-8"))
        buffer.write(content)
        buffer.write(b"\r\n")
    buffer.write(("--" + boundary + "--\r\n").encode("utf-8"))
    return buffer.getvalue(), "multipart/form-data; boundary=" + boundary


class SpinShareWeb:
    """Requests to spinsha.re with the stored session cookies."""

    def __init__(self, cookies: list[http.cookiejar.Cookie] | None = None, user_agent: str = ""):
        self.jar = http.cookiejar.CookieJar()
        for cookie in cookies or []:
            self.jar.set_cookie(cookie)
        self.user_agent = user_agent or "SpinShareBrowser"
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def _request(self, url: str, *, data: bytes | None, content_type: str | None, timeout: float) -> tuple[str, str]:
        headers = {"User-Agent": self.user_agent}
        if content_type:
            headers["Content-Type"] = content_type
        request = urllib.request.Request(url, data=data, headers=headers)
        try:
            with self.opener.open(request, timeout=timeout) as response:
                final_url = response.geturl()
                body = response.read(MAX_PAGE_BYTES + 1)
        except (urllib.error.URLError, OSError, http.client.HTTPException) as exc:
            raise WebError("Could not reach spinsha.re: " + type(exc).__name__) from exc
        if len(body) > MAX_PAGE_BYTES:
            raise WebError("The spinsha.re response exceeded the size limit.")
        return final_url, body.decode("utf-8", "replace")

    def get(self, url: str, *, timeout: float = 20.0) -> tuple[str, str]:
        return self._request(url, data=None, content_type=None, timeout=timeout)

    def post_form(self, url: str, fields: dict[str, str], *, timeout: float = 30.0) -> tuple[str, str]:
        data = urllib.parse.urlencode(fields).encode("utf-8")
        return self._request(url, data=data, content_type="application/x-www-form-urlencoded", timeout=timeout)

    def post_multipart(self, url: str, fields: dict[str, str], files, *, timeout: float = 120.0) -> tuple[str, str]:
        boundary = "----SpinShareBoundary" + uuid.uuid4().hex
        data, content_type = encode_multipart(fields, files, boundary)
        return self._request(url, data=data, content_type=content_type, timeout=timeout)

    def ensure_not_login(self, final_url: str, html: str) -> None:
        if looks_like_login_page(final_url, html):
            raise SessionExpired("The spinsha.re session is no longer signed in.")


# ---------------------------------------------------------------------------
# Serial write queue: user-initiated operations only, spaced, no auto-retry


class WriteQueue:
    def __init__(self, minimum_gap: float = WRITE_MIN_GAP_SECONDS):
        self.minimum_gap = max(0.0, minimum_gap)
        self._jobs = queue.Queue()
        self._last_finish = 0.0
        self._worker = threading.Thread(target=self._run, name="SpinShareSessionWrite", daemon=True)
        self._worker.start()

    def _run(self):
        while True:
            operation, done = self._jobs.get()
            gap = self._last_finish + self.minimum_gap - time.monotonic()
            if gap > 0:
                time.sleep(gap)
            try:
                outcome = {"ok": True, "value": operation()}
            except BaseException as exc:  # surfaced to the caller below
                outcome = {"ok": False, "error": exc}
            self._last_finish = time.monotonic()
            done.set_outcome(outcome)
            self._jobs.task_done()

    def submit(self, operation, label: str = "session-write"):
        """Run one write operation serially and return its result."""
        holder = _Outcome()
        self._jobs.put((operation, holder))
        return holder.wait_for_outcome(label)


class _Outcome:
    def __init__(self):
        self.event = threading.Event()
        self.outcome = None

    def set_outcome(self, outcome):
        self.outcome = outcome
        self.event.set()

    def wait_for_outcome(self, label):
        if not self.event.wait(300):
            raise SessionError("The session operation timed out: " + label)
        if not self.outcome["ok"]:
            raise self.outcome["error"]
        return self.outcome["value"]


# ---------------------------------------------------------------------------
# Module state: owned by PortableApplication, driven by the HTTP endpoints


_state_lock = threading.RLock()
_store: SessionStore | None = None
_write_queue: WriteQueue | None = None
_login_window_opener = None
_login_in_progress = False


def initialize(state_directory) -> None:
    """Bind the session channel to a state directory (called at startup)."""
    global _store, _write_queue
    with _state_lock:
        _store = SessionStore(state_directory)
        _write_queue = WriteQueue()


def set_login_window_opener(opener) -> None:
    """The desktop shell registers how a login window is opened (None = headless)."""
    global _login_window_opener
    with _state_lock:
        _login_window_opener = opener


def status_summary() -> dict:
    """Connected state for bootstrap and /v1/session/status."""
    with _state_lock:
        state = _store.load() if _store else None
        if state:
            identity = state["identity"]
            return {"connected": True, "username": identity["username"], "userId": identity["userId"],
                    "loginActive": _login_in_progress}
        return {"connected": False, "username": None, "userId": None, "loginActive": _login_in_progress}


def request_login() -> None:
    """Open the login window (errors: connected / busy / headless)."""
    global _login_in_progress
    with _state_lock:
        if _store is None:
            raise SessionError("The session channel is not initialized.")
        if _store.load():
            raise SessionError("session_connected")
        if _login_in_progress:
            raise SessionError("session_login_busy")
        if _login_window_opener is None:
            raise SessionError("session_window_unavailable")
        _login_in_progress = True
        opener = _login_window_opener
    try:
        opener()
    except BaseException:
        with _state_lock:
            _login_in_progress = False
        raise


def cancel_login() -> None:
    """The login window closed without a usable session."""
    global _login_in_progress
    with _state_lock:
        _login_in_progress = False


def web_client() -> SpinShareWeb:
    """A client bound to the stored session (raises NotConnected when signed out)."""
    with _state_lock:
        state = _store.load() if _store else None
    if not state:
        raise NotConnected("Not signed in to spinsha.re.")
    cookies = [record_to_cookie(record) for record in state["cookies"]]
    return SpinShareWeb(cookies, state["identity"]["userAgent"])


def complete_login(cookies: list, user_agent: str, user_id: int, *,
                   origin: str = SITE_ORIGIN, cookie_domain: str = "spinsha.re") -> bool:
    """Persist the session captured by the login window.

    The window-side caller proves the session is signed in (it read the signed-in
    header links from the live page DOM — production markup differs from the
    open-source mirror, so marker guessing stays out of here). This side only
    resolves the username via the public API and stores the DPAPI-encrypted state.
    Failed attempts keep the previous state and the in-progress flag intact.
    """
    with _state_lock:
        global _login_in_progress
        try:
            # Accepts raw pywebview cookies (SimpleCookie items) or cookiejar cookies.
            jar = normalize_webview_cookies(cookies, cookie_domain)
            if (not jar or not isinstance(user_agent, str) or not user_agent
                    or not isinstance(user_id, int) or user_id <= 0):
                return False
            client = SpinShareWeb(jar, user_agent)
            final_url, profile_body = client.get(origin + "/api/user/" + str(user_id), timeout=20.0)
            username = _parse_public_username(profile_body)
            if not username:
                return False
            _store.save({"schemaVersion": 1,
                         "identity": {"userId": user_id, "username": username,
                                      "userAgent": user_agent, "connectedAt": _now_iso()},
                         "cookies": [cookie_to_record(cookie) for cookie in jar]})
            # Only a completed login ends the in-progress state; failed
            # attempts leave the flag for the watcher to keep trying.
            _login_in_progress = False
            return True
        except SessionError:
            return False
        except OSError:
            return False


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + "Z"


def _parse_public_username(body: str) -> str | None:
    try:
        envelope = json.loads(body)
    except ValueError:
        return None
    data = envelope.get("data") if isinstance(envelope, dict) else None
    username = data.get("username") if isinstance(data, dict) else None
    return username if isinstance(username, str) and username else None


def disconnect() -> None:
    """Forget the stored session (user action: sign out).

    Signing out also voids any pending login attempt: the user's explicit
    intent supersedes a login window that is still open or stuck.
    """
    global _login_in_progress
    with _state_lock:
        if _store is not None:
            _store.clear()
        _login_in_progress = False


def submit_write(operation, label: str = "session-write"):
    """Run a user-initiated write through the serial spaced queue."""
    with _state_lock:
        queue_instance = _write_queue
    if queue_instance is None:
        raise SessionError("The session channel is not initialized.")
    return queue_instance.submit(operation, label)


def guess_upload_content_type(filename: str) -> str:
    return mimetypes.guess_type(filename)[0] or "application/octet-stream"
