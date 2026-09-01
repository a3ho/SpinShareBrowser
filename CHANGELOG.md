# Changelog

SpinShare Browser maintains and distributes only the latest stable release. Historical installers are unavailable; install the current release to receive updates and support.

SpinShare Browser 仅维护和提供最新稳定版，历史安装包不再提供下载；请安装当前版本以获得更新与问题支持。

## 2.0.0 maintenance refresh — 2026-09-02

This maintenance reissue replaces the September 1 release assets with the installation, deletion, DLC, filtering, and Windows-update improvements below.

本次维护重发以以下安装、删除、DLC、筛选与 Windows 更新改进替换 9 月 1 日发布资产。

### English

#### Installation status checks

- Each local installation check now enumerates the actual `.srtb` files once and returns a hash inventory that the interface matches against the current catalog in memory, instead of probing each catalog candidate. Returning the window to the foreground still refreshes this local inventory automatically.
- A completed chart now receives one targeted local hash check and updates its card immediately, even while other downloads or installations remain active; it no longer waits for the whole queue to become idle.
- Installs and deletions invalidate the affected chart status, while changing the install folder invalidates the previous folder's whole inventory. DLC charts now use the same installed/not-installed matching, progress, filters, installation, reinstallation, and deletion flow as other charts. A genuine check failure keeps the last successful result visible and can be retried.
- DLC cards retain their catalog metadata and show a compact requirement label. A strictly valid Steam app-store address makes the label an accessible external link; malformed metadata falls back to a non-blocking generic DLC requirement.
- Changing already-applied base filters no longer inserts a wrapping message into the action column. The stable submit button changes from **Filter charts** to **Apply changes**, while the full status remains available to assistive technology.

#### Local chart deletion

- Added a one-click **Delete** action for charts whose local installation exactly matches the listed version, including DLC charts. It permanently removes the matching custom `.srtb`, cover, and optional audio files without confirmation, while leaving ZIP archives, unrelated temporary files, shared directories, and Steam's official DLC files untouched.
- Deletions stage files for simple rollback, run as short serialized local transactions, and keep independent progress on every card so multiple charts can be queued for deletion. Installation and deletion remain mutually exclusive, including while an installation request's result is unknown. Failures attempt to restore staged files, prioritize restoring the `.srtb`, explicitly report partial recovery, and recheck the actual installation state.
- Successful deletion now refreshes all and installed-only views, result counts, tag suggestions, and paging. Focus is repaired only when the focused card is removed; transitions follow the existing typography, control styling, short motion scale, and reduced-motion behavior.

#### Windows updates

- Setup now waits for the original idle app process to exit before replacing files. Maintenance runs without its own dialogs and returns bounded status codes to Setup; active downloads or installations are never force-terminated.
- A still-closing app or locked program file now stays in a retry/cancel flow, so releasing the lock and selecting **Retry** continues the same update instead of entering a terminal or apparently frozen page.

---

### 简体中文

#### 安装状态核对

- 每次本地安装状态核对改为一次枚举实际存在的 `.srtb` 文件并返回哈希清单，再由界面在内存中与当前谱面数据匹配，不再逐个探测 catalog 候选；窗口重新回到前台时仍会自动刷新这份本地清单。
- 单首谱面安装完成后改为立即执行一次定向本地哈希核对；即使其它下载或安装仍在进行，对应卡片也会马上更新，不再等待整个队列空闲。
- 安装和删除只使对应谱面状态失效，修改安装目录会使旧目录的整份清单失效。DLC 现在与普通谱面共用已安装／未安装核对、进度、筛选、安装、重新安装和删除链；真正的核对失败会保留上次成功结果，并可重试。
- DLC 卡片保留目录中的完整元数据并显示紧凑的要求标识。只有严格合法的 Steam 应用商店地址会使标识成为无障碍外链；异常元数据退化为不阻塞操作的通用 DLC 要求。
- 修改已经应用的基础筛选条件时，不再向操作列插入会换行的提示；稳定的提交按钮从“筛选谱面”切换为“应用更改”，完整状态仍会向辅助技术播报。

#### 本地谱面删除

- 为本地安装与列表版本精确一致的谱面（包括 DLC）新增一键“删除”。点击后不弹确认，立即永久删除对应自定义 `.srtb`、封面和可选音频，同时保留 ZIP、无关临时文件、共享目录和 Steam 官方 DLC 文件。
- 删除先暂存文件以便简单回滚，并由本地服务以短事务串行执行；每张卡片独立显示进度，可连续将多个谱面加入删除队列；安装与删除彼此互斥，安装请求结果尚未明确时也不会开放删除。失败时尝试恢复暂存文件并优先恢复 `.srtb`；若部分资源无法恢复，会明确提示检查安装目录并重新核对实际安装状态。
- 删除成功后同步刷新全部与仅已安装视图、结果数、标签候选和页码；只有聚焦卡片被移除时才修复焦点。交互沿用现有字体、控件样式、短动效节奏与减少运动规则。

#### Windows 覆盖更新

- 安装程序会在替换文件前等待原空闲工具进程真正退出；维护模式不显示自己的错误窗口，只以有界退出码向安装向导报告状态，正在下载或安装时绝不强制结束工具。
- 工具仍在退出或程序文件被占用时保持“重试／取消”流程；释放占用后点击“重试”即可继续同一次更新，不再进入终止页或呈现为卡死。

