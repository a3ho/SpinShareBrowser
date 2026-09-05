# 构建 SpinShare Browser

[English](build.md) | **简体中文** · [README](../README.zh-CN.md)

在 Windows 上使用 Python 3.12 x64 或更高版本。在项目目录中运行：

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-build.txt
.\.venv\Scripts\python.exe scripts\build.py --qa --preflight
.\.venv\Scripts\python.exe scripts\build.py --qa
```

首次构建会联网获取 Inno Setup、微软 WebView2 SDK 和运行时引导程序，放入 `build/tools`。PyInstaller 打包 Python 和程序所需的库，Inno Setup 生成 Windows 安装包。

## 构建产物

当前源码版本为 2.1.0。可重复验证的构建输出到 `build/qa`；可用 `--qa --output-dir .qa/my-build` 指定独立 QA 目录，不覆盖 `dist` 中的既有发布产物。不带 `--qa` 时正式构建输出到 `dist`，要求 Git 源码干净、依赖精确匹配、版本／标签尚未发布且没有同版本产物。准备下一个正式版本前须先递增版本号。

| 文件 | 内容 |
| --- | --- |
| `SpinShareBrowser-2.1.0-windows-x64-setup.exe` | Windows 安装包 |
| `SpinShareBrowser-2.1.0-windows-x64-setup.exe.sha256` | 安装包校验文件 |
| `SpinShareBrowser-2.1.0-source.zip` | 源码包 |
| `SpinShareBrowser-2.1.0-build.json` | 来源、环境、工具及产物哈希清单 |

QA 打包后的程序目录为 `build/qa-work/windows/SpinShareBrowser`，正式构建为 `build/windows/SpinShareBrowser`；QA 编译中间文件位于 `build/qa-work/pyinstaller`。第三方许可文件随程序安装。

## 源码目录

| 目录 | 内容 |
| --- | --- |
| `src` | Python 窗口宿主、本地服务、谱面安装与卸载支持 |
| `web` | 界面模板和翻译 |
| `assets` | 程序图标和 Windows 版本信息 |
| `scripts` | 构建脚本和 Inno Setup 安装程序定义 |
| `licenses` | 第三方许可证和许可声明 |
| `docs` | 构建说明、截图和演示 |

修改源码或界面后，运行 `scripts/build.py --qa` 重新验证。正式与 QA 构建共享互斥锁；Inno Setup 编译与源码归档相同的快照。构建清单记录提交、源码哈希、实际 Python／依赖版本、构建工具版本／哈希及产物哈希，用于追溯，不宣称不同工具链会产生字节相同的文件。

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

`Verify Windows build` 工作流在 Windows runner 执行离线测试、无界面 Edge 验证和 QA 打包。本机可用以下命令验证真实浏览器布局，不打开可见窗口：

```powershell
npm install --prefix build/browser-tools --no-audit --no-fund playwright@1.62.1
$env:NODE_PATH = (Resolve-Path build/browser-tools/node_modules).Path
node scripts/browser_smoke.cjs
```

浏览器使用独立配置、隔离测试数据和拦截的请求，验证中英文宽窄布局、核对失败与重试、本地不同内容、删除条件及上传者搜索断网回退。截图与结果保存在 `.qa/browser-smoke`。

QA 构建后，运行 `python scripts/installer_cancel_smoke.py --compiler build/tools/inno-7.1.0/ISCC.exe --prove-regression`，在私有不可见的 Windows 桌面验证真实安装器的“重试／取消”按钮。测试使用独立路径和模拟维护进程，禁用快捷方式与卸载注册，不操作已安装程序和共享运行时；反例仅在测试副本中恢复旧取消缺陷，确保测试能够识别它。CI 同样执行此项检查。

发布前手动运行工作流，开启 `installer_smoke` 并指定上个稳定版标签。此时正式候选构建输出到 `dist`，普通 push/PR 检查使用 QA 构建。专用全新托管 Windows runner 安装同一份候选产物及旧版本，验证升级和设置保留、启动已打包桌面宿主、执行窗口状态控制，并验证卸载保留谱面样本。`scripts/windows_smoke.py` 拒绝在个人工作站运行。活动下载阻止升级继续由离线维护测试覆盖；真实鼠标拖动、缩放、播放及多显示器 DPI 仍需额外的隔离 Windows 验收。等待该次工作流通过后，下载其 `windows-candidate` 产物用于发布。

本地正式构建前提交最终源码，依次运行不带 `--qa` 的 `scripts/build.py --preflight` 和 `scripts/build.py`。发布前检查中英文 README 使用说明、更新版本信息，并使用隔离数据重新生成过时的截图和演示；保留所有既有标签和发布资产。采用上述托管发布验证时，应发布已通过验证的候选产物，不再另行本地重建。

源码和文档全部定稿后再执行一次构建。校验安装包与自动生成的 SHA-256 文件一致，并确认源码包包含发布文档和主要源码：

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

安装包、`.sha256` 校验文件、源码包和构建清单必须来自同一次最终构建，再一并发布。失败或已完成的正式构建不能静默覆盖同版本产物，调试构建始终使用 QA 目录。
