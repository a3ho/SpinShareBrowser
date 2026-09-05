"""Find locally installed game music when a chart has no uploaded audio stream."""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import stat
import time
import urllib.error
import urllib.request


MAX_CHART_BYTES = 32 * 1024 * 1024
MAX_AUDIO_BYTES = 256 * 1024 * 1024
LOOKUP_SECONDS = 12
_REFERENCE = re.compile(r"spinshare_[a-f0-9]{1,64}", re.I)
_GUID = re.compile(r"[a-f0-9]{32}", re.I)


class PreviewError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class _NoRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise PreviewError("preview_lookup_failed", "The audio reference could not be loaded.")


def _load_chart(reference: str) -> dict:
    """Read the static chart, never the view-counting or download-counting APIs."""
    url = f"https://spinshare.b-cdn.net/uploads/srtb/{reference}.srtb"
    request = urllib.request.Request(url, headers={"Accept": "application/json, application/octet-stream"})
    opener = urllib.request.build_opener(_NoRedirects())
    deadline = time.monotonic() + LOOKUP_SECONDS
    try:
        with opener.open(request, timeout=4) as response:
            if response.status != 200:
                raise ValueError("Unexpected response")
            raw = bytearray()
            while True:
                if time.monotonic() >= deadline:
                    raise TimeoutError("Chart lookup timed out")
                # read1 returns available bytes; slow trickles cannot keep one read alive forever.
                chunk = response.read1(min(64 * 1024, MAX_CHART_BYTES + 1 - len(raw)))
                if not chunk:
                    break
                raw.extend(chunk)
                if len(raw) > MAX_CHART_BYTES:
                    raise ValueError("Chart too large")
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise ValueError("Invalid chart")
        return data
    except PreviewError:
        raise
    except urllib.error.HTTPError as error:
        if error.code == 404:
            raise PreviewError("preview_unavailable", "No playable audio reference is available.") from None
        raise PreviewError("preview_lookup_failed", "The audio reference could not be loaded.") from None
    except (OSError, ValueError, TypeError):
        raise PreviewError("preview_lookup_failed", "The audio reference could not be loaded.") from None


def _game_clip(chart: dict) -> str:
    values = chart.get("largeStringValuesContainer", {})
    values = values.get("values") if isinstance(values, dict) else None
    if not isinstance(values, list):
        raise PreviewError("preview_lookup_failed", "The audio reference could not be read.")
    clips = [item for item in values if isinstance(item, dict) and item.get("key") == "SO_ClipInfo_ClipInfo_0"]
    if len(clips) != 1 or not isinstance(clips[0].get("val"), str):
        raise PreviewError("preview_unavailable", "No playable audio reference is available.")
    try:
        clip = json.loads(clips[0]["val"])
        reference = clip.get("clipAssetReference") if isinstance(clip, dict) else None
        bundle = reference.get("bundle") if isinstance(reference, dict) else None
        guid = reference.get("m_guid") if isinstance(reference, dict) else None
    except (TypeError, ValueError):
        raise PreviewError("preview_lookup_failed", "The audio reference could not be read.") from None
    # Missing uploaded/custom audio is not evidence that the game must be installed.
    if not isinstance(bundle, str) or not bundle or bundle.upper() == "CUSTOM" or not isinstance(guid, str) or not _GUID.fullmatch(guid):
        raise PreviewError("preview_unavailable", "No playable audio reference is available.")
    return guid.lower()


def _read_small(path: Path, limit: int = 256 * 1024) -> str:
    try:
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_size > limit or path.is_symlink():
            return ""
        with path.open("rb") as stream:
            raw = stream.read(limit + 1)
        return raw.decode("utf-8-sig") if len(raw) <= limit else ""
    except (OSError, UnicodeError):
        return ""


def _vdf_strings(text: str, key: str) -> list[str]:
    pattern = r'"' + re.escape(key) + r'"\s*"((?:\\.|[^"\\])*)"'
    return [re.sub(r'\\([\\"])', r'\1', value) for value in re.findall(pattern, text, re.I)]


def _steam_paths() -> list[Path]:
    paths = []
    if os.name == "nt":
        import winreg
        for hive, key, value, view in (
            (winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam", "SteamPath", 0),
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Valve\Steam", "InstallPath", winreg.KEY_WOW64_32KEY),
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Valve\Steam", "InstallPath", winreg.KEY_WOW64_64KEY),
        ):
            try:
                with winreg.OpenKey(hive, key, 0, winreg.KEY_READ | view) as handle:
                    location, kind = winreg.QueryValueEx(handle, value)
                if kind == winreg.REG_SZ and isinstance(location, str):
                    paths.append(Path(location))
            except OSError:
                pass
        for key in ("ProgramFiles(x86)", "ProgramFiles"):
            if os.environ.get(key):
                paths.append(Path(os.environ[key]) / "Steam")
    return paths


def _game_directories(target_directory: Path) -> list[Path]:
    target = Path(target_directory).absolute()
    candidates = [target, *list(target.parents)[:6]]
    libraries = [path for path in _steam_paths() if path.is_absolute()]
    for steam in tuple(libraries):
        libraries.extend(path for value in _vdf_strings(_read_small(steam / "steamapps" / "libraryfolders.vdf"), "path")
                         if (path := Path(value)).is_absolute())
    for library in libraries:
        manifest = _read_small(library / "steamapps" / "appmanifest_1058830.acf")
        directories = _vdf_strings(manifest, "installdir")
        if _vdf_strings(manifest, "appid") != ["1058830"] or len(directories) != 1:
            continue
        name = directories[0]
        if name in {"", ".", ".."} or any(char in name for char in '/\\:\x00'):
            continue
        candidates.append(library / "steamapps" / "common" / name)
    games = []
    for candidate in candidates:
        try:
            candidate = candidate.resolve(strict=True)
            if candidate not in games and (candidate / "SpinRhythm.exe").is_file() and (candidate / "SpinRhythm_Data").is_dir():
                games.append(candidate)
        except (OSError, RuntimeError):
            pass
    return games


def _valid_audio(path: Path, root: Path) -> bool:
    try:
        # Only a precise GUID-named file inside a discovered installation may be served.
        if path.resolve(strict=True) != path.absolute() or not path.is_relative_to(root):
            return False
        before = path.lstat()
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or not 58 <= before.st_size <= MAX_AUDIO_BYTES:
            return False
        with path.open("rb") as stream:
            opened = os.fstat(stream.fileno())
            if (opened.st_dev, opened.st_ino, opened.st_size) != (before.st_dev, before.st_ino, before.st_size):
                return False
            header = stream.read(64)
        return header.startswith(b"OggS") and (b"\x01vorbis" in header or b"OpusHead" in header)
    except (OSError, RuntimeError):
        return False


def resolve_preview(file_reference: str, target_directory: Path) -> Path:
    """Return an existing game OGG, without copying, extracting or changing it."""
    if not isinstance(file_reference, str) or not _REFERENCE.fullmatch(file_reference):
        raise PreviewError("invalid_preview_reference", "The chart reference is invalid.")
    guid = _game_clip(_load_chart(file_reference))
    for game in _game_directories(Path(target_directory)):
        for directory in (game / "SpinRhythm_Data" / "StreamingAssets", game / "dlc" / "StreamingAssets"):
            audio = directory / (guid + ".ogg")
            if _valid_audio(audio, game):
                return audio
    raise PreviewError("game_audio_not_found", "This chart uses game audio that is not installed locally.")
