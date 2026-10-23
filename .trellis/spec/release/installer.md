# Windows 安装器（scripts/windows.iss + Inno Setup 7.1.0）

## 定位

per-user 安装到 `{localappdata}\Programs\SpinShareBrowser`，状态在 `{localappdata}\SpinShareBrowser`；PrivilegesRequired=lowest、x64os、MinVersion 10.0.18362、深色 modern 向导、中英双语（Default.isl + ChineseSimplified.isl + 大量 CustomMessages）。

## 覆盖更新语义

检测到既有安装（ExistingVersion）：欢迎页明确"将以 %1 版覆盖/更新程序文件；本地已安装谱面不受影响"；已装更高版本拒绝降级。卸载确认文案区分"工具数据删除、谱面保留"。

## 维护协作（[Code] 段，与 maintenance.py 对应）

- 自己实现 Win32 import：CreateMutexW/WaitForSingleObject/…/LCMapStringEx/CreateFileW/GetFileInformationByHandle——**门互斥体名与应用侧 gate_name 同算法**（LCMapStringEx 小写折叠 + UTF-16LE sha256）。
- 阶段：PreparingFiles（自解压）→ CheckingRunningApp（跑 `--maintenance prepare --parent-pid`，等待真实退出）→ CheckingProgramFiles（句柄钉住程序目录树后核对文件）→ InstallingWebView2（检注册表 EdgeUpdate Clients 键的 pv 版本 ≥123.0.2420.47，缺则跑微软引导器，失败给 Evergreen 指引）→ 落盘。
- 维护退出码 → 用户文案映射：10/13/14→MaintenanceBusy（重试/取消）、11/12→MaintenanceIO、15→MaintenancePolicyBlocked、退出码 5（策略）等。**取消（Cancel）在准备失败时真的退出安装**（2.1.0 修的回归，installer_cancel_smoke.py --prove-regression 用"故意复活旧 bug 的 fixture"守住它）。
- PayloadReady 之前不写任何程序文件；PinProgramDirectory 用 FILE_LIST_DIRECTORY 句柄钉目录防删除竞态。

## 卸载

`--maintenance prepare-uninstall` 先协调应用退出；卸载段（[UninstallRun]/curUninstallStepChangedusUninstall → cleanup）删状态目录（只删带所有权标记的），程序文件由 Inno 日志（UninstallLogMode=append）负责；共享 WebView2 运行时不卸。

## 验收工具

- `scripts/installer_cancel_smoke.py`：私有桌面跑真实安装器的重试/取消（CI 也跑）；--prove-regression 负向检查。
- `scripts/windows_smoke.py`：**拒绝在开发者工作站跑**（检查 CI 环境变量），装/升级/窗口/卸载全链路。
- `scripts/browser_smoke.cjs`：Playwright msedge 无头，中英×宽窄×安装失败重试×差异×删除资格×断网上传者回退；产物 `.qa/browser-smoke`。

## 坑

- program-files.iss 是构建时生成的文件清单 include——改产物内容不用手动维护它。
- WebView2 版本下限 123.0.2420.47 写死在 iss 与 README 两处。
