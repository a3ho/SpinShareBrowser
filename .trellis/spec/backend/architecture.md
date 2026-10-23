# 架构：进程模型与启动链路

## 启动链路（`spinshare_portable.main` → `launch`）

1. `InstanceLock(state_dir, name=gate_name)` 抢**维护门**互斥体（`Local\SpinShareBrowserMaintenance-<hash>`，hash 来自状态目录路径的 LCMapStringEx 小写折叠，与安装器 windows.iss 用同一算法协调）。抢不到 = Setup 在工作，10 秒后报错。
2. 抢**实例锁** `Local\SpinShareBrowser-<sha256(normcase(state_dir))>`。抢不到 → 双击场景：读 `config.json` 的 token → `read_runtime()` 验签读 `runtime.json`（HMAC-SHA256 签名，防篡改/防串台）→ `_existing_health()` 直连旧实例 `/v1/health`（核对 pid+instanceId）→ `show_existing()` POST `/v1/desktop/show` 唤起旧窗口并退出。旧实例不健康则轮询 10 秒后报错。
3. `PortableApplication(state_dir, desktop=not no_browser)`：
   - `ConfigStore` 加载/创建 `config.json`（首建时生成 64hex token + 32hex revision）
   - **每次启动都换新 revision**（`secrets.token_hex(16)`）——会话纪元，防旧页面重启后重放请求
   - 起 `PortableHTTPServer((127.0.0.1, 0))` 随机端口；UI 挂在 `/ui/<64hex>/index.html` 随机密钥路径
   - 写签名 `runtime.json`；`ChartCatalogCache(state_dir)`
4. 有窗口：`desktop.run(application)`（pywebview + WinForms 主循环）；无窗口：`application.serve_forever()`。

## 状态目录（默认 `%LOCALAPPDATA%\SpinShareBrowser`）

| 文件/目录 | 用途 |
| --- | --- |
| `config.json` | 设置（语言、closeBehavior、customDirectory、revision、windowSize、三个一次性提示位） |
| `charts-cache.json` | 谱面目录缓存（见 catalog-cache.md） |
| `runtime.json` | 端口/pid/instanceId + HMAC 签名（双击去重 + 维护协作） |
| `WebView2/`（含 `.spinshare-owner.json` 标记 + `profile/`） | 内嵌浏览器数据 |
| `Temp/`（含标记） | 原子写临时文件专用目录（`maintenance.prepare_temp_directory`） |

config 字段：language、closeBehavior、trayNoticeShown、playerShortcutHintShown、installDirectoryConfirmed、**playerVolume**（0–1 数字、拒 bool，2026-10-23 加入；旧配置经 `dict(CONFIG_DEFAULTS, **config)` 自动迁移默认 1.0；maintenance._parse_config 容忍缺失）、windowSize、customDirectory、revision。改字段三处同步：`CONFIG_DEFAULTS`/`validate_config`/`maintenance._parse_config` + bootstrap 下发 + 前端 `validateRuntimeConfig`。

关键：`_atomic_write` 对 config/runtime/charts-cache/browser.html 这四个名字的临时文件**必须**落在受标记保护的 `Temp/` 里（防止卸载清理误删别家文件、也防止状态文件写到一半混入未知文件）。

## 目录校验（`_directory_syntax` / `validate_directory`）

- 先做字符串级校验（pathlib 之前）：必须 `X:\` 绝对路径；拒绝 `..`、尾空格/尾点、`<>:"|?*`、控制字符、保留设备名（CON/PRN/AUX/NUL/COM1-9/LPT1-9）；盘根不允许。
- Windows 上 `GetDriveTypeW` 拒绝 0/1/4/5（未知/无盘/网络/光驱）——**只接受本地硬盘/可移动盘**。
- `validate_directory` 逐级 `_safe_info`（拒绝 symlink/reparse point）并核对 `resolve() == 原路径`（防 subst/联接欺骗）。**只校验不创建**。
- 坑：`--state-dir` 传相对路径会被直接拒绝（"Select an absolute local path"）——本地起实例调试时必须给绝对路径。

## PortableManager（继承 installer.JobManager）

- 构造时即尝试 `_recover_installation()`（恢复中断安装），失败只抛 APIError 不阻塞浏览。
- `accepted_requests` 集合（上限 65536）在任务被逐出后仍保留 requestId 用于重试去重（410 request_expired vs 重复提交幂等返回）。
- 设置 revision 是乐观并发控制：改目录/确认目录/安装请求都带 revision，不匹配报 409 settings_changed。
- 预览资源：`preview_resolvers`（2 并发解析）、`preview_streams`（4 并发流）、`preview_sources`（≤32 条、6 小时过期、随机 48hex 单文件 URL、绑定 (fileReference, updateHash)+revision+文件身份签名）。

## 退出语义

- `begin_exit()` 置 exiting：新安装/删除/目录选择/预览解析全部 409。
- `close_if_idle()`：有活跃任务返回 False（绝不强杀）；`_finish()` 关 server、join worker、只有 runtime.json 的 instanceId/pid 都还是自己才删它。
- 有窗口模式最终由 `desktop.run` 的 finally 收尾（见 desktop-host.md）。

## 已知边界

- POSIX 分支存在但产品只支持 Windows（Known Folder、互斥体、GetDriveType 都是 Win-only；POSIX 走 flock 和 ~/.local/share）。
- `MAX_CHART_BYTES = 32MiB` 同时约束单谱面文件、searchCharts 响应、安装索引总量 512MiB/4096 条/8 秒。
