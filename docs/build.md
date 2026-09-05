# Building SpinShare Browser

**English** | [简体中文](build.zh-CN.md) · [README](../README.md)

Use Python 3.12 x64 or later on Windows. Run these commands from the project directory:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-build.txt
.\.venv\Scripts\python.exe scripts\build.py --qa --preflight
.\.venv\Scripts\python.exe scripts\build.py --qa
```

The first build downloads Inno Setup, the Microsoft WebView2 SDK, and the runtime bootstrapper into `build/tools`. PyInstaller bundles Python and the app libraries; Inno Setup creates the Windows installer.

## Outputs

The source version is 2.1.0. Repeatable verification builds use `build/qa`; `--qa --output-dir .qa/my-build` selects a separate QA directory. These builds do not overwrite published `dist` artifacts. Without `--qa`, a formal build writes to `dist` and requires a clean Git source tree, exact pinned dependencies, an unpublished version/tag, and no existing same-version artifacts. Increment the version before preparing the next formal release.

| File | Contents |
| --- | --- |
| `SpinShareBrowser-2.1.0-windows-x64-setup.exe` | Windows installer |
| `SpinShareBrowser-2.1.0-windows-x64-setup.exe.sha256` | Installer checksum |
| `SpinShareBrowser-2.1.0-source.zip` | Source archive |
| `SpinShareBrowser-2.1.0-build.json` | Source, environment, tools and artifact hashes |

The unpacked QA application files are in `build/qa-work/windows/SpinShareBrowser`; formal builds use `build/windows/SpinShareBrowser`. QA compilation files stay in `build/qa-work/pyinstaller`. Third-party license files are included in the installed application.

## Source layout

| Directory | Contents |
| --- | --- |
| `src` | Python window host, local service, chart installer, and uninstall support |
| `web` | Interface template and translations |
| `assets` | Application icons and Windows version information |
| `scripts` | Build script and Inno Setup installer definition |
| `licenses` | Third-party license texts and notices |
| `docs` | Build instructions, screenshots, and demonstrations |

After editing source or the interface, run `scripts/build.py --qa` again. Formal and QA builds share an exclusive build lock. Inno Setup compiles the same source snapshot used by the source archive. The manifest records the commit, source hashes, actual Python and dependency versions, build tool versions/hashes and resulting artifact hashes; it makes builds traceable without claiming byte-identical results across different toolchains.

## Offline regression checks

These tests use temporary directories and local fixtures without querying or downloading charts from SpinShare. The JavaScript checks require Node.js.

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"
Get-ChildItem .\tests -Filter "test_*.cjs" | Sort-Object Name | ForEach-Object {
    node $_.FullName
    if ($LASTEXITCODE -ne 0) { throw "JavaScript test failed: $($_.Name)" }
}
```

## Final release verification

The `Verify Windows build` workflow runs the offline suites, headless Edge checks and a QA build on a Windows runner. To run the browser check locally without opening a visible window:

```powershell
npm install --prefix build/browser-tools --no-audit --no-fund playwright@1.62.1
$env:NODE_PATH = (Resolve-Path build/browser-tools/node_modules).Path
node scripts/browser_smoke.cjs
```

The browser uses a separate profile, isolated test data and intercepted requests. It checks English and Chinese at wide/narrow widths, installation failures and retries, differing local contents, deletion eligibility and offline uploader-search fallback. Screenshots and results stay in `.qa/browser-smoke`.

After the QA build, run `python scripts/installer_cancel_smoke.py --compiler build/tools/inno-7.1.0/ISCC.exe --prove-regression` to exercise the actual installer Retry/Cancel buttons on a private, invisible Windows desktop. The fixture uses separate paths and a simulated maintenance process, disables shortcuts and uninstall registration, and leaves the installed app and shared runtimes alone. The negative check restores the old cancellation bug in a fixture only, so the test must detect it. This check also runs in CI.

Before release, dispatch the workflow with `installer_smoke` enabled and the previous stable tag. This builds a formal candidate into `dist`; ordinary push/PR checks use a QA build. Dedicated fresh hosted Windows jobs install that exact candidate and the previous version, verify upgrade/settings retention, start the packaged desktop host, exercise window state controls and verify uninstall preserves chart fixtures. `scripts/windows_smoke.py` refuses to run on a workstation. Active-download upgrade refusal remains covered by offline maintenance tests; real mouse dragging, resizing, playback and multi-monitor DPI need an additional isolated Windows acceptance pass. Wait for the dispatched run to pass, then download its `windows-candidate` artifact for publication.

For a local formal build, commit the final source and run `scripts/build.py --preflight`, then `scripts/build.py` without `--qa`. Review both README usage sections, update release details and regenerate any stale screenshots/demonstrations from isolated data before publication. Preserve all existing tags and release assets. When using the hosted release validation above, publish its verified candidate instead of rebuilding locally.

Build once more after the final source and documentation changes. Verify that the installer matches its generated SHA-256 sidecar and that the source archive contains the release documentation and primary source files:

```powershell
$installer = "dist\SpinShareBrowser-2.1.0-windows-x64-setup.exe"
$expected = ((Get-Content "$installer.sha256" -Raw).Trim() -split '\s+')[0].ToUpperInvariant()
$actual = (Get-FileHash $installer -Algorithm SHA256).Hash
if ($actual -ne $expected) { throw "Installer SHA-256 mismatch" }

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = (Resolve-Path "dist\SpinShareBrowser-2.1.0-source.zip").Path
$zip = [IO.Compression.ZipFile]::OpenRead($archive)
try {
    $entries = $zip.Entries.FullName
    $prefix = "SpinShareBrowser-2.1.0/"
    $required = "CHANGELOG.md", "README.md", "PRODUCT.md", "DESIGN.md", "src/spinshare_portable.py", "web/app.js"
    $missing = $required |
        ForEach-Object { "$prefix$_" } |
        Where-Object { $_ -notin $entries }
    if ($missing) { throw "Source archive is missing: $($missing -join ', ')" }
} finally {
    $zip.Dispose()
}
```

Publish the installer, its `.sha256` sidecar, source archive and build manifest from the same completed build. A failed or already-completed formal build cannot silently overwrite same-version artifacts; keep debugging builds in a QA directory.
