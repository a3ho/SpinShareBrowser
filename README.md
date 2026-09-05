# SpinShare Browser

**English** | [简体中文](README.zh-CN.md)

A third-party Windows app for browsing, installing, and managing local [SpinShare](https://spinsha.re/) charts.

![Browse and manage local SpinShare charts](docs/images/overview-en.png)

## Version 2.1.0

Released September 6, 2026. Screenshots and demonstrations show the current interface with isolated example data.

- See when local chart contents differ from the listed chart, with a dedicated filter and a warning before replacing local edits.
- Retry failed installation checks in every browsing view.
- Recover interrupted installations while preserving files that need attention.
- See when uploader search needs an online lookup; local matches remain available if it fails.
- Cancel an update from a preparation error prompt without continuing installation.

[Read the changelog](CHANGELOG.md)

> Only the latest stable release is maintained and supported. Update to the latest release for fixes and support.

## Features

- Filter by difficulty and upload date.
- Search the filtered charts by title, subtitle, artist, or uploader / charter.
- Combine independent tag filters, with result counts for each suggestion and a sticky selected-tag bar.
- Show all charts, installed charts, charts with different local contents, or uninstalled charts using locally verified installation status.
- Sort by upload date, difficulty rating, views, downloads, or title.
- Play a chart's complete song in one global header player.
- Browse cover art, author notes and tags, optionally show full comments, install charts, check their installation status, and remove verified local charts.
- English and Simplified Chinese interface.

## Install

**[Download for Windows](https://github.com/a3ho/SpinShareBrowser/releases/latest)**

1. On the release page, download `SpinShareBrowser-2.1.0-windows-x64-setup.exe` under **Assets**. Source archives are for building the app.
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

Song titles, subtitles, artists and charter names are searched locally. Uploader accounts are looked up online when needed. If that lookup fails, local matches remain visible and you can retry.

![Filter, search, install, and manage a chart](docs/images/workflow-en.gif)

### Play songs

Move the pointer over a chart cover and select the play button. The global player at the top shows the current song and lets you pause, resume, or drag the timeline.

Some charts use music from the game. To preview them, keep Spin Rhythm XD and any required DLC installed through Steam.

After a song starts playing, press **Space** to pause or resume. Press **Left** or **Right** to seek by five seconds. These shortcuts are disabled while you are typing.

### Read notes and reviews

Short author notes appear directly on the chart card. Select a longer note to read the full text.

Select the review count to read reviews in a floating panel. Turn on **Expand all reviews** when you want every chart's reviews visible in the list.

### Download, install, and delete

Select **Download and install** on a chart card. The first time, confirm the chart installation folder or select **Change directory**.

Installed charts are marked **Installed**. Select **Install again** to replace one with the listed version. DLC charts use the same install, reinstall, and delete actions; their requirement label can open the relevant Steam page.

**Local files differ** means the local chart differs from the listed version and may contain your own edits. These charts appear in **Installed only** and have a dedicated filter. Installing again replaces those local edits; deletion is available only for an exact match.

When an installed chart shows **Delete**, selecting it immediately and permanently removes that chart's custom chart, cover, and audio files without another confirmation. Other files and Steam DLC files are left untouched. You can select **Delete** on several charts to queue them.

Installation status refreshes automatically when you return to the app. A completed chart updates without waiting for other queued downloads or installations.

If a check fails, the last confirmed state stays visible with a retry action. After an interrupted installation, the app tries to recover the files. If recovery needs attention, close apps using those files and retry the installation check; recovery backups are kept.

To update SpinShare Browser, run the latest installer. If downloads or installations are still active, let them finish and then select **Retry**. **Cancel** exits this setup without applying the update.

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
