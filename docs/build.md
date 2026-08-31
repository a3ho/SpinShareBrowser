# Building SpinShare Browser

**English** | [简体中文](build.zh-CN.md) · [README](../README.md)

Use Python 3.12 x64 or later on Windows. Run these commands from the project directory:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-build.txt
.\.venv\Scripts\python.exe scripts\build.py
```

The first build downloads Inno Setup, the Microsoft WebView2 SDK, and the runtime bootstrapper into `build/tools`. PyInstaller bundles Python and the app libraries; Inno Setup creates the Windows installer.

## Outputs

The release files are written to `dist`:

| File | Contents |
| --- | --- |
| `SpinShareBrowser-1.0.0-windows-x64-setup.exe` | Windows installer |
| `SpinShareBrowser-1.0.0-windows-x64-setup.exe.sha256` | Installer checksum |
| `SpinShareBrowser-1.0.0-source.zip` | Source archive |

The unpacked application files are in `build/windows/SpinShareBrowser`. Third-party license files are included in the installed application.

## Source layout

| Directory | Contents |
| --- | --- |
| `src` | Python window host, local service, chart installer, and uninstall support |
| `web` | Interface template and translations |
| `assets` | Application icons and Windows version information |
| `scripts` | Build script and Inno Setup installer definition |
| `licenses` | Third-party license texts and notices |
| `docs` | Build instructions, screenshots, and demonstrations |

After editing the Python source or web interface, run `scripts/build.py` again to update the installer.
