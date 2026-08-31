# SpinShare Browser

**English** | [简体中文](README.zh-CN.md)

A third-party Windows app for browsing and installing [SpinShare](https://spinsha.re/) charts.

![Browsing charts in SpinShare Browser](docs/images/overview-en.png)

## Features

- Filter by difficulty and upload date.
- Search the filtered charts by title, subtitle, artist, or uploader / charter.
- Sort by upload date, difficulty rating, views, downloads, comment count, or title.
- Browse cover art and full comments, install charts, and check their installation status.
- English and Simplified Chinese interface.

## Install

**[Download for Windows](https://github.com/a3ho/SpinShareBrowser/releases/latest)**

1. On the release page, download `SpinShareBrowser-1.0.0-windows-x64-setup.exe` under **Assets**. Source archives are for building the app.
2. Run the installer and follow Setup. It installs for your Windows account, adds a Start Menu entry, and offers a desktop shortcut.

Requires **Windows 10 version 1903 or later, or Windows 11 (x64)**, and **.NET Framework 4.8 or later**. Python and the app libraries are bundled.

Setup reuses an existing **Microsoft Edge WebView2 Runtime 123.0.2420.47 or later**. If the runtime is missing or older, the bundled Microsoft bootstrapper downloads and installs it. A failed download can be retried in Setup; for offline installation, install Microsoft's [Evergreen Standalone Runtime](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution) first. Browsing SpinShare requires internet access. WebView2 includes Microsoft Defender SmartScreen; see [Microsoft's privacy statement](https://aka.ms/privacy).

## Use

1. Choose the difficulty and upload date, then select **Filter charts**. Defaults are **XD, 0–99** and **Past week**. Custom date ranges accept a start date, an end date, or both.
2. Search within the results using the box below the filters. Select one or more search fields: song title, subtitle, artist, or uploader / charter.
3. Select **Download and install**. Charts go into Spin Rhythm XD's `Custom` directory; choose another folder under **Settings → Choose folder**.

![Filter, search, and install a chart](docs/images/workflow-en.gif)

**Installing a chart overwrites files with the same name.** The **Installed** label means the local chart file matches the listed version. DLC charts open SpinShare in your default browser for authorization and download.

Pages contain **10, 20, or 30** charts. **Unlimited** adds more as you scroll. You can jump to a page directly. Search, sorting, and paging use the loaded chart list; **Refresh data** fetches current data from SpinShare.

Closing the window asks whether to quit or minimize to the system tray. Select **Remember my choice**, or change the behavior in Settings. **Quit app** in Settings or the tray exits the program; active downloads and installations can finish before exit.

Language, the chart directory, close preferences, and window size or maximized state are saved automatically. The first launch opens maximized.

## Upgrade and uninstall

Run a newer installer to upgrade while keeping your settings. Uninstall through **Windows Settings → Apps** or **Control Panel → Programs and Features**. Uninstalling removes the app, its settings, and its cache. Downloaded and installed charts and the shared WebView2 Runtime are kept.

The default installation folder is `%LOCALAPPDATA%\Programs\SpinShareBrowser`; settings and embedded browser data use `%LOCALAPPDATA%\SpinShareBrowser`. Charts stay in the selected game directory.

## License

Original code is licensed under [MIT](LICENSE). Third-party components and artwork retain their own licenses; see [third-party notices](licenses/) and [artwork attribution](assets/README.md).

[Build from source](docs/build.md)

<sub>Developed by Liu Yishou</sub>
