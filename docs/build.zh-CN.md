# 构建 SpinShare Browser

[English](build.md) | **简体中文** · [README](../README.zh-CN.md)

在 Windows 上使用 Python 3.12 x64 或更高版本。在项目目录中运行：

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-build.txt
.\.venv\Scripts\python.exe scripts\build.py
```

首次构建会联网获取 Inno Setup、微软 WebView2 SDK 和运行时引导程序，放入 `build/tools`。PyInstaller 打包 Python 和程序所需的库，Inno Setup 生成 Windows 安装包。

## 构建产物

发布文件位于 `dist`：

| 文件 | 内容 |
| --- | --- |
| `SpinShareBrowser-1.0.0-windows-x64-setup.exe` | Windows 安装包 |
| `SpinShareBrowser-1.0.0-windows-x64-setup.exe.sha256` | 安装包校验文件 |
| `SpinShareBrowser-1.0.0-source.zip` | 源码包 |

打包后的程序目录为 `build/windows/SpinShareBrowser`。第三方许可文件随程序安装。

## 源码目录

| 目录 | 内容 |
| --- | --- |
| `src` | Python 窗口宿主、本地服务、谱面安装与卸载支持 |
| `web` | 界面模板和翻译 |
| `assets` | 程序图标和 Windows 版本信息 |
| `scripts` | 构建脚本和 Inno Setup 安装程序定义 |
| `licenses` | 第三方许可证和许可声明 |
| `docs` | 构建说明、截图和演示 |

修改 Python 源码或网页界面后，再次运行 `scripts/build.py` 即可更新安装包。
