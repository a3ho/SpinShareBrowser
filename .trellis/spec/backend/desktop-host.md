# 窗口宿主（desktop.py，pywebview 6.2.1 + WinForms）

## 启动（run）

`SetProcessDpiAwarenessContext(-4)`（Per-Monitor V2）→ `webview.create_window`（1320×860，min 600×400，隐藏）→ 本地 API 线程 → `webview.start(gui="edgechromium", private_mode=False, storage_path=受标记保护的 WebView2/profile)`。webview.settings 全关：ALLOW_FILE_URLS/DOWNLOADS/OPEN_EXTERNAL_LINKS_IN_BROWSER/IGNORE_SSL_ERRORS/REMOTE_DEBUGGING_PORT。

## WebView2 安全收紧（_configure_webview）

- 卸掉 pywebview 自带的 on_new_window_request，换成自己的 `_new_window`：用户发起的窗口请求 → `external_url_allowed()` 校验 → 系统浏览器（后台线程 webbrowser.open）。
- FrameNavigationStarting / LaunchingExternalUriScheme / DownloadStarting 一律 Cancel；PermissionRequested 一律 Deny；DevTools/右键菜单/加速键/状态栏全关；AreHostObjectsAllowed=False、IsWebMessageEnabled=False。
- 只信 `uri.partition("#")[0] == self.url`（密钥 UI 地址）；页面就绪标记 `_document_ready`（DOMContentLoaded）+ `_engine_failed`（渲染进程崩溃 → 原生消息框回退）。

## 自定义边框（2.0.1 的窗口卡死修复）

- 背景：WebView2 152 对碎片化 CSS 拖动区的 `IsNonClientRegionSupportEnabled` 会陷入 SetWindowPos 消息循环 → 激活/移动窗口可复现卡死。
- 方案：禁用动态非客户区；`_install_frame` 用 comctl32 `SetWindowSubclass` 子类化主窗口 + 一个透明 STATIC 覆盖子窗口（`_frame_overlay`）：
  - 主窗口 `WM_NCCALCSIZE` 返回 0（客户区铺满）→ 无系统标题栏；
  - `WM_NCHITTEST`：覆盖窗命中 = HTCAPTION（Windows 原生拖动/贴边/双击最大化），主窗口边缘 = 8 向缩放（SM_CXFRAME+SM_CXPADDEDBUFFER 边宽）；
  - `_update_frame_region`：`SetWindowRgn` 把覆盖窗裁成"标题栏高度 - 排除矩形"——排除矩形来自前端 `/v1/desktop/window/regions` 上报的 brand/右侧控件/播放器封面按钮/进度条/重试按钮/音量按钮（±3px 容差盖住入场动效）；`valid_frame_layout` 上限 **6** 个矩形（2026-10-23 为音量按钮从 5 扩到 6）。
  - **视口/DPI 未匹配时只留窗口边缘**，防旧矩形盖住新控件；模态对话框打开时 headerHeight=0 让出顶栏。MaximizedBounds 按工作区修正防遮挡任务栏。
- 失败安全：任何异常回滚到系统边框（custom_chrome=False，前端也不显示自绘窗口按钮）。

## 托盘与 toast

- 托盘：NotifyIcon + 自绘深色 ContextMenuStrip（打开/退出），`_tray_registered()` 用 Shell_NotifyIconGetRect 验证真的注册上（NotifyIcon.Visible 会撒谎）；注册失败宁可显示窗口也不消失。
- 关窗默认询问：优先**网页对话框**（`_open_dialog` 经 ExecuteScriptAsync 派发 `spinshare-dialog` 事件），页面不可用才回退 WinForms 原生三选框。选择可记住（closeBehavior: ask/exit/tray）。
- 自绘 toast：无边框 Form + WS_EX_TOOLWINDOW|WS_EX_NOACTIVATE（不抢焦点不进任务栏）、GDI 手绘（品牌行+状态行+彩点）、enter/hold/exit 三段动画（SystemParametersInfo 动画开关决定）、悬停延长、点左键打开应用；全屏（SHQueryUserNotificationState）/省电（GetSystemPowerStatus）/按流量计费（Network List Manager COM GetCost）时**不打扰**。
- 托盘期间 Timer 1.5s：`_check_tray` → `_start_catalog_sync`（60s 节流、低线程优先级 -1、调 `check_chart_catalog_automatically`），结果经 `notify_catalog_sync` 去重（同 attempt+errorCode 只报一次）后 toast。

## 退出流（_start_exit → _finish_exit）

1. `begin_exit()` + 独立 SpinShareExit 线程 join 安装队列（**绝不强杀活跃任务**）。
2. 保存窗口尺寸（DPI 归一化，Normal 态尺寸 + maximized 位）。
3. `finished.set()` → post `_destroy`；BeginInvoke 失败（WinForms 正在解体）→ 原生 `PostMessageW(WM_CLOSE)` 兜底；再失败回滚 exitFailed 让用户重试。
- 前端配合：`/v1/desktop/exit` → `request_exit`；活动面板显示"任务完成后退出"；重试入口 exitTool。

## 目录选择器（choose_directory）

纯 ctypes COM IFileDialog（FOS_PICKFOLDERS|FORCEFILESYSTEM），DPI 感知切换，WinEventHook 监听自家前台窗口标题抢回前台（Windows 拒绝激活时 HWND_TOPMOST 兜底），600 秒上限，owner 绑主窗口。设置里的选择器与首装确认共用（PortableManager.directory_picker）。

## 坑

- `post()`（BeginInvoke）失败 = 窗口正在销毁，返回 False 即可，别抛。
- 语言切换后托盘菜单/提示文案用 `_refresh_labels`/`_notice_text` 从 locales.json 取（native 侧自带 `_NOTICE_TEXT` 兜底）。
- `_fit_normal_window` 把窗口夹回工作区（多显示器拔出后自愈）。
