# SpinShare Browser

**English** | [简体中文](README.zh-CN.md)

A third-party Windows app for browsing and installing [SpinShare](https://spinsha.re/) charts.

![Browsing charts in SpinShare Browser](docs/images/overview-en.png)

## Current release: 2.0.0

**Maintenance re-release: September 2, 2026**

- A redesigned, responsive chart browser with clearer typography, denser cards, refined motion, and cohesive loading, empty, and footer states.
- Local-first filtering, search, tags, sorting, and installation-status views backed by a durable catalog with 12-hour automatic synchronization.
- A single full-song player with cover controls, a draggable timeline, and Space and arrow-key shortcuts.
- Anchored floating descriptions and review panels that preserve page layout, contain scrolling, and keep review counts available.
- Fast local installation inventories plus targeted per-chart verification, so completed cards update immediately while other jobs continue.
- Unified DLC installation behavior and one-click deletion of verified local charts, with multi-delete queuing and rollback on failure.
- Safer overwrite updates that wait for the original idle process, never force active jobs, and offer retry/cancel when files remain locked.

[Read the complete 2.0.0 changelog](CHANGELOG.md)

> SpinShare Browser maintains and distributes only the latest stable release. Historical installers are unavailable; update to the latest release for continued support.

## Features

- Filter by difficulty and upload date.
- Search the filtered charts by title, subtitle, artist, or uploader / charter.
- Combine independent tag filters, with result counts for each suggestion and a sticky selected-tag bar.
- Show all charts, only installed charts, or only uninstalled charts using locally verified installation status.
- Sort by upload date, difficulty rating, views, downloads, or title.
- Play a chart's complete song in one global header player.
- Browse cover art, author notes and tags, optionally show full comments, install charts, check their installation status, and remove verified local charts.
- English and Simplified Chinese interface.

## Install

**[Download for Windows](https://github.com/a3ho/SpinShareBrowser/releases/latest)**

1. On the release page, download `SpinShareBrowser-2.0.0-windows-x64-setup.exe` under **Assets**. Source archives are for building the app.
2. Run the installer and follow Setup. It installs for your Windows account, adds a Start Menu entry, and offers a desktop shortcut.

Requires **Windows 10 version 1903 or later, or Windows 11 (x64)**, and **.NET Framework 4.8 or later**. Python and the app libraries are bundled.

The installer is not code-signed, so Windows may show an unknown-publisher or SmartScreen warning. Download it only from this repository's latest Release and verify it with the provided `.sha256` file.

Setup reuses an existing **Microsoft Edge WebView2 Runtime 123.0.2420.47 or later**. If the runtime is missing or older, the bundled Microsoft bootstrapper downloads and installs it. A failed download can be retried in Setup; for offline installation, install Microsoft's [Evergreen Standalone Runtime](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution) first. Browsing SpinShare requires internet access. WebView2 includes Microsoft Defender SmartScreen; see [Microsoft's privacy statement](https://aka.ms/privacy).

## Use

### Browse and find charts

1. Choose a difficulty and upload date, then select **Filter charts**.
2. Narrow the results with keyword search, tags, installation status, and sorting.
3. Use the page controls to move through the list, or choose **Unlimited** to keep loading charts as you scroll.

Select **Add tag** to combine tags, or select a tag directly on a chart card. **Reset filters** returns to the default browsing view.

![Filter, search, and install a chart](docs/images/workflow-en.gif)

### Play songs

Move the pointer over a chart cover and select the play button. The global player at the top shows the current song and lets you pause, resume, or drag the timeline.

After a song starts playing, press **Space** to pause or resume. Press **Left** or **Right** to seek by five seconds. These shortcuts are disabled while you are typing.

### Read notes and reviews

Short author notes appear directly on the chart card. Select a longer note to read the full text.

Select the review count to read reviews in a floating panel. Turn on **Expand all reviews** when you want every chart's reviews visible in the list.

### Download and install

Select **Download and install** on a chart card. Check that the displayed chart installation folder is correct, or select **Change directory**.

Installed charts are marked **Installed**. Use **Install again** when you want to replace an installed chart with the listed version. DLC charts use the same installation flow and show a compact requirement label linking to the corresponding Steam store page when the supplied address is valid.

A chart, including a DLC chart, that exactly matches the installed version also shows **Delete**. Selecting it immediately and permanently removes that custom chart's `.srtb` file and matching optional cover and audio files, without a confirmation dialog. ZIP archives, unrelated temporary files, shared folders, and Steam's official DLC files are left untouched. You can queue multiple chart deletions; each card shows its own progress, while installation and deletion operations remain mutually exclusive, including while an installation request's result is still unknown. A successful deletion refreshes the installation views and counts automatically. A failed deletion attempts to restore staged files and keeps the `.srtb` installed when possible; an explicit error tells you to inspect the install folder if some resources could not be restored, and the app rechecks the actual installation state.

Installation status is still rechecked automatically when the window returns to the foreground. Routine refreshes inventory the actual `.srtb` files once and return their hashes, then the interface matches the current catalog in memory instead of probing every catalog candidate. A completed install uses one targeted local hash check, so its card updates immediately while other jobs continue. A deletion invalidates the affected chart status; changing the install folder invalidates the previous folder's whole inventory. DLC charts participate in the same installed/not-installed filter, progress, count, paging, and retry behavior. If a real inventory check fails, the last successful result remains available and the check can be retried.

During an overwrite update, Setup asks an idle running app to close and waits for its original process to exit before replacing files. Active downloads or installations are never force-terminated. If the app is still exiting or a program file remains locked, Setup offers **Retry** or **Cancel** so the update can continue in place after the lock is released.

### Data updates and background running

The app keeps chart data locally and synchronizes it automatically, so manual updates are usually unnecessary. If the list appears outdated, select **Update data**.

When closing the window, choose whether to quit or keep the app in the system tray. Language, chart installation folder, and close behavior can be changed in **Settings**.

## Upgrade and uninstall

Running Setup again states on its Welcome page that it will overwrite and update the installed SpinShare Browser while keeping its settings. Locally installed charts remain unchanged. Uninstall through **Windows Settings → Apps** or **Control Panel → Programs and Features**. Uninstalling removes the app, its settings, and its cache. Downloaded and installed charts and the shared WebView2 Runtime are kept.

The default installation folder is `%LOCALAPPDATA%\Programs\SpinShareBrowser`; settings and embedded browser data use `%LOCALAPPDATA%\SpinShareBrowser`. Charts stay in the selected game directory.

## License

Original code is licensed under [MIT](LICENSE). Third-party components and artwork retain their own licenses; see [third-party notices](licenses/) and [artwork attribution](assets/README.md).

[Build from source](docs/build.md)

<sub>Developed by Liu Yishou</sub>
