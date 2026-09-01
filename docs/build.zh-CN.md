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
| `SpinShareBrowser-2.0.0-windows-x64-setup.exe` | Windows 安装包 |
| `SpinShareBrowser-2.0.0-windows-x64-setup.exe.sha256` | 安装包校验文件 |
| `SpinShareBrowser-2.0.0-source.zip` | 源码包 |

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

## 离线回归检查

以下测试使用临时目录和本地模拟响应，不会向 SpinShare 查询或下载谱面。JavaScript 检查需要 Node.js。

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"
Get-ChildItem .\tests -Filter "test_*.cjs" | Sort-Object Name | ForEach-Object {
    node $_.FullName
    if ($LASTEXITCODE -ne 0) { throw "JavaScript test failed: $($_.Name)" }
}
```

## 最终发布校验

源码和文档全部定稿后再执行一次构建。校验安装包与自动生成的 SHA-256 文件一致，并确认源码包包含发布文档和主要源码：

```powershell
$installer = "dist\SpinShareBrowser-2.0.0-windows-x64-setup.exe"
$expected = ((Get-Content "$installer.sha256" -Raw).Trim() -split '\s+')[0].ToUpperInvariant()
$actual = (Get-FileHash $installer -Algorithm SHA256).Hash
if ($actual -ne $expected) { throw "Installer SHA-256 mismatch" }

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = (Resolve-Path "dist\SpinShareBrowser-2.0.0-source.zip").Path
$zip = [IO.Compression.ZipFile]::OpenRead($archive)
try {
    $entries = $zip.Entries.FullName
    $prefix = "SpinShareBrowser-2.0.0/"
    $required = "CHANGELOG.md", "README.md", "PRODUCT.md", "DESIGN.md", "src/spinshare_portable.py", "web/app.js"
    $missing = $required |
        ForEach-Object { "$prefix$_" } |
        Where-Object { $_ -notin $entries }
    if ($missing) { throw "Source archive is missing: $($missing -join ', ')" }
} finally {
    $zip.Dispose()
}
```

安装包、`.sha256` 校验文件和源码包必须来自同一次最终构建，再一并发布。
