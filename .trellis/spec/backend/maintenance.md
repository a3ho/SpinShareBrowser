# 维护模式（maintenance.py，与 Inno Setup 协作）

## 三种模式（`SpinShareBrowser.exe --maintenance prepare|prepare-uninstall|cleanup`）

- `prepare`（升级前）：只删除过期的 `browser.html`（旧版留在状态目录的渲染页）；其它一概不动。
- `prepare-uninstall` = prepare + cleanup 语义（`prepare_upgrade(cleanup=True)` 直接返回让 uninstall 段做完整清理）。
- `cleanup`（卸载）：把状态目录里**应用自有**的东西全部删掉，保留任何无法证明归属的东西。
- 全程无 UI；退出码契约：0 成功、10 无法识别/忙、11 一般失败、12 IO、13 看门狗超时、14 父安装器消失、15（SetupPolicyBlocked 由 iss 段处理）。windows.iss 把这些映射成 Retry/Cancel 流程。

## 看门狗（watchdog）

`--parent-pid <setup pid>`：OpenProcess(SYNCHRONIZE) 句柄轮询；父进程消失或 120 秒总限到 → `os._exit(13/14)`。防孤儿维护进程挂住安装向导。

## 互斥协调（_idle_state）

- 复用与普通启动相同的**维护门**互斥体名（`gate_name`：LCMapStringEx 小写折叠 + sha256，Pascal 字符串 UTF-16LE）——Setup、卸载、应用启动三方用同一把锁。
- 拿到门后：实例锁若被应用占着 → `read_runtime` + `_shutdown()`（健康检查 activeJobs==0 → POST /v1/shutdown）→ 等 PID 句柄 signaled（≤5s）+ 实例锁释放 → 重读配置。**应用没退出干净 = 返回 10 让用户 Retry，绝不强杀。**
- 只支持默认状态目录（gate 名不匹配直接拒绝）。

## 所有权标记（.spinshare-owner.json）

`WebView2/`、`Temp/` 两个组件目录内写 `{schemaVersion:1, appId, component, directoryId:[st_dev,st_ino]}`。校验时 directoryId 必须仍等于该目录当前 inode 身份——目录被删了重建同名的不会被骗。无标记的已存在目录一律"retained"。

## 清理计划（_plan_cleanup → cleanup_state）

- 状态目录逐项分类：四个已知文档（config/runtime/page/chart-cache，各按严格 schema 验证+pin+sha256 复核）、两个标记组件（递归枚举 ≤100000 条；WebView2 里只许 profile/；发现 .srtb/AlbumArt/AudioClips/Custom/谱面 ZIP/暂存 tmp → "包含游戏文件，保留"）、legacy 临时文件（`.spinshare-*` 模式，按内容验证归属）、**其它任何名字 → retained**。
- 删除用 `SetFileInformationByHandle(FILE_DISPOSITION_INFO)`：句柄上复核身份+摘要（POSIX 分支 rmdir/unlink 前同样复核）。
- 组件目录删除失败时**重建标记文件**（保留目录可再清理），部分成功也如实报告 removed/retained。

## 与安装器的分工

windows.iss 负责程序文件（%LOCALAPPDATA%\Programs\SpinShareBrowser）与注册表/快捷方式；maintenance 只负责状态目录。两者都用 PinProgramDirectory/句柄钉住防 Windows 删除竞态。`prepare` 的调用点在 iss 的 PrepareInstall/curStepChanged，退出码经 MaintenanceXxx 消息映射（见 release/installer.md）。
