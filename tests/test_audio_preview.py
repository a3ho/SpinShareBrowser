"""Test read-only game-audio discovery using isolated files and no external traffic."""
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

from src import audio_preview as preview


GUID = "891278fe1671eba4481dd98193212271"
REFERENCE = "spinshare_6a9a15683a6a8"


def chart(guid=GUID, bundle="t_raw_music_b"):
    return {"largeStringValuesContainer": {"values": [{"key": "SO_ClipInfo_ClipInfo_0", "val": json.dumps({
        "clipAssetReference": {"bundle": bundle, "assetName": "Music", "m_guid": guid}})}]}}


class Response(io.BytesIO):
    status = 200


class AudioPreviewTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.steam = self.root / "Steam"
        self.library = self.root / "Another library"
        self.game = self.library / "steamapps" / "common" / "Spin Rhythm"
        (self.steam / "steamapps").mkdir(parents=True)
        (self.library / "steamapps").mkdir(parents=True)
        (self.steam / "steamapps" / "libraryfolders.vdf").write_text(
            '"libraryfolders" { "1" { "path" "' + str(self.library).replace("\\", "\\\\") + '" } }')
        (self.library / "steamapps" / "appmanifest_1058830.acf").write_text(
            '"AppState" { "appid" "1058830" "installdir" "Spin Rhythm" }')
        self.audio = self.game / "SpinRhythm_Data" / "StreamingAssets" / (GUID + ".ogg")
        self.audio.parent.mkdir(parents=True)
        (self.game / "SpinRhythm.exe").write_bytes(b"game")
        self.audio.write_bytes(b"OggS" + bytes(24) + b"\x01vorbis" + bytes(100))
        self.addCleanup(patch.stopall)
        patch.object(preview, "_steam_paths", return_value=[self.steam]).start()
        self.load = patch.object(preview, "_load_chart", return_value=chart()).start()

    def assertCode(self, code, callback):
        with self.assertRaises(preview.PreviewError) as caught:
            callback()
        self.assertEqual(caught.exception.code, code)

    def test_secondary_steam_library_returns_original_ogg_without_writes(self):
        before = self.audio.stat()
        self.assertEqual(preview.resolve_preview(REFERENCE, self.root / "Custom"), self.audio)
        after = self.audio.stat()
        self.assertEqual((before.st_size, before.st_mtime_ns), (after.st_size, after.st_mtime_ns))
        self.load.assert_called_once_with(REFERENCE)

    def test_installed_dlc_audio_and_target_ancestor_are_discovered(self):
        destination = self.game / "dlc" / "StreamingAssets" / self.audio.name
        destination.parent.mkdir(parents=True)
        self.audio.rename(destination)
        with patch.object(preview, "_steam_paths", return_value=[]):
            self.assertEqual(preview.resolve_preview(REFERENCE, self.game / "Custom"), destination)

    def test_missing_game_audio_and_missing_uploaded_audio_are_distinct(self):
        self.audio.unlink()
        self.assertCode("game_audio_not_found", lambda: preview.resolve_preview(REFERENCE, self.root))
        for bundle, guid in (("CUSTOM", GUID), ("", GUID), ("t_raw_music_b", "../../secret")):
            self.load.return_value = chart(guid, bundle)
            self.assertCode("preview_unavailable", lambda: preview.resolve_preview(REFERENCE, self.root))

    def test_invalid_references_never_access_network_or_files(self):
        for reference in ("../secret", "spinshare_a?foo=1", "spinshare_a/../x", "https://bad", None):
            self.assertCode("invalid_preview_reference", lambda: preview.resolve_preview(reference, self.root))
        self.load.assert_not_called()

    def test_non_audio_and_linked_files_are_rejected(self):
        self.audio.write_bytes(b"not audio" * 20)
        self.assertCode("game_audio_not_found", lambda: preview.resolve_preview(REFERENCE, self.root))
        self.audio.write_bytes(b"OggS" + bytes(24) + b"\x01vorbis" + bytes(100))
        link = self.audio.with_suffix(".copy")
        import os
        os.link(self.audio, link)
        self.assertCode("game_audio_not_found", lambda: preview.resolve_preview(REFERENCE, self.root))

    def test_manifest_cannot_escape_steam_common_directory(self):
        (self.library / "steamapps" / "appmanifest_1058830.acf").write_text(
            '"AppState" { "appid" "1058830" "installdir" "../Spin Rhythm" }')
        self.assertCode("game_audio_not_found", lambda: preview.resolve_preview(REFERENCE, self.root))

    def test_fixed_static_fetch_size_and_timeout_are_bounded(self):
        patch.stopall()
        with patch.object(preview.urllib.request, "build_opener") as factory:
            opener = factory.return_value
            opener.open.return_value = Response(json.dumps(chart()).encode())
            self.assertEqual(preview._game_clip(preview._load_chart(REFERENCE)), GUID)
            request = opener.open.call_args.args[0]
            self.assertEqual(request.full_url, "https://spinshare.b-cdn.net/uploads/srtb/" + REFERENCE + ".srtb")
            self.assertEqual(opener.open.call_args.kwargs["timeout"], 4)
            with patch.object(preview, "MAX_CHART_BYTES", 16):
                opener.open.return_value = Response(b"x" * 17)
                self.assertCode("preview_lookup_failed", lambda: preview._load_chart(REFERENCE))
            with patch.object(preview.time, "monotonic", side_effect=[0, 13]):
                opener.open.return_value = Response(b"{}")
                self.assertCode("preview_lookup_failed", lambda: preview._load_chart(REFERENCE))
            opener.open.side_effect = urllib.error.HTTPError(request.full_url, 404, "Not Found", {}, None)
            self.assertCode("preview_unavailable", lambda: preview._load_chart(REFERENCE))

    def test_redirect_and_malformed_clip_are_not_followed(self):
        self.assertCode("preview_lookup_failed", lambda: preview._NoRedirects().redirect_request(None, None, 302, "", {}, "https://other.test"))
        self.assertCode("preview_lookup_failed", lambda: preview._game_clip({"largeStringValuesContainer": []}))
        malformed = chart(); malformed["largeStringValuesContainer"]["values"][0]["val"] = "not-json"
        self.assertCode("preview_lookup_failed", lambda: preview._game_clip(malformed))


if __name__ == "__main__":
    unittest.main()
