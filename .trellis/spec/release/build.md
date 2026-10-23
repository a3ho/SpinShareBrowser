# 构建系统（scripts/build.py）

## 前置（每次构建都查）

Python 3.12+ Win x64；`check_requirements`：requirements-build.txt 必须**全钉死版本**且与当前环境逐一相符（PyInstaller 6.22.2、pywebview 6.2.1、pythonnet 3.1.0 等 16 个）；`pip check` 通过。

## 工具链（build_tools，首次下载后缓存）

- Inno Setup 7.1.0 portable（GitHub release，sha256 钉死，验 Pyrsys B.V. Authenticode 签名）
- WebView2 Bootstrapper（Microsoft 链接，验 Microsoft 签名）
- WebView2 SDK NuGet 1.0.3856.49（sha256 钉死；运行时只取 2 个 net462 DLL + 3 架构 WebView2Loader.dll，逐个验微软签名后覆写进 pywebview 的 lib 目录）

## QA vs 正式

| | `--qa`（默认给本地/CI 用） | 正式（无 --qa） |
| --- | --- | --- |
| 输出 | build/qa 或 `.qa/<dir>`（--output-dir 限定这两个根） | 只许 dist/ |
| 门禁 | 无 git 要求 | 干净树、SOURCE_FILES 全部被 git 跟踪、本地+origin 均无该版本标签、不覆盖同名产物（`check_release`） |
| 用途 | 重复验证 | 发布 |

互斥：`build/.build.lock`（open 'x'）防并行构建。升级版本前先 `--preflight`。

## 编译流程（build_application）

1. **源码快照**：SOURCE_FILES（约 70 个文件的显式白名单——**新增源文件必须加进去**，否则不进 exe/源码包）复制到 `build[/qa-work]/pyinstaller/source/`。
2. 汇总 THIRD-PARTY-LICENSES.txt（Python LICENSE + 项目 licenses/* + 每个 pip 依赖的 LICENSE 文件；proxy_tools 上游无文件、由 windows-notices.txt 覆盖）。
3. PyInstaller onedir+windowed+noupx，固定 `PYTHONHASHSEED=1`、`SOURCE_DATE_EPOCH`；web 五文件与图标 --add-data；许可证作为资源 ID 10/22000 嵌入。
4. WebView2 SDK DLL 覆写 + 验签；LICENSE 三件套放进产物根。
5. `write_program_files` 生成程序文件清单 iss include → ISCC 编译安装器（传 PayloadDir/Bootstrapper/版本等 define）。
6. 源码 zip（固定时间戳 2026-08-30、ZIP_DEFLATED/9、normalized 属性——同工具链可复现）；.sha256 sidecar；`-build.json` manifest：{version, purpose, source{commit,dirty,sha256×N}, python 版本/架构/解释器哈希, dependencies, tools{版本+文件哈希}, artifacts 哈希}。

## 坑

- `dist/` 里还躺着 2.0.0–2.1.1 的历史产物（本地留存）；正式构建同版本拒绝覆盖是刻意的。
- requirements-build.txt 任何"宽松"版本号直接报错——必须 `==`。
- build/tools、build/qa-work、build/windows 都是构建中间区，不要手工改。