## 2.0.0 — 2026-09-01

Version 2.0.0 is a major update to browsing, playback, data synchronization, comments, and installation reliability.

### English

#### Interface and chart browsing

- Rebuilt the Windows interface with a responsive, high-density layout, clearer typography, consistent focus treatment, refined motion, and cohesive loading, empty, pagination, and footer states.
- Added local-first keyword search, tag combinations, sorting, date and difficulty filters, and views for all, installed, or uninstalled charts.
- Improved chart cards with larger covers, selectable song titles, a separate official-page link, concise metadata, and anchored author-note previews.

#### Full-song player

- Added one global header player for complete chart audio, with cover controls, song and artist information, elapsed and total time, and a draggable progress bar.
- Added Space to pause or resume and Left / Right to seek by 5 seconds when those keys do not belong to an editor or another native control.
- Fixed Left / Right seeking after selecting a chart cover or focusing the player timeline, so each key press moves exactly 5 seconds.
- Added robust OGG playback with one MP3 fallback, bounded loading time, state preservation across local browsing operations, and clear playback feedback.

#### Descriptions, reviews, and focus

- Long author notes now grow downward from their original region into an anchored floating card, then shrink back along the same path without moving surrounding charts.
- Review counts load independently in the background and remain visible. Zero-count controls cannot expand; unknown counts are never presented as zero.
- Added focused floating review panels with contained wheel scrolling, responsive placement, click-again and Escape dismissal, and a shared 60-second manual refresh interval.

#### Local data and synchronization

- Persisted the full chart catalog locally so filtering, search, tags, sorting, installation status, and paging do not require another full server request.
- Added automatic synchronization when local data is missing or more than 12 hours old, plus a separate foreground update action with a restart-resistant 10-minute interval.
- Added classified network, access, rate-limit, server, transfer, response, and local-storage errors; automatic retries use backoff, while eligible explicit retries remain available.
- Added startup synchronization focus panels and compact, no-focus tray notices for background completion or failure.

#### Installation and reliability

- Added a one-time folder confirmation before the first chart installation, with the same directory picker used by Settings.
- Added a bounded 128-task queue, up to two concurrent downloads, serialized installation, complete ZIP validation, staged replacement, and rollback safeguards.
- The installer now presents existing installations as an overwrite update. Program files are replaced while settings and locally installed charts remain unchanged.
- Updated the packaged Windows runtime, compatibility checks, local cache handling, keyboard behavior, and automated coverage for the 2.0.0 release.

---

2.0.0 是一次覆盖浏览、播放、数据同步、评论与安装可靠性的大版本更新。

### 简体中文

#### 界面与谱面浏览

- 重新设计 Windows 界面，采用自适应高密度布局，统一字体、焦点反馈与动效，并整理加载、空状态、分页和页脚表现。
- 新增本地优先的关键词搜索、标签组合、排序、日期与难度筛选，以及全部、仅已安装和仅未安装三种视图。
- 优化谱面卡片，使用更大封面、可选择复制的歌名、独立官网入口、紧凑元数据和锚定式作者说明预览。

#### 完整歌曲播放器

- 新增顶栏全局播放器，播放谱面的完整歌曲，显示封面、歌名、艺人、当前与总时间，并提供可拖动进度条。
- 当编辑器或原生控件不占用按键时，Space 可暂停或继续，左右方向键可后退或快进 5 秒。
- 修复点击谱面封面或聚焦播放器进度条后左右方向键失效或只移动少量时间的问题，现在每次精确移动 5 秒。
- 完善 OGG 播放与单次 MP3 回退、加载超时、浏览状态保留和播放反馈。

#### 作者说明、评论与聚焦体验

- 较长的作者说明从原区域向下扩展为锚定浮动卡片，收起时沿同一路径缩回，不推移周围谱面。
- 评论数量在后台独立加载并始终可见；零评论按钮无法展开，未知状态不会显示成 0。
- 新增聚焦式评论浮层、浮层内独立滚动、自适应定位、再次点击或 Escape 收起，以及所有谱面共用的 60 秒手动更新间隔。

#### 本地谱面数据与同步

- 将完整谱面数据持久保存在本地，筛选、搜索、标签、排序、安装状态和翻页不会再次请求服务器全量数据。
- 本地谱面数据不存在或超过 12 小时未更新时自动同步；前台手动更新独立使用重启后仍有效的 10 分钟间隔。
- 区分网络、访问拒绝、限流、服务器、传输、响应和本地存储错误；自动重试采用退避，符合条件的主动重试仍可立即执行。
- 新增启动同步聚焦卡片，以及后台同步完成或失败时不抢焦点的紧凑托盘提示。

#### 安装与可靠性

- 首次安装谱面前新增一次目录确认，并复用设置中的目录选择器。
- 新增最多 128 项任务的有界队列、最多两个并发下载、串行安装、完整 ZIP 校验、暂存替换与回滚保护。
- 安装程序会将现有安装明确呈现为覆盖更新：替换程序文件，同时保留设置和本地已安装谱面。
- 更新 Windows 打包运行环境、兼容性检查、本地缓存处理、键盘交互和 2.0.0 自动化测试覆盖。
